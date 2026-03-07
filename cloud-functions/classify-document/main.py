"""
Cloud Function: classify-document
Triggered by Pub/Sub topic mydata-ocr-complete.
Uses Vertex AI Gemini to classify medical documents and extract structured data.
"""

import base64
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import functions_framework
import vertexai
from cloudevents.http import CloudEvent
from google.cloud import firestore
from google.cloud import pubsub_v1
from google.cloud import storage
from vertexai.generative_models import GenerativeModel, GenerationConfig

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ID: str = os.environ.get("GCP_PROJECT", "dave-487819")
VERTEX_LOCATION: str = os.environ.get("VERTEX_LOCATION", "us-central1")
PROCESSED_BUCKET: str = os.environ.get("PROCESSED_BUCKET", "resohealth-mydata-processed")
CLASSIFIED_TOPIC: str = os.environ.get("CLASSIFIED_TOPIC", "mydata-classified")
MODEL_ID: str = os.environ.get("MODEL_ID", "gemini-2.0-flash")

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
storage_client = storage.Client(project=PROJECT_ID)
firestore_client = firestore.Client(project=PROJECT_ID)
publisher = pubsub_v1.PublisherClient()

vertexai.init(project=PROJECT_ID, location=VERTEX_LOCATION)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("classify-document")

# ---------------------------------------------------------------------------
# Valid categories
# ---------------------------------------------------------------------------
VALID_CATEGORIES: List[str] = [
    "vitals",
    "lab_results",
    "radiology",
    "outpatient",
    "inpatient",
    "medications",
    "triage",
    "insurance",
    "epigenetic_bioage",
    "nutrigenomics",
    "genetic_testing",
    "longevity_assessment",
    "wellness_program",
]

CLASSIFICATION_PROMPT: str = """You are a medical document classification AI. Analyze the following OCR-extracted text from a medical document and provide a structured classification.

DOCUMENT TEXT:
---
{document_text}
---

You MUST return a valid JSON object with the following fields:

{{
  "category": "<one of: vitals, lab_results, radiology, outpatient, inpatient, medications, triage, insurance, epigenetic_bioage, nutrigenomics, genetic_testing, longevity_assessment, wellness_program>",
  "confidence": <float 0.0 to 1.0>,
  "summary": "<2-3 sentence summary of the document content>",
  "extractedData": {{
    // Structured data extracted from the document. Include relevant fields such as:
    // For vitals: bloodPressure, heartRate, temperature, weight, height, bmi, oxygenSaturation
    // For lab_results: tests (array of {{name, value, unit, referenceRange, flag}})
    // For radiology: modality, bodyPart, findings, impression
    // For medications: medications (array of {{name, dosage, frequency, prescriber}})
    // For outpatient/inpatient: chiefComplaint, diagnosis, procedures, followUp
    // For insurance: policyNumber, provider, coverageType, effectiveDate
    // For epigenetic_bioage: biologicalAge, chronologicalAge, methylationMarkers
    // For nutrigenomics: geneticVariants, dietaryRecommendations
    // For genetic_testing: variants, riskFactors, carrier status
    // For longevity_assessment: overallScore, biomarkers, recommendations
    // For wellness_program: programName, goals, activities, progress
  }},
  "dateOfService": "<YYYY-MM-DD or null if not found>",
  "providerName": "<provider/facility name or null>",
  "keyFindings": ["<finding 1>", "<finding 2>", "..."],
  "segments": [
    // If the document contains multiple distinct sections (e.g., a combined lab + vitals report),
    // list each segment. For single-section documents, return a single segment.
    {{
      "category": "<category>",
      "startPage": <int>,
      "endPage": <int>,
      "summary": "<segment summary>"
    }}
  ]
}}

RULES:
- Always return valid JSON only, no markdown fencing, no explanation outside the JSON.
- If the document is unclear, pick the best category and set confidence lower.
- dateOfService should be the most specific date found (service date, not print date).
- keyFindings should list the most clinically relevant findings (up to 10).
- For multi-section documents, include all segments detected.
"""


def _read_ocr_output(ocr_path: str) -> Dict[str, Any]:
    """Read OCR output JSON from GCS."""
    # Parse gs:// path
    if ocr_path.startswith("gs://"):
        path_parts = ocr_path[5:].split("/", 1)
        bucket_name = path_parts[0]
        blob_name = path_parts[1]
    else:
        bucket_name = PROCESSED_BUCKET
        blob_name = ocr_path

    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    content = blob.download_as_text()
    return json.loads(content)


def _classify_with_gemini(document_text: str) -> Dict[str, Any]:
    """Send document text to Gemini for classification."""
    model = GenerativeModel(MODEL_ID)

    # Truncate very long texts to fit within context window
    max_chars = 100_000
    if len(document_text) > max_chars:
        document_text = document_text[:max_chars] + "\n\n[... TRUNCATED ...]"

    prompt = CLASSIFICATION_PROMPT.format(document_text=document_text)

    generation_config = GenerationConfig(
        temperature=0.1,
        max_output_tokens=4096,
        response_mime_type="application/json",
    )

    response = model.generate_content(
        prompt,
        generation_config=generation_config,
    )

    response_text = response.text.strip()

    # Parse JSON (handle possible markdown fencing)
    if response_text.startswith("```"):
        response_text = re.sub(r"^```(?:json)?\s*", "", response_text)
        response_text = re.sub(r"\s*```$", "", response_text)

    classification = json.loads(response_text)

    # Validate category
    if classification.get("category") not in VALID_CATEGORIES:
        logger.warning(
            "Invalid category '%s' returned by Gemini, defaulting to 'outpatient'",
            classification.get("category"),
        )
        classification["category"] = "outpatient"
        classification["confidence"] = max(0.0, classification.get("confidence", 0.5) - 0.2)

    return classification


def _update_firestore_status(
    user_id: str,
    document_id: str,
    status: str,
    extra_fields: Optional[Dict[str, Any]] = None,
) -> None:
    """Update Firestore document status."""
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


@functions_framework.cloud_event
def classify_document(cloud_event: CloudEvent) -> None:
    """Entry point: Pub/Sub mydata-ocr-complete → Gemini classification → publish."""
    # Decode Pub/Sub message
    pubsub_data = cloud_event.data.get("message", {}).get("data", "")
    if pubsub_data:
        message = json.loads(base64.b64decode(pubsub_data).decode("utf-8"))
    else:
        logger.error("No data in Pub/Sub message")
        return

    user_id: str = message["userId"]
    document_id: str = message["documentId"]
    ocr_path: str = message["ocrPath"]

    logger.info("Classifying document: userId=%s, documentId=%s", user_id, document_id)

    # ------------------------------------------------------------------
    # 1. Read OCR output from GCS
    # ------------------------------------------------------------------
    try:
        ocr_data = _read_ocr_output(ocr_path)
        document_text = ocr_data.get("fullText", "")
        logger.info("Read OCR output: %d chars", len(document_text))
    except Exception as exc:
        logger.exception("Failed to read OCR output")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"Failed to read OCR output: {exc}",
        })
        return

    if not document_text.strip():
        logger.error("Empty OCR text for document %s", document_id)
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": "No text found in OCR output",
        })
        return

    # ------------------------------------------------------------------
    # 2. Update status to classifying
    # ------------------------------------------------------------------
    _update_firestore_status(user_id, document_id, "classifying")

    # ------------------------------------------------------------------
    # 3. Use Vertex AI Gemini to classify the document
    # ------------------------------------------------------------------
    try:
        classification = _classify_with_gemini(document_text)
        logger.info(
            "Classification result: category=%s, confidence=%.2f",
            classification.get("category"),
            classification.get("confidence", 0),
        )
    except Exception as exc:
        logger.exception("Gemini classification failed")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"AI classification failed: {exc}",
        })
        return

    # ------------------------------------------------------------------
    # 4. Store classification result in GCS
    # ------------------------------------------------------------------
    classification_path = f"{user_id}/{document_id}/classification.json"
    try:
        processed_bucket = storage_client.bucket(PROCESSED_BUCKET)
        cls_blob = processed_bucket.blob(classification_path)
        cls_blob.upload_from_string(
            json.dumps(classification, ensure_ascii=False, default=str),
            content_type="application/json",
        )
        logger.info("Classification stored at gs://%s/%s", PROCESSED_BUCKET, classification_path)
    except Exception as exc:
        logger.exception("Failed to store classification")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"Failed to store classification: {exc}",
        })
        return

    # ------------------------------------------------------------------
    # 5. Update Firestore with classification data
    # ------------------------------------------------------------------
    firestore_update: Dict[str, Any] = {
        "category": classification.get("category"),
        "summary": classification.get("summary"),
        "keyFindings": classification.get("keyFindings", []),
        "dateOfService": classification.get("dateOfService"),
        "providerName": classification.get("providerName"),
        "confidence": classification.get("confidence", 0),
        "classificationPath": f"gs://{PROCESSED_BUCKET}/{classification_path}",
        "segments": classification.get("segments", []),
    }
    _update_firestore_status(user_id, document_id, "classification_complete", firestore_update)

    # ------------------------------------------------------------------
    # 6. Publish to mydata-classified topic
    # ------------------------------------------------------------------
    topic_path = publisher.topic_path(PROJECT_ID, CLASSIFIED_TOPIC)
    message_data = json.dumps({
        "userId": user_id,
        "documentId": document_id,
        "classificationPath": f"gs://{PROCESSED_BUCKET}/{classification_path}",
        "category": classification.get("category"),
    }).encode("utf-8")

    try:
        future = publisher.publish(topic_path, data=message_data)
        message_id = future.result(timeout=30)
        logger.info("Published to %s, message_id=%s", CLASSIFIED_TOPIC, message_id)
    except Exception as exc:
        logger.exception("Failed to publish to Pub/Sub")
        # Don't set error — classification is done, FHIR can be retried
        logger.warning("FHIR store step will not be triggered automatically for doc %s", document_id)

    logger.info("✓ classify-document complete for document %s", document_id)
