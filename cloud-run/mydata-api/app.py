"""
MyData Health Vault API Service
Cloud Run service providing REST API endpoints for the MyData feature.
"""

import io
import json
import logging
import os
import secrets
import threading
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
from vertexai.generative_models import GenerativeModel, GenerationConfig, Part

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

# Resolve signing credentials at startup for signed URL generation on Cloud Run.
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

# Valid document categories
VALID_CATEGORIES = [
    "Vitals", "Lab Results", "Radiology", "Outpatient Notes",
    "Inpatient Notes", "Medications", "Wellness Programs", "Insurance",
    "Epigenetic BioAge", "Nutrigenomics", "Genetic Testing", "Longevity Assessments"
]


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
    """Decorator to extract user identity from headers."""

    @wraps(f)
    def decorated(*args: Any, **kwargs: Any) -> Any:
        share_token = request.headers.get("X-Share-Token")
        if share_token:
            return f(*args, user_id=None, share_token=share_token, **kwargs)

        user_id = request.headers.get("X-User-Id")
        if not user_id:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
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
    expires_at = share_data.get("expiresAt")
    if expires_at and expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return None
    allowed_categories = share_data.get("allowedCategories", [])
    if required_category and allowed_categories and required_category not in allowed_categories:
        return None
    return share_data


# ---------------------------------------------------------------------------
# Helper: Normalize Firestore doc → frontend-expected shape
# ---------------------------------------------------------------------------
def _normalize_doc(doc_data: dict) -> dict:
    """Ensure all frontend-expected fields have safe defaults."""
    # Map backend field names to frontend expected names
    if "filename" in doc_data and "fileName" not in doc_data:
        doc_data["fileName"] = doc_data["filename"]
    if "contentType" in doc_data and "mimeType" not in doc_data:
        doc_data["mimeType"] = doc_data["contentType"]
    if "sizeBytes" in doc_data and "fileSizeBytes" not in doc_data:
        doc_data["fileSizeBytes"] = doc_data["sizeBytes"]
    if "gcsPath" in doc_data and "gcsRawPath" not in doc_data:
        doc_data["gcsRawPath"] = doc_data["gcsPath"]
    # Remap status for frontend
    status_val = doc_data.get("status", "pending")
    if status_val == "uploaded":
        status_val = "ocr_processing"
    doc_data["status"] = status_val
    # Safe defaults
    doc_data.setdefault("category", "Lab Results")
    doc_data.setdefault("subcategories", [])
    doc_data.setdefault("summary", "")
    doc_data.setdefault("keyFindings", [])
    doc_data.setdefault("dateOfService", None)
    doc_data.setdefault("providerName", None)
    doc_data.setdefault("fhirResourceIds", [])
    doc_data.setdefault("aiClassification", None)
    # Serialize timestamps
    for ts_field in ("uploadedAt", "updatedAt"):
        val = doc_data.get(ts_field)
        if val and hasattr(val, "isoformat"):
            doc_data[ts_field] = val.isoformat()
    return doc_data


# ---------------------------------------------------------------------------
# 3.1 Health check
# ---------------------------------------------------------------------------
@app.route("/api/mydata/health", methods=["GET"])
def health_check() -> Tuple[Response, int]:
    return jsonify({"status": "healthy", "version": "2.0.0"}), 200


# ---------------------------------------------------------------------------
# 3.2 POST /api/mydata/upload/request
# ---------------------------------------------------------------------------
@app.route("/api/mydata/upload/request", methods=["POST"])
@require_auth
def upload_request(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Generate a signed URL for direct GCS upload."""
    if share_token:
        return jsonify({"error": "Upload not allowed via share token"}), 403

    data = request.get_json(silent=True) or {}
    filename = data.get("filename")
    content_type = data.get("contentType", "application/pdf")
    size_bytes = data.get("sizeBytes", 0)

    if not filename:
        return jsonify({"error": "filename is required"}), 400

    max_size = 50 * 1024 * 1024  # 50MB
    if size_bytes > max_size:
        return jsonify({"error": f"File too large. Maximum size is {max_size // (1024*1024)} MB"}), 400

    allowed_types = [
        "application/pdf", "image/png", "image/jpeg", "image/tiff",
        "image/gif", "image/bmp", "image/webp",
    ]
    if content_type not in allowed_types:
        return jsonify({"error": f"Unsupported file type: {content_type}"}), 400

    document_id = str(uuid.uuid4())
    gcs_path = f"{user_id}/{document_id}/{filename}"

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

    bucket = storage_client.bucket(UPLOADS_BUCKET)
    blob = bucket.blob(gcs_path)

    try:
        auth_request = google.auth.transport.requests.Request()
        credentials.refresh(auth_request)

        upload_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=30),
            method="PUT",
            content_type=content_type,
            service_account_email=_SERVICE_ACCOUNT_EMAIL,
            access_token=credentials.token,
        )
    except Exception as exc:
        logger.exception("Failed to generate signed URL")
        doc_ref.update({"status": "error", "errorMessage": str(exc)})
        return jsonify({"error": f"Failed to generate upload URL: {exc}"}), 500

    return jsonify({
        "uploadUrl": upload_url,
        "documentId": document_id,
        "gcsPath": f"gs://{UPLOADS_BUCKET}/{gcs_path}",
        "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
    }), 200


# ---------------------------------------------------------------------------
# 3.2b POST /api/mydata/upload/<document_id>/confirm  — triggers processing
# ---------------------------------------------------------------------------
@app.route("/api/mydata/upload/<document_id>/confirm", methods=["POST"])
@require_auth
def confirm_upload(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Confirm upload and trigger async document processing via Gemini Vision."""
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

    doc_data = doc.to_dict()

    # Don't re-process already classified documents
    if doc_data.get("status") in ("classified", "classifying", "ocr_processing"):
        return jsonify({"status": "already_processing", "documentId": document_id}), 200

    # Mark as processing
    doc_ref.update({
        "status": "ocr_processing",
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    logger.info("Upload confirmed, starting processing for user=%s, doc=%s", user_id, document_id)

    # Process asynchronously in a background thread
    thread = threading.Thread(
        target=_process_document_async,
        args=(user_id, document_id, doc_data),
        daemon=True,
    )
    thread.start()

    return jsonify({"status": "processing", "documentId": document_id}), 200


def _process_document_async(user_id: str, document_id: str, doc_data: dict):
    """Background thread: download PDF from GCS → Gemini Vision OCR+classify → save to Firestore."""
    doc_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
        .document(document_id)
    )

    try:
        gcs_path = doc_data.get("gcsPath", "")
        content_type = doc_data.get("contentType", "application/pdf")
        filename = doc_data.get("filename", "document")

        # Download file from GCS
        if gcs_path.startswith("gs://"):
            parts = gcs_path[5:].split("/", 1)
            bucket = storage_client.bucket(parts[0])
            blob = bucket.blob(parts[1])
            file_bytes = blob.download_as_bytes()
        else:
            raise ValueError(f"Invalid GCS path: {gcs_path}")

        logger.info("Downloaded %d bytes for doc=%s", len(file_bytes), document_id)

        doc_ref.update({"status": "classifying", "updatedAt": firestore.SERVER_TIMESTAMP})

        # Use Gemini Vision to OCR + classify in a single call
        model = GenerativeModel("gemini-2.0-flash")

        # Determine MIME type for Gemini
        mime_map = {
            "application/pdf": "application/pdf",
            "image/png": "image/png",
            "image/jpeg": "image/jpeg",
            "image/tiff": "image/tiff",
            "image/webp": "image/webp",
            "image/gif": "image/gif",
            "image/bmp": "image/bmp",
        }
        gemini_mime = mime_map.get(content_type, "application/pdf")

        file_part = Part.from_data(data=file_bytes, mime_type=gemini_mime)

        prompt = f"""You are a medical document analysis AI for ResoHealth Health Vault.
Analyze this uploaded medical document thoroughly.

INSTRUCTIONS:
1. Extract ALL text content from the document (full OCR).
2. Classify the document into exactly ONE of these categories:
   {json.dumps(VALID_CATEGORIES)}
3. Provide a concise summary (2-3 sentences).
4. Extract key findings as a list of short bullet points.
5. Extract the date of service if visible.
6. Extract the provider/doctor name if visible.
7. Extract patient name if visible.

Return your response as valid JSON with this exact structure:
{{
  "fullText": "<complete extracted text from the document>",
  "category": "<one of the valid categories above>",
  "subcategories": ["<relevant subcategory tags>"],
  "summary": "<2-3 sentence summary of the document>",
  "keyFindings": ["<finding 1>", "<finding 2>", ...],
  "dateOfService": "<YYYY-MM-DD or null if not found>",
  "providerName": "<doctor/provider name or null>",
  "patientName": "<patient name or null>",
  "confidence": <0.0 to 1.0 classification confidence>
}}

Be thorough in extracting ALL text. Include lab values, reference ranges, dates, and all medical details.
Return ONLY valid JSON, no markdown formatting."""

        response = model.generate_content(
            [file_part, prompt],
            generation_config=GenerationConfig(
                temperature=0.1,
                max_output_tokens=8192,
                response_mime_type="application/json",
            ),
        )

        result_text = response.text.strip()
        # Clean potential markdown wrapping
        if result_text.startswith("```"):
            result_text = result_text.split("\n", 1)[1] if "\n" in result_text else result_text[3:]
            if result_text.endswith("```"):
                result_text = result_text[:-3].strip()

        analysis = json.loads(result_text)

        # Validate category
        category = analysis.get("category", "Lab Results")
        if category not in VALID_CATEGORIES:
            category = "Lab Results"  # safe default

        # Update Firestore with all extracted data
        update_data = {
            "status": "classified",
            "category": category,
            "subcategories": analysis.get("subcategories", []),
            "summary": analysis.get("summary", ""),
            "keyFindings": analysis.get("keyFindings", []),
            "dateOfService": analysis.get("dateOfService"),
            "providerName": analysis.get("providerName"),
            "patientName": analysis.get("patientName"),
            "ocrText": analysis.get("fullText", ""),
            "aiClassification": {
                "category": category,
                "confidence": analysis.get("confidence", 0.8),
                "subcategories": analysis.get("subcategories", []),
            },
            "updatedAt": firestore.SERVER_TIMESTAMP,
            "processedAt": firestore.SERVER_TIMESTAMP,
        }
        doc_ref.update(update_data)
        logger.info(
            "Document %s classified as '%s' with %d findings",
            document_id, category, len(analysis.get("keyFindings", []))
        )

    except json.JSONDecodeError as jde:
        logger.exception("Failed to parse Gemini response for doc=%s", document_id)
        doc_ref.update({
            "status": "error",
            "errorMessage": f"AI analysis returned invalid JSON: {str(jde)[:200]}",
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
    except Exception as exc:
        logger.exception("Failed to process document %s", document_id)
        doc_ref.update({
            "status": "error",
            "errorMessage": str(exc)[:500],
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })


# ---------------------------------------------------------------------------
# 3.2c POST /api/mydata/process/<document_id>  — manually trigger reprocessing
# ---------------------------------------------------------------------------
@app.route("/api/mydata/process/<document_id>", methods=["POST"])
@require_auth
def reprocess_document(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Manually trigger (re)processing of a document. Useful for stuck docs."""
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

    doc_data = doc.to_dict()

    # Reset status and start processing
    doc_ref.update({
        "status": "ocr_processing",
        "errorMessage": firestore.DELETE_FIELD,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })

    thread = threading.Thread(
        target=_process_document_async,
        args=(user_id, document_id, doc_data),
        daemon=True,
    )
    thread.start()

    return jsonify({"status": "reprocessing", "documentId": document_id}), 200


# ---------------------------------------------------------------------------
# 3.2d POST /api/mydata/process-all  — batch reprocess all unprocessed docs
# ---------------------------------------------------------------------------
@app.route("/api/mydata/process-all", methods=["POST"])
@require_auth
def process_all_documents(
    user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Batch process all documents that are not yet classified."""
    if share_token:
        return jsonify({"error": "Not allowed via share token"}), 403

    docs_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
    )

    all_docs = list(docs_ref.stream())
    queued = []
    for doc in all_docs:
        doc_data = doc.to_dict()
        if doc_data.get("status") not in ("classified",):
            gcs_path = doc_data.get("gcsPath", "")
            # Only process docs that have a valid GCS path
            if gcs_path.startswith("gs://"):
                doc_ref = docs_ref.document(doc.id)
                doc_ref.update({"status": "ocr_processing", "updatedAt": firestore.SERVER_TIMESTAMP})
                thread = threading.Thread(
                    target=_process_document_async,
                    args=(user_id, doc.id, doc_data),
                    daemon=True,
                )
                thread.start()
                queued.append(doc.id)

    return jsonify({
        "queued": len(queued),
        "documentIds": queued,
    }), 200


# ---------------------------------------------------------------------------
# 3.3 GET /api/mydata/documents
# ---------------------------------------------------------------------------
@app.route("/api/mydata/documents", methods=["GET"])
@require_auth
def list_documents(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """List user's documents from Firestore."""
    effective_user_id = user_id
    allowed_categories: Optional[List[str]] = None
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]
        allowed_categories = share_data.get("allowedCategories")

    category = request.args.get("category")
    status = request.args.get("status")
    page = max(1, int(request.args.get("page", 1)))
    limit = min(100, max(1, int(request.args.get("limit", 20))))
    date_from = request.args.get("dateFrom")
    date_to = request.args.get("dateTo")

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
        pass

    if status:
        query = query.where("status", "==", status)

    query = query.order_by("uploadedAt", direction=firestore.Query.DESCENDING)

    offset = (page - 1) * limit
    try:
        docs = list(query.offset(offset).limit(limit + 1).stream())
    except Exception as query_exc:
        logger.warning("Documents query failed: %s", query_exc)
        try:
            fallback_query = (
                firestore_client.collection("users")
                .document(effective_user_id)
                .collection("health_documents")
                .limit(limit + 1)
            )
            docs = list(fallback_query.offset(offset).stream())
        except Exception:
            docs = []

    has_next = len(docs) > limit
    docs = docs[:limit]

    documents = []
    for doc in docs:
        doc_data = doc.to_dict()
        doc_data["id"] = doc_data.get("documentId", doc.id)

        if date_from:
            doc_date = doc_data.get("dateOfService") or ""
            if doc_date and doc_date < date_from:
                continue
        if date_to:
            doc_date = doc_data.get("dateOfService") or ""
            if doc_date and doc_date > date_to:
                continue

        if allowed_categories and doc_data.get("category") not in allowed_categories:
            continue

        if share_token:
            doc_data.pop("gcsPath", None)
            doc_data.pop("ocrOutputPath", None)
            doc_data.pop("classificationPath", None)

        doc_data = _normalize_doc(doc_data)
        documents.append(doc_data)

    return jsonify({
        "items": documents,
        "total": len(documents) + (1 if has_next else 0),
        "page": page,
        "pageSize": limit,
        "hasMore": has_next,
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
    """Get single document detail."""
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
    doc_data = _normalize_doc(doc_data)

    return jsonify(doc_data), 200


# ---------------------------------------------------------------------------
# 3.5 PATCH /api/mydata/documents/<id>
# ---------------------------------------------------------------------------
@app.route("/api/mydata/documents/<document_id>", methods=["PATCH"])
@require_auth
def update_document(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Update document fields (e.g., manual category override)."""
    if share_token:
        return jsonify({"error": "Not allowed via share token"}), 403

    data = request.get_json(silent=True) or {}
    allowed_fields = {"category", "summary", "providerName", "dateOfService", "subcategories"}
    updates = {k: v for k, v in data.items() if k in allowed_fields}

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    doc_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
        .document(document_id)
    )
    doc = doc_ref.get()
    if not doc.exists:
        return jsonify({"error": "Document not found"}), 404

    updates["updatedAt"] = firestore.SERVER_TIMESTAMP
    doc_ref.update(updates)

    return jsonify({"status": "updated", "documentId": document_id}), 200


# ---------------------------------------------------------------------------
# 3.6 DELETE /api/mydata/documents/<id>
# ---------------------------------------------------------------------------
@app.route("/api/mydata/documents/<document_id>", methods=["DELETE"])
@require_auth
def delete_document(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Delete a document and its GCS files."""
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

    doc_data = doc.to_dict()

    # Delete from GCS
    gcs_path = doc_data.get("gcsPath", "")
    if gcs_path.startswith("gs://"):
        try:
            parts = gcs_path[5:].split("/", 1)
            bucket = storage_client.bucket(parts[0])
            blob = bucket.blob(parts[1])
            blob.delete()
        except Exception as exc:
            logger.warning("Failed to delete GCS object %s: %s", gcs_path, exc)

    doc_ref.delete()
    return jsonify({"status": "deleted", "documentId": document_id}), 200


# ---------------------------------------------------------------------------
# 3.6b GET /api/mydata/documents/<id>/file — serve document file via signed URL
# ---------------------------------------------------------------------------
@app.route("/api/mydata/documents/<document_id>/file", methods=["GET"])
@require_auth
def get_document_file(
    document_id: str, user_id: str, share_token: Optional[str] = None
) -> Tuple[Response, int]:
    """Generate a short-lived signed URL for the original document file."""
    from flask import redirect

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
    gcs_path = doc_data.get("gcsRawPath") or doc_data.get("gcsPath") or ""
    if not gcs_path:
        return jsonify({"error": "No file associated with this document"}), 404

    # Strip gs://bucket-name/ prefix if present
    if gcs_path.startswith("gs://"):
        # gs://bucket-name/path/to/file -> path/to/file
        parts = gcs_path.replace("gs://", "").split("/", 1)
        bucket_name = parts[0]
        blob_path = parts[1] if len(parts) > 1 else ""
        bucket = storage_client.bucket(bucket_name)
    else:
        blob_path = gcs_path
        bucket = storage_client.bucket(UPLOADS_BUCKET)

    blob = bucket.blob(blob_path)

    if not blob.exists():
        return jsonify({"error": "File not found in storage"}), 404

    content_type = doc_data.get("contentType", doc_data.get("mimeType", "application/octet-stream"))

    # Return a signed URL (valid 15 min) so the browser can fetch the file directly
    try:
        # On Cloud Run, default credentials are Compute Engine credentials which
        # cannot sign directly. Use access_token + service_account_email approach.
        auth_req = google.auth.transport.requests.Request()
        credentials, _project = google.auth.default()
        credentials.refresh(auth_req)
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=15),
            method="GET",
            response_type=content_type,
            service_account_email=credentials.service_account_email,
            access_token=credentials.token,
        )
        # If ?redirect=true, redirect the browser directly to the signed URL
        if request.args.get("redirect") == "true":
            return redirect(signed_url, code=302)

        return jsonify({
            "url": signed_url,
            "contentType": content_type,
            "fileName": doc_data.get("fileName", doc_data.get("filename", "document")),
            "expiresIn": 900,  # 15 minutes
        }), 200
    except Exception as e:
        logger.exception("Failed to generate signed URL for doc=%s", document_id)
        return jsonify({"error": f"Failed to generate file URL: {str(e)}"}), 500


# ---------------------------------------------------------------------------
# 3.7 GET /api/mydata/insights
# ---------------------------------------------------------------------------
@app.route("/api/mydata/insights", methods=["GET"])
@require_auth
def get_insights(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Generate AI insights using Vertex AI Gemini from classified documents."""
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    # Fetch all documents (classified or not) to build context
    try:
        docs_query = (
            firestore_client.collection("users")
            .document(effective_user_id)
            .collection("health_documents")
            .order_by("uploadedAt", direction=firestore.Query.DESCENDING)
            .limit(50)
        )
        docs = list(docs_query.stream())
    except Exception as query_exc:
        logger.warning("Insights query failed: %s", query_exc)
        try:
            docs = list(
                firestore_client.collection("users")
                .document(effective_user_id)
                .collection("health_documents")
                .limit(50)
                .stream()
            )
        except Exception:
            docs = []

    # Filter to classified docs
    classified_docs = []
    for doc in docs:
        d = doc.to_dict()
        if d.get("status") == "classified":
            classified_docs.append(d)

    if not classified_docs:
        return jsonify({
            "insights": [],
            "summary": "No analyzed documents found. Upload medical documents to receive AI-powered health insights.",
            "documentCount": 0,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }), 200

    # Build context from classified documents
    doc_summaries = []
    for d in classified_docs:
        doc_summaries.append({
            "category": d.get("category", "unknown"),
            "summary": d.get("summary", ""),
            "keyFindings": d.get("keyFindings", []),
            "ocrText": (d.get("ocrText", "") or "")[:2000],  # truncate for context
            "dateOfService": d.get("dateOfService", ""),
            "providerName": d.get("providerName", ""),
        })

    context = json.dumps(doc_summaries, indent=2, default=str)

    prompt = f"""You are a medical health insights AI for ResoHealth's Health Vault.
Analyze the following collection of medical documents for a single patient and generate health insights.

MEDICAL DOCUMENTS:
{context}

Generate a JSON response with this structure:
{{
  "overallHealthSummary": "<2-3 paragraph health summary>",
  "insights": [
    {{
      "id": "<unique-id>",
      "type": "<trend|anomaly|reminder|recommendation|summary>",
      "title": "<short title>",
      "description": "<detailed description>",
      "severity": "<info|warning|action-needed>",
      "relatedDocuments": [],
      "generatedAt": "{datetime.now(timezone.utc).isoformat()}"
    }}
  ],
  "trends": [
    {{
      "metric": "<metric name>",
      "direction": "<improving|stable|declining>",
      "description": "<trend description>"
    }}
  ],
  "preventiveRecommendations": [
    {{
      "title": "<recommendation>",
      "priority": "<low|medium|high>",
      "description": "<details>"
    }}
  ]
}}

Be thorough, evidence-based, and include actionable recommendations.
IMPORTANT: This is NOT medical advice. Always recommend consulting a healthcare professional.
Return valid JSON only."""

    try:
        model = GenerativeModel(MODEL_ID)
        response = model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                temperature=0.3,
                max_output_tokens=8192,
                response_mime_type="application/json",
            ),
        )

        insights_text = response.text.strip()
        insights_data = json.loads(insights_text)

        # Ensure insights array has required fields
        for insight in insights_data.get("insights", []):
            insight.setdefault("id", str(uuid.uuid4())[:8])
            insight.setdefault("type", "summary")
            insight.setdefault("severity", "info")
            insight.setdefault("relatedDocuments", [])
            insight.setdefault("generatedAt", datetime.now(timezone.utc).isoformat())

        return jsonify({
            "insights": insights_data.get("insights", []),
            "summary": insights_data.get("overallHealthSummary", ""),
            "trends": insights_data.get("trends", []),
            "preventiveRecommendations": insights_data.get("preventiveRecommendations", []),
            "documentCount": len(classified_docs),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }), 200

    except Exception as exc:
        logger.exception("Failed to generate insights")
        return jsonify({
            "insights": [],
            "summary": f"Unable to generate insights at this time. Error: {str(exc)[:200]}",
            "documentCount": len(classified_docs),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }), 200  # Return 200 with empty insights rather than 500


# ---------------------------------------------------------------------------
# 3.8 POST /api/mydata/insights/ask
# ---------------------------------------------------------------------------
@app.route("/api/mydata/insights/ask", methods=["POST"])
@require_auth
def ask_ai(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Ask AI a health question based on uploaded documents."""
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    data = request.get_json(silent=True) or {}
    question = data.get("question", "").strip()

    if not question:
        return jsonify({"error": "Question is required"}), 400

    # Fetch classified documents for context
    try:
        docs = list(
            firestore_client.collection("users")
            .document(effective_user_id)
            .collection("health_documents")
            .limit(50)
            .stream()
        )
    except Exception:
        docs = []

    classified = [d.to_dict() for d in docs if d.to_dict().get("status") == "classified"]

    if not classified:
        return jsonify({
            "answer": "I don't have any analyzed health documents to reference. Please upload your medical documents first.",
            "sources": [],
        }), 200

    context_parts = []
    for d in classified:
        context_parts.append(
            f"--- {d.get('category', 'Unknown')} ({d.get('filename', 'document')}) ---\n"
            f"Summary: {d.get('summary', 'N/A')}\n"
            f"Key Findings: {', '.join(d.get('keyFindings', []))}\n"
            f"Full Text: {(d.get('ocrText', '') or '')[:1500]}\n"
        )

    context = "\n".join(context_parts)

    prompt = f"""You are a helpful medical AI assistant for ResoHealth Health Vault.
Answer the user's health question based on their uploaded medical documents.

PATIENT'S MEDICAL DOCUMENTS:
{context}

USER'S QUESTION: {question}

IMPORTANT RULES:
- Base your answer ONLY on the information in the documents above.
- If the documents don't contain relevant information, say so.
- This is NOT a diagnosis. Always recommend consulting a healthcare professional.
- Be specific and reference actual values from the documents.
- Be concise but thorough.

Provide your answer as JSON:
{{
  "answer": "<your detailed answer>",
  "sources": [
    {{
      "documentId": "<doc id if available>",
      "documentName": "<filename>",
      "relevantExcerpt": "<relevant text from the document>"
    }}
  ]
}}"""

    try:
        model = GenerativeModel(MODEL_ID)
        response = model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                temperature=0.2,
                max_output_tokens=4096,
                response_mime_type="application/json",
            ),
        )

        result = json.loads(response.text.strip())
        return jsonify(result), 200

    except Exception as exc:
        logger.exception("Failed to answer AI question")
        return jsonify({
            "answer": f"I encountered an error processing your question. Please try again. ({str(exc)[:100]})",
            "sources": [],
        }), 200


# ---------------------------------------------------------------------------
# 3.9 Share links
# ---------------------------------------------------------------------------
@app.route("/api/mydata/share", methods=["POST"])
@require_auth
def create_share_link(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Create a share link for specific document categories."""
    if share_token:
        return jsonify({"error": "Cannot create share from shared access"}), 403

    data = request.get_json(silent=True) or {}
    categories = data.get("categories", [])
    expires_hours = data.get("expiresHours", 48)

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_hours)

    firestore_client.collection("share_tokens").document(token).set({
        "userId": user_id,
        "allowedCategories": categories,
        "expiresAt": expires_at,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })

    share_url = f"https://go.resohealth.life/my-data/shared/{token}"

    return jsonify({
        "shareUrl": share_url,
        "token": token,
        "expiresAt": expires_at.isoformat(),
    }), 200


# ---------------------------------------------------------------------------
# 3.10 Export
# ---------------------------------------------------------------------------
@app.route("/api/mydata/export/pdf", methods=["POST"])
@require_auth
def export_pdf(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Export health data as PDF report."""
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    data = request.get_json(silent=True) or {}
    categories = data.get("categories", [])

    # Fetch documents
    query = (
        firestore_client.collection("users")
        .document(effective_user_id)
        .collection("health_documents")
    )

    try:
        docs = list(query.stream())
    except Exception:
        docs = []

    documents = []
    for doc in docs:
        d = doc.to_dict()
        if categories and d.get("category") not in categories:
            continue
        documents.append(d)

    # Build PDF
    buffer = io.BytesIO()
    pdf_doc = SimpleDocTemplate(buffer, pagesize=A4,
                                 topMargin=20*mm, bottomMargin=20*mm,
                                 leftMargin=15*mm, rightMargin=15*mm)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CustomTitle", parent=styles["Title"],
        fontSize=18, textColor=colors.HexColor("#0d9488"),
        spaceAfter=10*mm,
    )
    heading_style = ParagraphStyle(
        "CustomHeading", parent=styles["Heading2"],
        fontSize=13, textColor=colors.HexColor("#1f2937"),
        spaceAfter=3*mm, spaceBefore=5*mm,
    )
    body_style = ParagraphStyle(
        "CustomBody", parent=styles["Normal"],
        fontSize=10, leading=14,
    )

    elements = []
    elements.append(Paragraph("ResoHealth — Health Vault Report", title_style))
    elements.append(Paragraph(
        f"Generated: {datetime.now(timezone.utc).strftime('%B %d, %Y')} | "
        f"Vault ID: {effective_user_id} | "
        f"Documents: {len(documents)}",
        body_style
    ))
    elements.append(Spacer(1, 8*mm))

    for i, d in enumerate(documents, 1):
        elements.append(Paragraph(
            f"{i}. {d.get('filename', 'Document')} — {d.get('category', 'Uncategorized')}",
            heading_style
        ))
        if d.get("summary"):
            elements.append(Paragraph(f"Summary: {d['summary']}", body_style))
        if d.get("keyFindings"):
            for finding in d["keyFindings"]:
                elements.append(Paragraph(f"• {finding}", body_style))
        if d.get("dateOfService"):
            elements.append(Paragraph(f"Date of Service: {d['dateOfService']}", body_style))
        if d.get("providerName"):
            elements.append(Paragraph(f"Provider: {d['providerName']}", body_style))
        elements.append(Spacer(1, 4*mm))

    elements.append(Spacer(1, 10*mm))
    elements.append(Paragraph(
        "DISCLAIMER: This report is generated automatically. "
        "AI-generated summaries are not medical advice. "
        "Always consult a healthcare professional.",
        ParagraphStyle("Disclaimer", parent=body_style, fontSize=8, textColor=colors.grey)
    ))

    pdf_doc.build(elements)

    pdf_bytes = buffer.getvalue()
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=ResoHealth_HealthVault_{datetime.now().strftime('%Y%m%d')}.pdf",
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@app.route("/api/mydata/export/fhir", methods=["POST"])
@require_auth
def export_fhir(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Export health data as FHIR R4 Bundle JSON."""
    effective_user_id = user_id
    if share_token:
        share_data = _validate_share_access(share_token)
        if not share_data:
            return jsonify({"error": "Invalid or expired share token"}), 403
        effective_user_id = share_data["userId"]

    data = request.get_json(silent=True) or {}
    categories = data.get("categories", [])

    try:
        docs = list(
            firestore_client.collection("users")
            .document(effective_user_id)
            .collection("health_documents")
            .stream()
        )
    except Exception:
        docs = []

    entries = []
    for doc in docs:
        d = doc.to_dict()
        if categories and d.get("category") not in categories:
            continue

        entry = {
            "resource": {
                "resourceType": "DocumentReference",
                "id": d.get("documentId", doc.id),
                "status": "current" if d.get("status") == "classified" else "preliminary",
                "type": {
                    "coding": [{
                        "system": "http://loinc.org",
                        "display": d.get("category", "Medical Document"),
                    }]
                },
                "description": d.get("summary", ""),
                "date": d.get("uploadedAt", "").isoformat() if hasattr(d.get("uploadedAt", ""), "isoformat") else str(d.get("uploadedAt", "")),
                "content": [{
                    "attachment": {
                        "contentType": d.get("contentType", "application/pdf"),
                        "title": d.get("filename", "document"),
                    }
                }],
            },
            "request": {
                "method": "PUT",
                "url": f"DocumentReference/{d.get('documentId', doc.id)}",
            },
        }
        entries.append(entry)

    bundle = {
        "resourceType": "Bundle",
        "type": "transaction",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "entry": entries,
    }

    return Response(
        json.dumps(bundle, indent=2, default=str),
        mimetype="application/fhir+json",
        headers={
            "Content-Disposition": f"attachment; filename=ResoHealth_FHIR_{datetime.now().strftime('%Y%m%d')}.json",
        },
    )


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------

DOCTOR_EMAIL: str = "vas@1lifehealthcare.co"
DUBAI_TZ_OFFSET: int = 4  # UTC+4
# Clinic slots: 16:00 – 19:00 Dubai time, 30-min increments
_SLOT_STARTS: List[str] = ["16:00", "16:30", "17:00", "17:30", "18:00", "18:30"]


def _slot_end(start: str) -> str:
    """Return HH:MM end time 30 minutes after start (HH:MM)."""
    h, m = map(int, start.split(":"))
    dt = datetime(2000, 1, 1, h, m) + timedelta(minutes=30)
    return dt.strftime("%H:%M")


def _now_dubai() -> datetime:
    """Return current datetime in Dubai timezone (UTC+4) as an aware datetime."""
    dubai_tz = timezone(timedelta(hours=DUBAI_TZ_OFFSET))
    return datetime.now(dubai_tz)


def _appointment_to_dict(doc_data: dict) -> dict:
    """Serialize appointment Firestore doc to JSON-safe dict."""
    for ts_field in ("createdAt", "updatedAt"):
        val = doc_data.get(ts_field)
        if val and hasattr(val, "isoformat"):
            doc_data[ts_field] = val.isoformat()
    return doc_data


@app.route("/api/appointments/slots", methods=["GET"])
def get_appointment_slots() -> Tuple[Response, int]:
    """Return available 30-min slots for a given date (Dubai time 16:00–19:00)."""
    date_str = request.args.get("date")
    if not date_str:
        return jsonify({"error": "date query parameter is required (YYYY-MM-DD)"}), 400

    # Validate date format
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400

    # Fetch existing (non-cancelled/non-archived) appointments on this date
    try:
        existing_docs = (
            firestore_client.collection("appointments")
            .where("date", "==", date_str)
            .stream()
        )
        booked_starts = set()
        for doc in existing_docs:
            apt = doc.to_dict()
            if apt.get("status") not in ("cancelled", "archived"):
                booked_starts.add(apt.get("startTime"))
    except Exception as exc:
        logger.exception("Failed to query appointments for date=%s", date_str)
        return jsonify({"error": f"Failed to retrieve slots: {exc}"}), 500

    slots = []
    for start in _SLOT_STARTS:
        slots.append({
            "start": start,
            "end": _slot_end(start),
            "available": start not in booked_starts,
        })

    return jsonify({"date": date_str, "slots": slots}), 200


@app.route("/api/appointments/book", methods=["POST"])
def book_appointment() -> Tuple[Response, int]:
    """Book a 30-min appointment slot."""
    data = request.get_json(silent=True) or {}

    required_fields = ["date", "startTime", "patientName", "patientEmail", "patientPhone"]
    missing = [f for f in required_fields if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    date_str: str = data["date"]
    start_time: str = data["startTime"]

    # Validate date
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400

    # Validate slot
    if start_time not in _SLOT_STARTS:
        return jsonify({"error": f"Invalid slot. Must be one of: {_SLOT_STARTS}"}), 400

    # Double-check availability in Firestore (race-condition guard)
    try:
        conflict_docs = (
            firestore_client.collection("appointments")
            .where("date", "==", date_str)
            .where("startTime", "==", start_time)
            .stream()
        )
        for doc in conflict_docs:
            apt = doc.to_dict()
            if apt.get("status") not in ("cancelled", "archived"):
                return jsonify({"error": "Slot is no longer available"}), 409
    except Exception as exc:
        logger.exception("Availability double-check failed")
        return jsonify({"error": f"Failed to verify slot availability: {exc}"}), 500

    appointment_id = str(uuid.uuid4())
    end_time = _slot_end(start_time)
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Create Google Calendar event with Meet link ───────────────────
    meet_link = ""
    calendar_event_id = ""
    try:
        cal_credentials, _proj = google.auth.default(
            scopes=["https://www.googleapis.com/auth/calendar"]
        )
        cal_service = discovery.build("calendar", "v3", credentials=cal_credentials)

        # Build ISO datetime strings in Dubai timezone (UTC+4)
        start_dt = f"{date_str}T{start_time}:00+04:00"
        end_dt = f"{date_str}T{end_time}:00+04:00"

        patient_name = data["patientName"]
        patient_email = data["patientEmail"]
        consult_type = data.get("consultationType", "2nd_opinion").replace("_", " ").title()

        event_body = {
            "summary": f"ResoHealth Consult — {patient_name}",
            "description": (
                f"Doctor Consultation ({consult_type})\n\n"
                f"Patient: {patient_name}\n"
                f"Email: {patient_email}\n"
                f"Phone: {data.get('patientCountryCode', '')} {data['patientPhone']}\n"
                f"Notes: {data.get('notes', 'None')}\n\n"
                f"Doctor: Dr. Vas Metupalle\n"
                f"Appointment ID: {appointment_id}\n\n"
                f"This is a 30-minute consultation via Google Meet.\n"
                f"Patient health data: https://go.resohealth.life/my-data"
            ),
            "start": {"dateTime": start_dt, "timeZone": "Asia/Dubai"},
            "end": {"dateTime": end_dt, "timeZone": "Asia/Dubai"},
            "attendees": [
                {"email": DOCTOR_EMAIL, "displayName": "Dr. Vas Metupalle"},
                {"email": patient_email, "displayName": patient_name},
            ],
            "conferenceData": {
                "createRequest": {
                    "requestId": appointment_id,
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "email", "minutes": 60},
                    {"method": "popup", "minutes": 15},
                ],
            },
            "guestsCanModify": False,
            "guestsCanSeeOtherGuests": False,
        }

        created_event = (
            cal_service.events()
            .insert(
                calendarId="primary",
                body=event_body,
                conferenceDataVersion=1,
                sendUpdates="all",  # sends invite emails to all attendees
            )
            .execute()
        )

        calendar_event_id = created_event.get("id", "")
        # Extract the Meet link from conferenceData
        conf_data = created_event.get("conferenceData", {})
        entry_points = conf_data.get("entryPoints", [])
        for ep in entry_points:
            if ep.get("entryPointType") == "video":
                meet_link = ep.get("uri", "")
                break
        if not meet_link:
            meet_link = created_event.get("hangoutLink", "")

        logger.info("Calendar event created: id=%s meet=%s", calendar_event_id, meet_link)
    except Exception as cal_exc:
        logger.warning("Google Calendar event creation failed (non-fatal): %s", cal_exc)
        # Non-fatal — appointment is still created, just without a real Meet link
        meet_link = f"https://meet.google.com/lookup/{appointment_id}"

    appointment = {
        "id": appointment_id,
        "patientEmail": data["patientEmail"],
        "patientName": data["patientName"],
        "patientPhone": data["patientPhone"],
        "patientCountryCode": data.get("patientCountryCode", ""),
        "patientUserId": data.get("patientUserId") or None,
        "patientVaultId": data.get("patientVaultId") or None,
        "doctorEmail": DOCTOR_EMAIL,
        "date": date_str,
        "startTime": start_time,
        "endTime": end_time,
        "status": "confirmed",
        "googleMeetLink": meet_link,
        "googleCalendarEventId": calendar_event_id,
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "notes": data.get("notes", ""),
        "consultationType": data.get("consultationType", "2nd_opinion"),
    }

    try:
        firestore_client.collection("appointments").document(appointment_id).set(appointment)
    except Exception as exc:
        logger.exception("Failed to create appointment")
        return jsonify({"error": f"Failed to create appointment: {exc}"}), 500

    return jsonify(appointment), 201


@app.route("/api/appointments/my", methods=["GET"])
@require_auth
def get_my_appointments(user_id: str, share_token: Optional[str] = None) -> Tuple[Response, int]:
    """Return all appointments for the authenticated user, with auto status expiry."""
    if share_token:
        return jsonify({"error": "Not allowed via share token"}), 403

    # Fetch patient email from Firestore user profile (best-effort)
    patient_email: Optional[str] = None
    try:
        user_doc = firestore_client.collection("users").document(user_id).get()
        if user_doc.exists:
            patient_email = user_doc.to_dict().get("email")
    except Exception:
        pass  # Proceed without email filter if lookup fails

    # Query by patientUserId
    appointments: Dict[str, dict] = {}
    try:
        for doc in (
            firestore_client.collection("appointments")
            .where("patientUserId", "==", user_id)
            .stream()
        ):
            apt = doc.to_dict()
            appointments[doc.id] = apt
    except Exception as exc:
        logger.warning("patientUserId query failed: %s", exc)

    # Also query by patientEmail if available
    if patient_email:
        try:
            for doc in (
                firestore_client.collection("appointments")
                .where("patientEmail", "==", patient_email)
                .stream()
            ):
                apt = doc.to_dict()
                appointments[doc.id] = apt  # deduplicate by doc id
        except Exception as exc:
            logger.warning("patientEmail query failed: %s", exc)

    now_dubai = _now_dubai()
    updated_appointments: List[dict] = []

    for apt in appointments.values():
        current_status = apt.get("status", "confirmed")

        # Only auto-expire/archive "confirmed" and "expired" statuses
        if current_status in ("confirmed", "expired"):
            try:
                apt_date = apt.get("date", "")
                apt_start = apt.get("startTime", "")
                # Parse appointment start as Dubai time
                dubai_tz = timezone(timedelta(hours=DUBAI_TZ_OFFSET))
                apt_dt = datetime.strptime(f"{apt_date} {apt_start}", "%Y-%m-%d %H:%M").replace(
                    tzinfo=dubai_tz
                )
                apt_end_30 = apt_dt + timedelta(minutes=30)
                apt_end_60 = apt_dt + timedelta(minutes=60)

                doc_ref = firestore_client.collection("appointments").document(apt["id"])
                if current_status == "confirmed" and now_dubai > apt_end_30:
                    new_status = "expired"
                    doc_ref.update({"status": new_status, "updatedAt": datetime.now(timezone.utc).isoformat()})
                    apt["status"] = new_status
                elif current_status == "expired" and now_dubai > apt_end_60:
                    new_status = "archived"
                    doc_ref.update({"status": new_status, "updatedAt": datetime.now(timezone.utc).isoformat()})
                    apt["status"] = new_status
            except Exception as exc:
                logger.warning("Status auto-update failed for apt %s: %s", apt.get("id"), exc)

        updated_appointments.append(_appointment_to_dict(apt))

    # Sort by date DESC, then startTime ASC
    updated_appointments.sort(
        key=lambda a: (a.get("date", ""), a.get("startTime", "")),
        reverse=False,
    )
    # Re-sort: date DESC, startTime ASC requires a custom key
    updated_appointments.sort(
        key=lambda a: (-int(a.get("date", "2000-01-01").replace("-", "")), a.get("startTime", ""))
    )

    return jsonify({"appointments": updated_appointments}), 200


@app.route("/api/appointments/all", methods=["GET"])
def get_all_appointments() -> Tuple[Response, int]:
    """Doctor endpoint: return all appointments, optionally filtered by date and/or status."""
    doctor_email = request.args.get("doctorEmail")
    if not doctor_email:
        return jsonify({"error": "doctorEmail query parameter is required"}), 400

    date_filter = request.args.get("date")  # optional YYYY-MM-DD
    status_filter = request.args.get("status")  # optional comma-separated statuses
    status_list: Optional[List[str]] = (
        [s.strip() for s in status_filter.split(",")] if status_filter else None
    )

    try:
        query = (
            firestore_client.collection("appointments")
            .where("doctorEmail", "==", doctor_email)
        )
        if date_filter:
            query = query.where("date", "==", date_filter)

        docs = list(query.stream())
    except Exception as exc:
        logger.exception("Failed to query all appointments")
        return jsonify({"error": f"Failed to retrieve appointments: {exc}"}), 500

    appointments: List[dict] = []
    for doc in docs:
        apt = doc.to_dict()
        if status_list and apt.get("status") not in status_list:
            continue
        appointments.append(_appointment_to_dict(apt))

    # Sort: date DESC, startTime ASC
    appointments.sort(
        key=lambda a: (-int(a.get("date", "2000-01-01").replace("-", "")), a.get("startTime", ""))
    )

    return jsonify({"appointments": appointments, "total": len(appointments)}), 200


@app.route("/api/appointments/<appointment_id>/status", methods=["PATCH"])
def update_appointment_status(appointment_id: str) -> Tuple[Response, int]:
    """Update the status of an appointment."""
    data = request.get_json(silent=True) or {}
    new_status = data.get("status")
    valid_statuses = ("completed", "cancelled", "archived")
    if new_status not in valid_statuses:
        return jsonify({"error": f"Invalid status. Must be one of: {list(valid_statuses)}"}), 400

    doc_ref = firestore_client.collection("appointments").document(appointment_id)
    doc = doc_ref.get()
    if not doc.exists:
        return jsonify({"error": "Appointment not found"}), 404

    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        doc_ref.update({"status": new_status, "updatedAt": now_iso})
    except Exception as exc:
        logger.exception("Failed to update appointment status")
        return jsonify({"error": f"Failed to update status: {exc}"}), 500

    apt = doc.to_dict()

    # If cancelled, try to delete the Google Calendar event
    if new_status == "cancelled":
        cal_event_id = apt.get("googleCalendarEventId", "")
        if cal_event_id:
            try:
                cal_creds, _ = google.auth.default(
                    scopes=["https://www.googleapis.com/auth/calendar"]
                )
                cal_svc = discovery.build("calendar", "v3", credentials=cal_creds)
                cal_svc.events().delete(
                    calendarId="primary",
                    eventId=cal_event_id,
                    sendUpdates="all",
                ).execute()
                logger.info("Calendar event deleted: %s", cal_event_id)
            except Exception as cal_del_exc:
                logger.warning("Failed to delete calendar event (non-fatal): %s", cal_del_exc)

    apt["status"] = new_status
    apt["updatedAt"] = now_iso
    return jsonify(_appointment_to_dict(apt)), 200


@app.route("/api/appointments/<appointment_id>", methods=["GET"])
def get_appointment(appointment_id: str) -> Tuple[Response, int]:
    """Return full details for a single appointment."""
    doc_ref = firestore_client.collection("appointments").document(appointment_id)
    doc = doc_ref.get()
    if not doc.exists:
        return jsonify({"error": "Appointment not found"}), 404

    apt = doc.to_dict()
    return jsonify(_appointment_to_dict(apt)), 200


@app.route("/api/appointments/<appointment_id>/calendar-update", methods=["PATCH"])
def update_appointment_calendar(appointment_id: str) -> Tuple[Response, int]:
    """Update the Google Meet link and Calendar event ID on an appointment."""
    data = request.get_json(silent=True) or {}
    doc_ref = firestore_client.collection("appointments").document(appointment_id)
    doc = doc_ref.get()
    if not doc.exists:
        return jsonify({"error": "Appointment not found"}), 404

    updates: Dict[str, Any] = {"updatedAt": datetime.now(timezone.utc).isoformat()}
    if data.get("googleMeetLink"):
        updates["googleMeetLink"] = data["googleMeetLink"]
    if data.get("googleCalendarEventId"):
        updates["googleCalendarEventId"] = data["googleCalendarEventId"]

    try:
        doc_ref.update(updates)
    except Exception as exc:
        logger.exception("Failed to update calendar info")
        return jsonify({"error": f"Failed to update: {exc}"}), 500

    apt = doc.to_dict()
    apt.update(updates)
    return jsonify(_appointment_to_dict(apt)), 200


# CORS preflight for appointment routes
@app.route("/api/appointments/<path:path>", methods=["OPTIONS"])
def handle_appointments_options(path: str) -> Response:
    """Handle CORS preflight for appointment endpoints."""
    return Response("", status=204)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
