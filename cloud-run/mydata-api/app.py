"""
MyData Health Vault API Service
Cloud Run service providing REST API endpoints for the MyData feature.
"""

import io
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any, Callable, Dict, List, Optional, Tuple

import vertexai
from flask import Flask, Response, jsonify, request
import google.auth
import google.auth.transport.requests
from google.auth import compute_engine, default as google_auth_default
from google.cloud import firestore, storage
from google.cloud.storage import transfer_manager
from googleapiclient import discovery
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from vertexai.generative_models import GenerativeModel, GenerationConfig

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ID: str = os.environ.get("GCP_PROJECT", "dave-487819")
UPLOADS_BUCKET: str = os.environ.get("UPLOADS_BUCKET", "resohealth-mydata-uploads")
PROCESSED_BUCKET: str = os.environ.get("PROCESSED_BUCKET", "resohealth-mydata-processed")
HEALTHCARE_LOCATION: str = os.environ.get("HEALTHCARE_LOCATION", "us-central1")
HEALTHCARE_DATASET: str = os.environ.get("HEALTHCARE_DATASET", "resohealth-mydata")
FHIR_STORE: str = os.environ.get("FHIR_STORE", "health-vault")
VERTEX_LOCATION: str = os.environ.get("VERTEX_LOCATION", "us-central1")
MODEL_ID: str = os.environ.get("MODEL_ID", "gemini-2.0-flash")
ALLOWED_ORIGINS: List[str] = os.environ.get(
    "ALLOWED_ORIGINS", "https://go.resohealth.life,http://localhost:3000"
).split(",")

# ---------------------------------------------------------------------------
# App & Clients
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

storage_client = storage.Client(project=PROJECT_ID)
firestore_client = firestore.Client(project=PROJECT_ID)

credentials, _ = google_auth_default()
healthcare_service = discovery.build("healthcare", "v1", credentials=credentials, cache_discovery=False)

# Resolve signing credentials at startup for signed URL generation on Cloud Run.
# Cloud Run uses metadata-based credentials, so we must use IAM signBlob API.
def _resolve_sa_email() -> str:
    """Return the service-account email that this Cloud Run revision runs as."""
    import requests as _req
    try:
        r = _req.get(
            "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
            headers={"Metadata-Flavor": "Google"}, timeout=3,
        )
        return r.text.strip()
    except Exception:
        return os.environ.get("SERVICE_ACCOUNT_EMAIL",
                              f"mydata-pipeline@{PROJECT_ID}.iam.gserviceaccount.com")

_SERVICE_ACCOUNT_EMAIL: str = _resolve_sa_email()
logger_init = logging.getLogger("mydata-api.init")
logger_init.info("Signing SA: %s", _SERVICE_ACCOUNT_EMAIL)

vertexai.init(project=PROJECT_ID, location=VERTEX_LOCATION)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mydata-api")

FHIR_BASE = (
    f"projects/{PROJECT_ID}/locations/{HEALTHCARE_LOCATION}"
    f"/datasets/{HEALTHCARE_DATASET}/fhirStores/{FHIR_STORE}"
)


# ---------------------------------------------------------------------------
# CORS & Auth Middleware
# ---------------------------------------------------------------------------
@app.after_request
def add_cors_headers(response: Response) -> Response:
    """Add CORS headers to every response."""
    origin = request.headers.get("Origin", "")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-User-Id, X-Share-Token"
    response.headers["Access-Control-Max-Age"] = "3600"
    return response


@app.route("/api/mydata/<path:path>", methods=["OPTIONS"])
def handle_options(path: str) -> Response:
    """Handle CORS preflight."""
    return Response("", status=204)


def require_auth(f: Callable) -> Callable:
    """Decorator to extract and validate user identity from the Authorization header.

    Expects either:
    - Firebase ID token in Authorization: Bearer <token>  (validated via Firestore user lookup)
    - Share token in X-Share-Token header (for shared access)

    For simplicity in this implementation, we extract the user ID from the
    'X-User-Id' header (set by the Next.js middleware after Firebase Auth
    verification). In production, you would verify the Firebase ID token here.
    """

    @wraps(f)
    def decorated(*args: Any, **kwargs: Any) -> Any:
        # Check for share token access
        share_token = request.headers.get("X-Share-Token")
        if share_token:
            return f(*args, user_id=None, share_token=share_token, **kwargs)

        # Get user ID from header (set by authenticated Next.js middleware)
        user_id = request.headers.get("X-User-Id")
        if not user_id:
            # Try Authorization header with Bearer token
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                # In production: verify Firebase ID token and extract uid
                # For now, we expect X-User-Id to be set
                pass

            if not user_id:
                return jsonify({"error": "Authentication required", "code": "UNAUTHORIZED"}), 401

        return f(*args, user_id=user_id, share_token=None, **kwargs)

    return decorated


def _validate_share_access(
    share_token: str, document_id: Optional[str] = None, required_category: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Validate a share token and return share metadata if valid."""
    shares_ref = firestore_client.collection("share_tokens").document(share_token)
    share_doc = shares_ref.get()

    if not share_doc.exists:
        return None

    share_data = share_doc.to_dict()

    # Check expiry
    expires_at = share_data.get("expiresAt")
    if expires_at and expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return None

    # Check category restrictions
    allowed_categories = share_data.get("allowedCategories", [])
    if required_category and allowed_categories and required_category not in allowed_categories:
        return None

    return share_data


# ---------------------------------------------------------------------------
# 3.2 POST /api/mydata/upload/request
# ---------------------------------------------------------------------------
@app.route("/api/mydata/upload/request", methods=["POST"])
@require_auth
def upload_request(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Generate a signed URL for direct GCS upload.

    Request body:
        {
            "filename": "lab_report.pdf",
            "contentType": "application/pdf",
            "sizeBytes": 2048576
        }

    Returns:
        {
            "uploadUrl": "https://storage.googleapis.com/...",
            "documentId": "uuid",
            "gcsPath": "gs://resohealth-mydata-uploads/{userId}/{docId}/{filename}"
        }
    """
    if share_token:
        return jsonify({"error": "Upload not allowed via share token"}), 403

    data = request.get_json(silent=True) or {}

    filename = data.get("filename")
    content_type = data.get("contentType", "application/pdf")
    size_bytes = data.get("sizeBytes", 0)

    if not filename:
        return jsonify({"error": "filename is required"}), 400

    # Validate file size (max 20MB)
    max_size = 20 * 1024 * 1024
    if size_bytes > max_size:
        return jsonify({"error": f"File too large. Maximum size is {max_size // (1024*1024)} MB"}), 400

    # Validate content type
    allowed_types = [
        "application/pdf", "image/png", "image/jpeg", "image/tiff",
        "image/gif", "image/bmp", "image/webp",
    ]
    if content_type not in allowed_types:
        return jsonify({"error": f"Unsupported file type: {content_type}"}), 400

    # Generate document ID
    document_id = str(uuid.uuid4())
    gcs_path = f"{user_id}/{document_id}/{filename}"

    # Create Firestore document
    doc_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
        .document(document_id)
    )
    doc_ref.set({
        "documentId": document_id,
        "filename": filename,
        "contentType": content_type,
        "sizeBytes": size_bytes,
        "gcsPath": f"gs://{UPLOADS_BUCKET}/{gcs_path}",
        "status": "pending",
        "uploadedAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
        "userId": user_id,
    })

    # Generate signed URL for upload
    # On Cloud Run we must use IAM signBlob (no JSON key file).
    # Requires the SA to have 'iam.serviceAccountTokenCreator' on itself.
    bucket = storage_client.bucket(UPLOADS_BUCKET)
    blob = bucket.blob(gcs_path)

    try:
        # Refresh credentials to get a valid access token
        auth_request = google.auth.transport.requests.Request()
        credentials.refresh(auth_request)

        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=30),
            method="PUT",
            content_type=content_type,
            service_account_email=_SERVICE_ACCOUNT_EMAIL,
            access_token=credentials.token,
        )
    except Exception as sign_exc:
        logger.exception("Signed URL generation failed for SA=%s", _SERVICE_ACCOUNT_EMAIL)
        return jsonify({"error": f"Failed to generate upload URL: {sign_exc}"}), 500

    logger.info("Generated upload URL for user=%s, doc=%s", user_id, document_id)

    return jsonify({
        "uploadUrl": signed_url,
        "documentId": document_id,
        "gcsPath": f"gs://{UPLOADS_BUCKET}/{gcs_path}",
        "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
    }), 200


# ---------------------------------------------------------------------------
# 3.2b POST /api/mydata/upload/<document_id>/confirm
# ---------------------------------------------------------------------------
@app.route("/api/mydata/upload/<document_id>/confirm", methods=["POST"])
@require_auth
def confirm_upload(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Confirm that a file has been uploaded to GCS, triggering processing."""
    if share_token:
        return jsonify({"error": "Not allowed via share token"}), 403

    doc_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
        .document(document_id)
    )
    doc = doc_ref.get()
    if not doc.exists:
        return jsonify({"error": "Document not found"}), 404

    doc_ref.update({"status": "uploaded", "updatedAt": firestore.SERVER_TIMESTAMP})
    logger.info("Upload confirmed for user=%s, doc=%s", user_id, document_id)

    return jsonify({"status": "confirmed", "documentId": document_id}), 200

# ---------------------------------------------------------------------------
# 3.3 GET /api/mydata/documents
# ---------------------------------------------------------------------------
@app.route("/api/mydata/documents", methods=["GET"])
@require_auth
def list_documents(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """List user's documents from Firestore.

    Query params:
        category: Filter by category
        status: Filter by status
        page: Page number (1-based, default 1)
        limit: Items per page (default 20, max 100)
        dateFrom: Filter from date (YYYY-MM-DD)
        dateTo: Filter to date (YYYY-MM-DD)
    """
    # Handle share token access
    effective_user_id = user_id
    allowed_categories: Optional[List[str]] = None
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]
        allowed_categories = share_data.get("allowedCategories")

    # Parse query parameters
    category = request.args.get("category")
    status = request.args.get("status")
    page = max(1, int(request.args.get("page", 1)))
    limit = min(100, max(1, int(request.args.get("limit", 20))))
    date_from = request.args.get("dateFrom")
    date_to = request.args.get("dateTo")

    # Build query
    query = (
        firestore_client.collection("users")
        .document(effective_user_id)
        .collection("health_documents")
    )

    if category:
        if allowed_categories and category not in allowed_categories:
            return jsonify({"error": "Category not allowed for this share token"}), 403
        query = query.where("category", "==", category)
    elif allowed_categories:
        # Firestore doesn't support 'in' with other compound queries well,
        # so we filter client-side for share tokens
        pass

    if status:
        query = query.where("status", "==", status)

    query = query.order_by("uploadedAt", direction=firestore.Query.DESCENDING)

    # Pagination: fetch limit+1 to check for next page, offset by (page-1)*limit
    offset = (page - 1) * limit
    docs = list(query.offset(offset).limit(limit + 1).stream())

    has_next = len(docs) > limit
    docs = docs[:limit]

    documents = []
    for doc in docs:
        doc_data = doc.to_dict()
        # Ensure 'id' field is present (frontend expects it)
        doc_data["id"] = doc_data.get("documentId", doc.id)

        # Apply date filters client-side
        if date_from:
            doc_date = doc_data.get("dateOfService") or ""
            if doc_date and doc_date < date_from:
                continue
        if date_to:
            doc_date = doc_data.get("dateOfService") or ""
            if doc_date and doc_date > date_to:
                continue

        # Filter by allowed categories for share tokens
        if allowed_categories and doc_data.get("category") not in allowed_categories:
            continue

        # Remove sensitive fields for share access
        if share_token:
            doc_data.pop("gcsPath", None)
            doc_data.pop("ocrOutputPath", None)
            doc_data.pop("classificationPath", None)

        # Serialize Firestore timestamps to ISO strings for JSON
        for ts_field in ("uploadedAt", "updatedAt"):
            val = doc_data.get(ts_field)
            if val and hasattr(val, "isoformat"):
                doc_data[ts_field] = val.isoformat()

        # ── Ensure all frontend-expected fields have safe defaults ──
        # Map backend field names to frontend expected names
        if "filename" in doc_data and "fileName" not in doc_data:
            doc_data["fileName"] = doc_data["filename"]
        if "contentType" in doc_data and "mimeType" not in doc_data:
            doc_data["mimeType"] = doc_data["contentType"]
        if "sizeBytes" in doc_data and "fileSizeBytes" not in doc_data:
            doc_data["fileSizeBytes"] = doc_data["sizeBytes"]
        if "gcsPath" in doc_data and "gcsRawPath" not in doc_data:
            doc_data["gcsRawPath"] = doc_data["gcsPath"]
        # Remap status: backend uses 'uploaded'/'pending', frontend expects
        # 'pending'/'uploading'/'ocr_processing'/'classifying'/'classified'/'error'
        status_val = doc_data.get("status", "pending")
        if status_val == "uploaded":
            status_val = "ocr_processing"
        doc_data["status"] = status_val
        # Set safe defaults for fields the frontend accesses
        doc_data.setdefault("category", "Lab Results")
        doc_data.setdefault("subcategories", [])
        doc_data.setdefault("summary", "")
        doc_data.setdefault("keyFindings", [])
        doc_data.setdefault("dateOfService", None)
        doc_data.setdefault("providerName", None)
        doc_data.setdefault("fhirResourceIds", [])
        doc_data.setdefault("aiClassification", None)

        documents.append(doc_data)

    return jsonify({
        "items": documents,
        "total": len(documents) + (1 if has_next else 0),  # approximate
        "page": page,
        "pageSize": limit,
        "hasMore": has_next,
        # Legacy fields for backward compatibility
        "documents": documents,
        "pagination": {
            "page": page,
            "limit": limit,
            "hasNext": has_next,
            "total": len(documents),
        },
    }), 200


# ---------------------------------------------------------------------------
# 3.4 GET /api/mydata/documents/<id>
# ---------------------------------------------------------------------------
@app.route("/api/mydata/documents/<document_id>", methods=["GET"])
@require_auth
def get_document(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Get single document detail including OCR text, classification, FHIR resource IDs."""
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token, document_id=document_id)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    doc_ref = (
        firestore_client.collection("users")
        .document(effective_user_id)
        .collection("health_documents")
        .document(document_id)
    )
    doc = doc_ref.get()

    if not doc.exists:
        return jsonify({"error": "Document not found"}), 404

    doc_data = doc.to_dict()
    doc_data["id"] = doc_data.get("documentId", doc.id)

    # Serialize Firestore timestamps
    for ts_field in ("uploadedAt", "updatedAt"):
        val = doc_data.get(ts_field)
        if val and hasattr(val, "isoformat"):
            doc_data[ts_field] = val.isoformat()

    # Optionally fetch OCR text
    include_ocr = request.args.get("includeOcr", "false").lower() == "true"
    if include_ocr and doc_data.get("ocrOutputPath"):
        try:
            ocr_path = doc_data["ocrOutputPath"]
            if ocr_path.startswith("gs://"):
                parts = ocr_path[5:].split("/", 1)
                bucket = storage_client.bucket(parts[0])
                blob = bucket.blob(parts[1])
                ocr_data = json.loads(blob.download_as_text())
                doc_data["ocrText"] = ocr_data.get("fullText", "")
                doc_data["ocrPages"] = ocr_data.get("pages", [])
        except Exception as exc:
            logger.warning("Failed to fetch OCR data: %s", exc)

    # Optionally fetch classification
    include_classification = request.args.get("includeClassification", "false").lower() == "true"
    if include_classification and doc_data.get("classificationPath"):
        try:
            cls_path = doc_data["classificationPath"]
            if cls_path.startswith("gs://"):
                parts = cls_path[5:].split("/", 1)
                bucket = storage_client.bucket(parts[0])
                blob = bucket.blob(parts[1])
                cls_data = json.loads(blob.download_as_text())
                doc_data["classificationDetail"] = cls_data
        except Exception as exc:
            logger.warning("Failed to fetch classification data: %s", exc)

    # ── Ensure all frontend-expected fields have safe defaults ──
    if "filename" in doc_data and "fileName" not in doc_data:
        doc_data["fileName"] = doc_data["filename"]
    if "contentType" in doc_data and "mimeType" not in doc_data:
        doc_data["mimeType"] = doc_data["contentType"]
    if "sizeBytes" in doc_data and "fileSizeBytes" not in doc_data:
        doc_data["fileSizeBytes"] = doc_data["sizeBytes"]
    if "gcsPath" in doc_data and "gcsRawPath" not in doc_data:
        doc_data["gcsRawPath"] = doc_data["gcsPath"]
    status_val = doc_data.get("status", "pending")
    if status_val == "uploaded":
        status_val = "ocr_processing"
    doc_data["status"] = status_val
    doc_data.setdefault("category", "Lab Results")
    doc_data.setdefault("subcategories", [])
    doc_data.setdefault("summary", "")
    doc_data.setdefault("keyFindings", [])
    doc_data.setdefault("dateOfService", None)
    doc_data.setdefault("providerName", None)
    doc_data.setdefault("fhirResourceIds", [])
    doc_data.setdefault("aiClassification", None)

    return jsonify(doc_data), 200


# ---------------------------------------------------------------------------
# 3.5 PATCH /api/mydata/documents/<id>
# ---------------------------------------------------------------------------
@app.route("/api/mydata/documents/<document_id>", methods=["PATCH"])
@require_auth
def update_document(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Update document metadata (category override, title, notes)."""
    if share_token:
        return jsonify({"error": "Updates not allowed via share token"}), 403

    data = request.get_json(silent=True) or {}

    # Allowed fields for update
    allowed_fields = {"category", "title", "notes", "tags"}
    update_data: Dict[str, Any] = {}

    for field in allowed_fields:
        if field in data:
            update_data[field] = data[field]

    if not update_data:
        return jsonify({"error": "No valid fields to update"}), 400

    # Validate category if provided
    valid_categories = [
        "vitals", "lab_results", "radiology", "outpatient", "inpatient",
        "medications", "triage", "insurance", "epigenetic_bioage",
        "nutrigenomics", "genetic_testing", "longevity_assessment", "wellness_program",
    ]
    if "category" in update_data and update_data["category"] not in valid_categories:
        return jsonify({"error": f"Invalid category: {update_data['category']}"}), 400

    update_data["updatedAt"] = firestore.SERVER_TIMESTAMP

    doc_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
        .document(document_id)
    )

    doc = doc_ref.get()
    if not doc.exists:
        return jsonify({"error": "Document not found"}), 404

    doc_ref.update(update_data)

    updated_doc = doc_ref.get().to_dict()
    return jsonify(updated_doc), 200


# ---------------------------------------------------------------------------
# 3.6 DELETE /api/mydata/documents/<id>
# ---------------------------------------------------------------------------
@app.route("/api/mydata/documents/<document_id>", methods=["DELETE"])
@require_auth
def delete_document(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Delete document: remove from GCS (both buckets), Firestore, and FHIR store."""
    if share_token:
        return jsonify({"error": "Deletion not allowed via share token"}), 403

    doc_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
        .document(document_id)
    )
    doc = doc_ref.get()

    if not doc.exists:
        return jsonify({"error": "Document not found"}), 404

    doc_data = doc.to_dict()

    errors: List[str] = []

    # 1. Delete from uploads bucket
    try:
        gcs_path = doc_data.get("gcsPath", "")
        if gcs_path.startswith(f"gs://{UPLOADS_BUCKET}/"):
            blob_name = gcs_path[len(f"gs://{UPLOADS_BUCKET}/"):]
            bucket = storage_client.bucket(UPLOADS_BUCKET)
            blob = bucket.blob(blob_name)
            if blob.exists():
                blob.delete()
                logger.info("Deleted from uploads bucket: %s", blob_name)
    except Exception as exc:
        errors.append(f"Failed to delete from uploads: {exc}")
        logger.warning("Failed to delete from uploads bucket: %s", exc)

    # 2. Delete from processed bucket (all files under userId/documentId/)
    try:
        prefix = f"{user_id}/{document_id}/"
        bucket = storage_client.bucket(PROCESSED_BUCKET)
        blobs = list(bucket.list_blobs(prefix=prefix))
        for blob in blobs:
            blob.delete()
        logger.info("Deleted %d files from processed bucket", len(blobs))
    except Exception as exc:
        errors.append(f"Failed to delete from processed: {exc}")
        logger.warning("Failed to delete from processed bucket: %s", exc)

    # 3. Delete FHIR resources
    fhir_ids = doc_data.get("fhirResourceIds", {})
    if fhir_ids:
        try:
            # Delete individual resources
            all_resource_refs = fhir_ids.get("resources", [])
            if fhir_ids.get("DocumentReference"):
                all_resource_refs.append(f"DocumentReference/{fhir_ids['DocumentReference']}")

            for ref in all_resource_refs:
                try:
                    resource_path = f"{FHIR_BASE}/fhir/{ref}"
                    request_obj = (
                        healthcare_service.projects()
                        .locations()
                        .datasets()
                        .fhirStores()
                        .fhir()
                        .delete(name=resource_path)
                    )
                    request_obj.execute()
                    logger.info("Deleted FHIR resource: %s", ref)
                except Exception as exc:
                    logger.warning("Failed to delete FHIR resource %s: %s", ref, exc)
        except Exception as exc:
            errors.append(f"Failed to delete FHIR resources: {exc}")

    # 4. Delete from Firestore
    try:
        doc_ref.delete()
        logger.info("Deleted Firestore document: %s", document_id)
    except Exception as exc:
        errors.append(f"Failed to delete from Firestore: {exc}")

    if errors:
        return jsonify({
            "status": "partial_delete",
            "message": "Document deleted with some errors",
            "errors": errors,
        }), 207

    return jsonify({"status": "deleted", "documentId": document_id}), 200


# ---------------------------------------------------------------------------
# 3.7 GET /api/mydata/insights
# ---------------------------------------------------------------------------
@app.route("/api/mydata/insights", methods=["GET"])
@require_auth
def get_insights(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Generate AI insights using Vertex AI Gemini.

    Fetches all classified documents, builds a health summary, and generates insights.
    """
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    # Fetch all classified documents
    docs_query = (
        firestore_client.collection("users")
        .document(effective_user_id)
        .collection("health_documents")
        .where("status", "==", "classified")
        .order_by("uploadedAt", direction=firestore.Query.DESCENDING)
        .limit(100)
    )

    docs = list(docs_query.stream())
    if not docs:
        return jsonify({
            "insights": [],
            "summary": "No classified documents found. Upload medical documents to receive AI-powered health insights.",
            "documentCount": 0,
        }), 200

    # Build context from documents
    doc_summaries = []
    for doc in docs:
        d = doc.to_dict()
        doc_summaries.append({
            "category": d.get("category", "unknown"),
            "summary": d.get("summary", ""),
            "keyFindings": d.get("keyFindings", []),
            "dateOfService": d.get("dateOfService", ""),
            "providerName": d.get("providerName", ""),
        })

    context = json.dumps(doc_summaries, indent=2, default=str)

    prompt = f"""You are a medical health insights AI for ResoHealth's Health Vault.
Analyze the following collection of medical documents for a single patient and generate comprehensive health insights.

MEDICAL DOCUMENTS:
{context}

Generate a JSON response with the following structure:
{{
  "overallHealthSummary": "<2-3 paragraph comprehensive health summary>",
  "insights": [
    {{
      "type": "<trend|anomaly|correlation|interaction|preventive|longevity>",
      "title": "<short title>",
      "description": "<detailed description>",
      "severity": "<info|low|medium|high|critical>",
      "relatedCategories": ["<category1>", "<category2>"],
      "recommendation": "<actionable recommendation>"
    }}
  ],
  "trends": [
    {{
      "metric": "<metric name>",
      "direction": "<improving|stable|declining>",
      "description": "<trend description>"
    }}
  ],
  "medicationInteractions": [
    {{
      "medications": ["<med1>", "<med2>"],
      "severity": "<mild|moderate|severe>",
      "description": "<interaction description>"
    }}
  ],
  "preventiveRecommendations": [
    {{
      "title": "<recommendation>",
      "priority": "<low|medium|high>",
      "description": "<details>"
    }}
  ],
  "longevityScore": {{
    "score": <0-100>,
    "factors": ["<factor1>", "<factor2>"],
    "improvements": ["<suggestion1>", "<suggestion2>"]
  }}
}}

Only include sections where data is available. Be thorough but evidence-based.
Return valid JSON only."""

    try:
        model = GenerativeModel(MODEL_ID)
        response = model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                temperature=0.2,
                max_output_tokens=8192,
                response_mime_type="application/json",
            ),
        )

        insights_text = response.text.strip()
        insights = json.loads(insights_text)

        return jsonify({
            "insights": insights,
            "documentCount": len(docs),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }), 200

    except Exception as exc:
        logger.exception("Failed to generate insights")
        return jsonify({"error": f"Failed to generate insights: {exc}"}), 500


# ---------------------------------------------------------------------------
# 3.8 POST /api/mydata/insights/ask
# ---------------------------------------------------------------------------
@app.route("/api/mydata/insights/ask", methods=["POST"])
@require_auth
def ask_insights(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Free-form question about the user's health data using Gemini with RAG."""
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    data = request.get_json(silent=True) or {}
    question = data.get("question", "").strip()

    if not question:
        return jsonify({"error": "question is required"}), 400

    if len(question) > 2000:
        return jsonify({"error": "Question too long (max 2000 characters)"}), 400

    # Fetch user's documents for context (RAG)
    docs_query = (
        firestore_client.collection("users")
        .document(effective_user_id)
        .collection("health_documents")
        .where("status", "==", "classified")
        .order_by("uploadedAt", direction=firestore.Query.DESCENDING)
        .limit(50)
    )

    docs = list(docs_query.stream())
    doc_contexts = []

    for doc in docs:
        d = doc.to_dict()
        doc_contexts.append(
            f"[{d.get('category', 'unknown')}] "
            f"Date: {d.get('dateOfService', 'N/A')} | "
            f"Provider: {d.get('providerName', 'N/A')}\n"
            f"Summary: {d.get('summary', 'N/A')}\n"
            f"Key Findings: {', '.join(d.get('keyFindings', []))}"
        )

    context = "\n\n---\n\n".join(doc_contexts) if doc_contexts else "No documents available."

    prompt = f"""You are a knowledgeable health assistant for ResoHealth's Health Vault.
Answer the user's question based ONLY on their medical documents below.
If the answer cannot be determined from the available data, say so clearly.
Be helpful, accurate, and cite specific documents when possible.

PATIENT'S MEDICAL DOCUMENTS:
{context}

USER QUESTION: {question}

Provide a clear, comprehensive answer. Include relevant context from the documents.
If suggesting any action, always recommend consulting with a healthcare provider."""

    try:
        model = GenerativeModel(MODEL_ID)
        response = model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                temperature=0.3,
                max_output_tokens=4096,
            ),
        )

        return jsonify({
            "question": question,
            "answer": response.text.strip(),
            "documentsReferenced": len(docs),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "disclaimer": "This is AI-generated analysis. Always consult with a qualified healthcare provider for medical decisions.",
        }), 200

    except Exception as exc:
        logger.exception("Failed to answer question")
        return jsonify({"error": f"Failed to process question: {exc}"}), 500


# ---------------------------------------------------------------------------
# 3.9 GET /api/mydata/export/pdf
# ---------------------------------------------------------------------------
@app.route("/api/mydata/export/pdf", methods=["GET"])
@require_auth
def export_pdf(user_id: str, share_token: Optional[str] = None) -> Response:
    """Generate a branded PDF health report using ReportLab."""
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    # Fetch all classified documents
    docs_query = (
        firestore_client.collection("users")
        .document(effective_user_id)
        .collection("health_documents")
        .where("status", "==", "classified")
        .order_by("uploadedAt", direction=firestore.Query.DESCENDING)
        .limit(200)
    )
    docs = list(docs_query.stream())

    # Organize documents by category
    categorized: Dict[str, List[Dict[str, Any]]] = {}
    for doc in docs:
        d = doc.to_dict()
        cat = d.get("category", "other")
        categorized.setdefault(cat, []).append(d)

    # Generate AI summary for the report
    ai_summary = ""
    try:
        doc_summaries = []
        for doc in docs:
            d = doc.to_dict()
            doc_summaries.append({
                "category": d.get("category"),
                "summary": d.get("summary"),
                "keyFindings": d.get("keyFindings", []),
                "dateOfService": d.get("dateOfService"),
            })

        if doc_summaries:
            model = GenerativeModel(MODEL_ID)
            resp = model.generate_content(
                f"Provide a professional medical summary for a patient health report based on these documents:\n{json.dumps(doc_summaries, default=str)}\n\nWrite 3-4 paragraphs suitable for a formal medical report PDF.",
                generation_config=GenerationConfig(temperature=0.2, max_output_tokens=2048),
            )
            ai_summary = resp.text.strip()
    except Exception as exc:
        logger.warning("Failed to generate AI summary for PDF: %s", exc)
        ai_summary = "AI summary generation unavailable."

    # Build PDF
    buffer = io.BytesIO()
    doc_pdf = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=25 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    story: List[Any] = []

    # Custom styles
    title_style = ParagraphStyle(
        "ResoTitle",
        parent=styles["Title"],
        fontSize=28,
        textColor=colors.HexColor("#0F766E"),
        spaceAfter=12,
        alignment=TA_CENTER,
    )
    subtitle_style = ParagraphStyle(
        "ResoSubtitle",
        parent=styles["Normal"],
        fontSize=14,
        textColor=colors.HexColor("#64748B"),
        alignment=TA_CENTER,
        spaceAfter=30,
    )
    heading_style = ParagraphStyle(
        "ResoHeading",
        parent=styles["Heading1"],
        fontSize=18,
        textColor=colors.HexColor("#0F766E"),
        spaceBefore=20,
        spaceAfter=10,
    )
    subheading_style = ParagraphStyle(
        "ResoSubheading",
        parent=styles["Heading2"],
        fontSize=14,
        textColor=colors.HexColor("#334155"),
        spaceBefore=12,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "ResoBody",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#1E293B"),
        spaceAfter=8,
        leading=14,
    )
    finding_style = ParagraphStyle(
        "ResoFinding",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#475569"),
        leftIndent=15,
        spaceAfter=4,
        bulletFontSize=10,
    )
    disclaimer_style = ParagraphStyle(
        "ResoDisclaimer",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#94A3B8"),
        alignment=TA_CENTER,
        spaceBefore=30,
    )

    # --- Cover Page ---
    story.append(Spacer(1, 80))
    story.append(Paragraph("ResoHealth", title_style))
    story.append(Paragraph("MyData Health Vault Report", subtitle_style))
    story.append(Spacer(1, 20))
    story.append(Paragraph(
        f"Generated: {datetime.now(timezone.utc).strftime('%B %d, %Y at %H:%M UTC')}",
        ParagraphStyle("Date", parent=body_style, alignment=TA_CENTER, textColor=colors.HexColor("#64748B")),
    ))
    story.append(Paragraph(
        f"Total Documents: {len(docs)}",
        ParagraphStyle("Count", parent=body_style, alignment=TA_CENTER, textColor=colors.HexColor("#64748B")),
    ))
    story.append(Spacer(1, 40))
    story.append(Paragraph(
        "CONFIDENTIAL — This report contains protected health information.",
        disclaimer_style,
    ))
    story.append(PageBreak())

    # --- Patient Summary ---
    story.append(Paragraph("Patient Health Summary", heading_style))
    if ai_summary:
        for para in ai_summary.split("\n\n"):
            if para.strip():
                story.append(Paragraph(para.strip(), body_style))
    story.append(PageBreak())

    # --- Category Sections ---
    category_display = {
        "vitals": "Vital Signs",
        "lab_results": "Laboratory Results",
        "radiology": "Radiology & Imaging",
        "medications": "Medications",
        "outpatient": "Outpatient Visits",
        "inpatient": "Inpatient Stays",
        "triage": "Triage Records",
        "insurance": "Insurance Information",
        "epigenetic_bioage": "Epigenetic & Biological Age",
        "nutrigenomics": "Nutrigenomics",
        "genetic_testing": "Genetic Testing",
        "longevity_assessment": "Longevity Assessment",
        "wellness_program": "Wellness Programs",
    }

    for cat, display_name in category_display.items():
        cat_docs = categorized.get(cat, [])
        if not cat_docs:
            continue

        story.append(Paragraph(display_name, heading_style))
        story.append(Paragraph(f"{len(cat_docs)} document(s)", body_style))

        for i, d in enumerate(cat_docs):
            story.append(Paragraph(
                f"Document {i+1}: {d.get('filename', 'N/A')}",
                subheading_style,
            ))

            meta_parts = []
            if d.get("dateOfService"):
                meta_parts.append(f"Date: {d['dateOfService']}")
            if d.get("providerName"):
                meta_parts.append(f"Provider: {d['providerName']}")
            if d.get("confidence"):
                meta_parts.append(f"Confidence: {d['confidence']:.0%}")
            if meta_parts:
                story.append(Paragraph(" | ".join(meta_parts), body_style))

            if d.get("summary"):
                story.append(Paragraph(d["summary"], body_style))

            findings = d.get("keyFindings", [])
            if findings:
                story.append(Paragraph("Key Findings:", body_style))
                for finding in findings:
                    story.append(Paragraph(f"• {finding}", finding_style))

            story.append(Spacer(1, 10))

        story.append(PageBreak())

    # --- AI Insights Section ---
    story.append(Paragraph("AI-Powered Insights", heading_style))
    story.append(Paragraph(
        "The following insights were generated by analyzing all documents in your Health Vault using advanced AI.",
        body_style,
    ))
    story.append(Paragraph(
        "These insights are for informational purposes only and should not replace professional medical advice.",
        body_style,
    ))
    story.append(Spacer(1, 20))

    # --- Footer / Disclaimer ---
    story.append(Paragraph(
        "DISCLAIMER: This report was generated by ResoHealth's AI-powered Health Vault system. "
        "The information contained herein is derived from uploaded medical documents and AI analysis. "
        "It is not a substitute for professional medical advice, diagnosis, or treatment. "
        "Always seek the advice of your physician or other qualified health provider.",
        disclaimer_style,
    ))

    # Build PDF
    doc_pdf.build(story)
    buffer.seek(0)

    return Response(
        buffer.getvalue(),
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=ResoHealth_HealthVault_Report_{datetime.now().strftime('%Y%m%d')}.pdf",
        },
    )


# ---------------------------------------------------------------------------
# 3.10 GET /api/mydata/export/fhir
# ---------------------------------------------------------------------------
@app.route("/api/mydata/export/fhir", methods=["GET"])
@require_auth
def export_fhir(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Export all user FHIR resources as a FHIR R4 Bundle JSON."""
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    # First, find the Patient resource
    try:
        parent = f"{FHIR_BASE}/fhir"
        search_request = (
            healthcare_service.projects()
            .locations()
            .datasets()
            .fhirStores()
            .fhir()
            .search(
                parent=parent,
                body={
                    "resourceType": "Patient",
                    "identifier": f"https://resohealth.life|{effective_user_id}",
                },
            )
        )
        search_response = search_request.execute()
        patients = search_response.get("entry", [])

        if not patients:
            return jsonify({
                "resourceType": "Bundle",
                "type": "collection",
                "total": 0,
                "entry": [],
            }), 200

        patient_id = patients[0].get("resource", {}).get("id")
    except Exception as exc:
        logger.exception("Failed to search for Patient resource")
        return jsonify({"error": f"Failed to search FHIR store: {exc}"}), 500

    # Fetch all resources for this patient using $everything
    try:
        patient_path = f"{FHIR_BASE}/fhir/Patient/{patient_id}"
        everything_request = (
            healthcare_service.projects()
            .locations()
            .datasets()
            .fhirStores()
            .fhir()
            .PatientEverything(name=patient_path)
        )
        everything_response = everything_request.execute()

        # Build FHIR Bundle
        bundle = {
            "resourceType": "Bundle",
            "type": "collection",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total": everything_response.get("total", len(everything_response.get("entry", []))),
            "entry": everything_response.get("entry", []),
            "meta": {
                "tag": [
                    {
                        "system": "https://resohealth.life/tags",
                        "code": "health-vault-export",
                        "display": "MyData Health Vault Export",
                    }
                ]
            },
        }

        return Response(
            json.dumps(bundle, indent=2, default=str),
            mimetype="application/fhir+json",
            headers={
                "Content-Disposition": f"attachment; filename=ResoHealth_FHIR_Bundle_{datetime.now().strftime('%Y%m%d')}.json",
            },
        )

    except Exception as exc:
        logger.exception("Failed to export FHIR resources")
        return jsonify({"error": f"Failed to export FHIR resources: {exc}"}), 500


# ---------------------------------------------------------------------------
# 3.11 POST /api/mydata/share
# ---------------------------------------------------------------------------
@app.route("/api/mydata/share", methods=["POST"])
@require_auth
def create_share(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Generate time-limited share link.

    Request body:
        {
            "expiresInHours": 72,
            "allowedCategories": ["lab_results", "vitals"],
            "recipientName": "Dr. Smith"
        }
    """
    if share_token:
        return jsonify({"error": "Cannot create share from share token"}), 403

    data = request.get_json(silent=True) or {}

    expires_in_hours = min(720, max(1, int(data.get("expiresInHours", 72))))  # Max 30 days
    allowed_categories = data.get("allowedCategories", [])
    recipient_name = data.get("recipientName", "")

    # Validate categories
    valid_categories = [
        "vitals", "lab_results", "radiology", "outpatient", "inpatient",
        "medications", "triage", "insurance", "epigenetic_bioage",
        "nutrigenomics", "genetic_testing", "longevity_assessment", "wellness_program",
    ]
    if allowed_categories:
        for cat in allowed_categories:
            if cat not in valid_categories:
                return jsonify({"error": f"Invalid category: {cat}"}), 400

    # Generate secure token
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)

    # Store in Firestore
    share_ref = firestore_client.collection("share_tokens").document(token)
    share_ref.set({
        "token": token,
        "userId": user_id,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "expiresAt": expires_at,
        "expiresInHours": expires_in_hours,
        "allowedCategories": allowed_categories,
        "recipientName": recipient_name,
        "accessCount": 0,
    })

    share_url = f"https://go.resohealth.life/my-data/shared?token={token}"

    logger.info("Created share token for user=%s, expires=%s", user_id, expires_at.isoformat())

    return jsonify({
        "shareUrl": share_url,
        "token": token,
        "expiresAt": expires_at.isoformat(),
        "allowedCategories": allowed_categories,
    }), 201


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health_check() -> Tuple[Response, int]:
    """Health check endpoint."""
    return jsonify({"status": "healthy", "service": "mydata-api", "version": "1.0.0"}), 200


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), debug=False)
