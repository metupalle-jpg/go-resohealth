"""
Cloud Function: process-upload
Triggered by GCS OBJECT_FINALIZE on gs://resohealth-mydata-uploads.
Performs OCR via Document AI, stores results, triggers classification.
"""

import json
import logging
import os
from typing import Any, Dict, Optional

import functions_framework
from cloudevents.http import CloudEvent
from google.cloud import documentai_v1 as documentai
from google.cloud import firestore
from google.cloud import pubsub_v1
from google.cloud import storage

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ID: str = os.environ.get("GCP_PROJECT", "dave-487819")
DOCAI_LOCATION: str = os.environ.get("DOCAI_LOCATION", "us")
DOCAI_PROCESSOR_ID: str = os.environ.get("DOCAI_PROCESSOR_ID", "")
PROCESSED_BUCKET: str = os.environ.get("PROCESSED_BUCKET", "resohealth-mydata-processed")
OCR_COMPLETE_TOPIC: str = os.environ.get("OCR_COMPLETE_TOPIC", "mydata-ocr-complete")
MAX_FILE_SIZE_MB: int = int(os.environ.get("MAX_FILE_SIZE_MB", "20"))

# ---------------------------------------------------------------------------
# Clients (initialised at module level for reuse across invocations)
# ---------------------------------------------------------------------------
storage_client = storage.Client(project=PROJECT_ID)
firestore_client = firestore.Client(project=PROJECT_ID)
publisher = pubsub_v1.PublisherClient()
docai_client = documentai.DocumentProcessorServiceClient()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("process-upload")

# Supported MIME types for Document AI
SUPPORTED_MIME_TYPES: Dict[str, str] = {
    "application/pdf": "application/pdf",
    "image/png": "image/png",
    "image/jpeg": "image/jpeg",
    "image/tiff": "image/tiff",
    "image/gif": "image/gif",
    "image/bmp": "image/bmp",
    "image/webp": "image/webp",
}


def _parse_gcs_path(name: str) -> Optional[Dict[str, str]]:
    """Parse GCS object name to extract userId, documentId, filename.

    Expected path format: {userId}/{documentId}/{filename}
    """
    parts = name.split("/")
    if len(parts) < 3:
        return None
    return {
        "userId": parts[0],
        "documentId": parts[1],
        "filename": "/".join(parts[2:]),
    }


def _update_firestore_status(
    user_id: str,
    document_id: str,
    status: str,
    extra_fields: Optional[Dict[str, Any]] = None,
) -> None:
    """Update Firestore document status and optional extra fields."""
    doc_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
        .document(document_id)
    )
    update_data: Dict[str, Any] = {
        "status": status,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    if extra_fields:
        update_data.update(extra_fields)
    doc_ref.update(update_data)
    logger.info("Firestore updated: users/%s/health_documents/%s → status=%s", user_id, document_id, status)


def _detect_mime_type(filename: str, blob_content_type: Optional[str]) -> str:
    """Determine the MIME type of the uploaded file."""
    if blob_content_type and blob_content_type in SUPPORTED_MIME_TYPES:
        return blob_content_type

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    ext_map = {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "tiff": "image/tiff",
        "tif": "image/tiff",
        "gif": "image/gif",
        "bmp": "image/bmp",
        "webp": "image/webp",
    }
    return ext_map.get(ext, "application/pdf")


def _run_ocr(file_content: bytes, mime_type: str) -> documentai.Document:
    """Send document to Document AI OCR processor and return the Document."""
    processor_name = docai_client.processor_path(PROJECT_ID, DOCAI_LOCATION, DOCAI_PROCESSOR_ID)

    raw_document = documentai.RawDocument(content=file_content, mime_type=mime_type)
    request = documentai.ProcessRequest(name=processor_name, raw_document=raw_document)

    result = docai_client.process_document(request=request)
    return result.document


def _extract_ocr_data(document: documentai.Document) -> Dict[str, Any]:
    """Extract structured OCR data from the Document AI response."""
    full_text: str = document.text or ""

    # Per-page text
    pages_data = []
    for page in document.pages:
        page_text_segments = []
        if page.layout and page.layout.text_anchor and page.layout.text_anchor.text_segments:
            for segment in page.layout.text_anchor.text_segments:
                start = int(segment.start_index) if segment.start_index else 0
                end = int(segment.end_index) if segment.end_index else 0
                page_text_segments.append(full_text[start:end])

        page_info: Dict[str, Any] = {
            "pageNumber": page.page_number,
            "width": page.dimension.width if page.dimension else 0,
            "height": page.dimension.height if page.dimension else 0,
            "text": "".join(page_text_segments),
        }

        # Detected entities on this page
        detected_languages = []
        if page.detected_languages:
            for lang in page.detected_languages:
                detected_languages.append({
                    "languageCode": lang.language_code,
                    "confidence": lang.confidence,
                })
        page_info["detectedLanguages"] = detected_languages

        # Tables
        tables = []
        if page.tables:
            for table in page.tables:
                table_data: Dict[str, Any] = {"headerRows": [], "bodyRows": []}
                for header_row in table.header_rows:
                    row_cells = []
                    for cell in header_row.cells:
                        cell_text = ""
                        if cell.layout and cell.layout.text_anchor and cell.layout.text_anchor.text_segments:
                            for seg in cell.layout.text_anchor.text_segments:
                                s = int(seg.start_index) if seg.start_index else 0
                                e = int(seg.end_index) if seg.end_index else 0
                                cell_text += full_text[s:e]
                        row_cells.append(cell_text.strip())
                    table_data["headerRows"].append(row_cells)
                for body_row in table.body_rows:
                    row_cells = []
                    for cell in body_row.cells:
                        cell_text = ""
                        if cell.layout and cell.layout.text_anchor and cell.layout.text_anchor.text_segments:
                            for seg in cell.layout.text_anchor.text_segments:
                                s = int(seg.start_index) if seg.start_index else 0
                                e = int(seg.end_index) if seg.end_index else 0
                                cell_text += full_text[s:e]
                        row_cells.append(cell_text.strip())
                    table_data["bodyRows"].append(row_cells)
                tables.append(table_data)
        page_info["tables"] = tables

        pages_data.append(page_info)

    # Entities
    entities = []
    if document.entities:
        for entity in document.entities:
            entities.append({
                "type": entity.type_,
                "mentionText": entity.mention_text,
                "confidence": entity.confidence,
            })

    return {
        "fullText": full_text,
        "pages": pages_data,
        "entities": entities,
        "totalPages": len(document.pages),
    }


@functions_framework.cloud_event
def process_upload(cloud_event: CloudEvent) -> None:
    """Entry point: GCS OBJECT_FINALIZE → Document AI OCR → publish result."""
    data: Dict[str, Any] = cloud_event.data

    bucket_name: str = data["bucket"]
    object_name: str = data["name"]
    content_type: str = data.get("contentType", "")
    size: int = int(data.get("size", 0))

    logger.info("Processing upload: gs://%s/%s (type=%s, size=%d)", bucket_name, object_name, content_type, size)

    # ------------------------------------------------------------------
    # 1. Parse the GCS path to extract userId and documentId
    # ------------------------------------------------------------------
    parsed = _parse_gcs_path(object_name)
    if not parsed:
        logger.warning("Skipping file with unexpected path format: %s", object_name)
        return

    user_id = parsed["userId"]
    document_id = parsed["documentId"]
    filename = parsed["filename"]
    logger.info("Parsed path → userId=%s, documentId=%s, filename=%s", user_id, document_id, filename)

    # ------------------------------------------------------------------
    # 2. Validate file size
    # ------------------------------------------------------------------
    if size > MAX_FILE_SIZE_MB * 1024 * 1024:
        logger.error("File too large: %d bytes (max %d MB)", size, MAX_FILE_SIZE_MB)
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"File exceeds maximum size of {MAX_FILE_SIZE_MB} MB",
        })
        return

    # ------------------------------------------------------------------
    # 3. Update Firestore status to 'ocr_processing'
    # ------------------------------------------------------------------
    _update_firestore_status(user_id, document_id, "ocr_processing")

    # ------------------------------------------------------------------
    # 4. Read the file from GCS
    # ------------------------------------------------------------------
    try:
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(object_name)
        file_content: bytes = blob.download_as_bytes()
        logger.info("Downloaded %d bytes from GCS", len(file_content))
    except Exception as exc:
        logger.exception("Failed to download file from GCS")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"Failed to read file: {exc}",
        })
        return

    # ------------------------------------------------------------------
    # 5. Send to Document AI OCR processor
    # ------------------------------------------------------------------
    mime_type = _detect_mime_type(filename, content_type)
    if mime_type not in SUPPORTED_MIME_TYPES:
        logger.error("Unsupported MIME type: %s", mime_type)
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"Unsupported file type: {mime_type}",
        })
        return

    try:
        document = _run_ocr(file_content, mime_type)
        logger.info("OCR completed successfully")
    except Exception as exc:
        logger.exception("Document AI OCR failed")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"OCR processing failed: {exc}",
        })
        return

    # ------------------------------------------------------------------
    # 6. Extract full text, per-page text, entities, tables
    # ------------------------------------------------------------------
    ocr_data = _extract_ocr_data(document)

    if not ocr_data["fullText"].strip():
        logger.warning("OCR returned empty text for document %s", document_id)
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": "OCR could not extract any text from the document",
        })
        return

    # ------------------------------------------------------------------
    # 7. Store OCR output as JSON in processed bucket
    # ------------------------------------------------------------------
    ocr_output_path = f"{user_id}/{document_id}/ocr_output.json"
    try:
        processed_bucket = storage_client.bucket(PROCESSED_BUCKET)
        ocr_blob = processed_bucket.blob(ocr_output_path)
        ocr_blob.upload_from_string(
            json.dumps(ocr_data, ensure_ascii=False, default=str),
            content_type="application/json",
        )
        logger.info("OCR output stored at gs://%s/%s", PROCESSED_BUCKET, ocr_output_path)
    except Exception as exc:
        logger.exception("Failed to store OCR output")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"Failed to store OCR result: {exc}",
        })
        return

    # ------------------------------------------------------------------
    # 8. Publish message to mydata-ocr-complete topic
    # ------------------------------------------------------------------
    topic_path = publisher.topic_path(PROJECT_ID, OCR_COMPLETE_TOPIC)
    message_data = json.dumps({
        "userId": user_id,
        "documentId": document_id,
        "ocrPath": f"gs://{PROCESSED_BUCKET}/{ocr_output_path}",
        "totalPages": ocr_data["totalPages"],
        "textLength": len(ocr_data["fullText"]),
    }).encode("utf-8")

    try:
        future = publisher.publish(topic_path, data=message_data)
        message_id = future.result(timeout=30)
        logger.info("Published to %s, message_id=%s", OCR_COMPLETE_TOPIC, message_id)
    except Exception as exc:
        logger.exception("Failed to publish to Pub/Sub")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"Failed to trigger classification: {exc}",
        })
        return

    # ------------------------------------------------------------------
    # 9. Update Firestore status to 'ocr_complete'
    # ------------------------------------------------------------------
    _update_firestore_status(user_id, document_id, "ocr_complete", {
        "ocrOutputPath": f"gs://{PROCESSED_BUCKET}/{ocr_output_path}",
        "totalPages": ocr_data["totalPages"],
        "textLength": len(ocr_data["fullText"]),
    })

    logger.info("✓ process-upload complete for document %s", document_id)
