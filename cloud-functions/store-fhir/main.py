"""
Cloud Function: store-fhir
Triggered by Pub/Sub topic mydata-classified.
Creates FHIR R4 resources in the Healthcare API based on classification results.
"""

import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import functions_framework
from cloudevents.http import CloudEvent
from google.cloud import firestore
from google.cloud import storage
from googleapiclient import discovery
from google.auth import default as google_auth_default

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ID: str = os.environ.get("GCP_PROJECT", "dave-487819")
HEALTHCARE_LOCATION: str = os.environ.get("HEALTHCARE_LOCATION", "us-central1")
HEALTHCARE_DATASET: str = os.environ.get("HEALTHCARE_DATASET", "resohealth-mydata")
FHIR_STORE: str = os.environ.get("FHIR_STORE", "health-vault")
PROCESSED_BUCKET: str = os.environ.get("PROCESSED_BUCKET", "resohealth-mydata-processed")
UPLOADS_BUCKET: str = os.environ.get("UPLOADS_BUCKET", "resohealth-mydata-uploads")

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
storage_client = storage.Client(project=PROJECT_ID)
firestore_client = firestore.Client(project=PROJECT_ID)

credentials, _ = google_auth_default()
healthcare_service = discovery.build("healthcare", "v1", credentials=credentials, cache_discovery=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("store-fhir")

# Base path for FHIR operations
FHIR_BASE = (
    f"projects/{PROJECT_ID}/locations/{HEALTHCARE_LOCATION}"
    f"/datasets/{HEALTHCARE_DATASET}/fhirStores/{FHIR_STORE}"
)


# ---------------------------------------------------------------------------
# FHIR Helper Functions
# ---------------------------------------------------------------------------
def _fhir_create(resource: Dict[str, Any]) -> Dict[str, Any]:
    """Create a FHIR resource."""
    resource_type = resource["resourceType"]
    parent = f"{FHIR_BASE}/fhir"
    request = (
        healthcare_service.projects()
        .locations()
        .datasets()
        .fhirStores()
        .fhir()
        .create(parent=parent, type=resource_type, body=resource)
    )
    response = request.execute()
    logger.info("Created FHIR %s: %s", resource_type, response.get("id"))
    return response


def _fhir_search(resource_type: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
    """Search for FHIR resources."""
    parent = f"{FHIR_BASE}/fhir"
    request = (
        healthcare_service.projects()
        .locations()
        .datasets()
        .fhirStores()
        .fhir()
        .search(parent=parent, body={"resourceType": resource_type, **params})
    )
    response = request.execute()
    entries = response.get("entry", [])
    return [e.get("resource", {}) for e in entries]


def _ensure_patient(user_id: str) -> str:
    """Ensure a Patient resource exists for this user. Returns the FHIR Patient ID."""
    # Search for existing patient by identifier
    results = _fhir_search("Patient", {
        "identifier": f"https://resohealth.life|{user_id}",
    })

    if results:
        patient_id = results[0].get("id")
        logger.info("Found existing Patient: %s", patient_id)
        return patient_id

    # Create new Patient
    patient_resource = {
        "resourceType": "Patient",
        "identifier": [
            {
                "system": "https://resohealth.life",
                "value": user_id,
            }
        ],
        "active": True,
        "meta": {
            "tag": [
                {
                    "system": "https://resohealth.life/tags",
                    "code": "health-vault",
                    "display": "MyData Health Vault",
                }
            ]
        },
    }

    response = _fhir_create(patient_resource)
    patient_id = response.get("id")
    logger.info("Created new Patient: %s", patient_id)
    return patient_id


def _create_document_reference(
    patient_id: str,
    user_id: str,
    document_id: str,
    classification: Dict[str, Any],
    filename: str,
) -> str:
    """Create a DocumentReference resource linking to the raw file."""
    now = datetime.now(timezone.utc).isoformat()

    doc_ref_resource = {
        "resourceType": "DocumentReference",
        "status": "current",
        "type": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": "34108-1",
                    "display": "Outpatient Note",
                }
            ],
            "text": classification.get("category", "unknown"),
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "date": now,
        "description": classification.get("summary", ""),
        "content": [
            {
                "attachment": {
                    "contentType": "application/pdf",
                    "url": f"gs://{UPLOADS_BUCKET}/{user_id}/{document_id}/{filename}",
                    "title": filename,
                },
            }
        ],
        "context": {},
    }

    if classification.get("dateOfService"):
        doc_ref_resource["context"]["period"] = {
            "start": classification["dateOfService"],
        }

    if classification.get("providerName"):
        doc_ref_resource["author"] = [{"display": classification["providerName"]}]

    response = _fhir_create(doc_ref_resource)
    return response.get("id", "")


def _create_vitals_observations(
    patient_id: str, classification: Dict[str, Any]
) -> List[str]:
    """Create Observation resources for vitals data."""
    resource_ids = []
    extracted = classification.get("extractedData", {})
    date_of_service = classification.get("dateOfService", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    loinc_map = {
        "bloodPressureSystolic": ("8480-6", "Systolic blood pressure", "mmHg"),
        "bloodPressureDiastolic": ("8462-4", "Diastolic blood pressure", "mmHg"),
        "heartRate": ("8867-4", "Heart rate", "/min"),
        "temperature": ("8310-5", "Body temperature", "Cel"),
        "weight": ("29463-7", "Body weight", "kg"),
        "height": ("8302-2", "Body height", "cm"),
        "bmi": ("39156-5", "Body mass index", "kg/m2"),
        "oxygenSaturation": ("2708-6", "Oxygen saturation", "%"),
        "respiratoryRate": ("9279-1", "Respiratory rate", "/min"),
    }

    for field, (code, display, unit) in loinc_map.items():
        value = extracted.get(field)
        if value is None:
            continue

        # Parse numeric value
        try:
            numeric_val = float(str(value).replace(",", "").strip())
        except (ValueError, TypeError):
            logger.warning("Non-numeric value for %s: %s", field, value)
            continue

        observation = {
            "resourceType": "Observation",
            "status": "final",
            "category": [
                {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                            "code": "vital-signs",
                            "display": "Vital Signs",
                        }
                    ]
                }
            ],
            "code": {
                "coding": [{"system": "http://loinc.org", "code": code, "display": display}],
                "text": display,
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "effectiveDateTime": date_of_service,
            "valueQuantity": {
                "value": numeric_val,
                "unit": unit,
                "system": "http://unitsofmeasure.org",
                "code": unit,
            },
        }

        response = _fhir_create(observation)
        resource_ids.append(f"Observation/{response.get('id', '')}")

    return resource_ids


def _create_lab_results(
    patient_id: str, classification: Dict[str, Any]
) -> List[str]:
    """Create DiagnosticReport + Observation resources for lab results."""
    resource_ids = []
    extracted = classification.get("extractedData", {})
    date_of_service = classification.get("dateOfService", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    tests = extracted.get("tests", [])

    observation_references = []
    for test in tests:
        test_name = test.get("name", "Unknown Test")
        test_value = test.get("value")
        test_unit = test.get("unit", "")
        reference_range = test.get("referenceRange", "")
        flag = test.get("flag", "")

        observation: Dict[str, Any] = {
            "resourceType": "Observation",
            "status": "final",
            "category": [
                {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                            "code": "laboratory",
                            "display": "Laboratory",
                        }
                    ]
                }
            ],
            "code": {
                "text": test_name,
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "effectiveDateTime": date_of_service,
        }

        # Set value
        try:
            numeric_val = float(str(test_value).replace(",", "").strip())
            observation["valueQuantity"] = {
                "value": numeric_val,
                "unit": test_unit,
            }
        except (ValueError, TypeError):
            observation["valueString"] = str(test_value) if test_value else "N/A"

        # Set reference range
        if reference_range:
            observation["referenceRange"] = [{"text": reference_range}]

        # Set interpretation
        if flag:
            interpretation_code = "H" if flag.upper() in ("H", "HIGH") else "L" if flag.upper() in ("L", "LOW") else "N"
            observation["interpretation"] = [
                {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                            "code": interpretation_code,
                        }
                    ]
                }
            ]

        response = _fhir_create(observation)
        obs_id = response.get("id", "")
        resource_ids.append(f"Observation/{obs_id}")
        observation_references.append({"reference": f"Observation/{obs_id}"})

    # Create DiagnosticReport
    diagnostic_report = {
        "resourceType": "DiagnosticReport",
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                        "code": "LAB",
                        "display": "Laboratory",
                    }
                ]
            }
        ],
        "code": {"text": classification.get("summary", "Laboratory Report")},
        "subject": {"reference": f"Patient/{patient_id}"},
        "effectiveDateTime": date_of_service,
        "result": observation_references,
        "conclusion": "; ".join(classification.get("keyFindings", [])),
    }

    response = _fhir_create(diagnostic_report)
    resource_ids.append(f"DiagnosticReport/{response.get('id', '')}")

    return resource_ids


def _create_radiology_resources(
    patient_id: str, classification: Dict[str, Any]
) -> List[str]:
    """Create ImagingStudy + DiagnosticReport for radiology."""
    resource_ids = []
    extracted = classification.get("extractedData", {})
    date_of_service = classification.get("dateOfService", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    # ImagingStudy
    imaging_study = {
        "resourceType": "ImagingStudy",
        "status": "available",
        "subject": {"reference": f"Patient/{patient_id}"},
        "started": date_of_service,
        "description": extracted.get("modality", "Imaging Study"),
        "note": [{"text": extracted.get("findings", "")}],
    }

    if extracted.get("modality"):
        imaging_study["modality"] = [
            {
                "system": "http://dicom.nema.org/resources/ontology/DCM",
                "code": extracted["modality"].upper()[:2],
            }
        ]

    response = _fhir_create(imaging_study)
    resource_ids.append(f"ImagingStudy/{response.get('id', '')}")

    # DiagnosticReport for radiology
    diag_report = {
        "resourceType": "DiagnosticReport",
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                        "code": "RAD",
                        "display": "Radiology",
                    }
                ]
            }
        ],
        "code": {"text": extracted.get("modality", "Radiology Report")},
        "subject": {"reference": f"Patient/{patient_id}"},
        "effectiveDateTime": date_of_service,
        "conclusion": extracted.get("impression", "; ".join(classification.get("keyFindings", []))),
        "imagingStudy": [{"reference": f"ImagingStudy/{response.get('id', '')}"}],
    }

    response = _fhir_create(diag_report)
    resource_ids.append(f"DiagnosticReport/{response.get('id', '')}")

    return resource_ids


def _create_medication_resources(
    patient_id: str, classification: Dict[str, Any]
) -> List[str]:
    """Create MedicationStatement resources."""
    resource_ids = []
    extracted = classification.get("extractedData", {})
    medications = extracted.get("medications", [])
    date_of_service = classification.get("dateOfService", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    for med in medications:
        med_statement = {
            "resourceType": "MedicationStatement",
            "status": "active",
            "medicationCodeableConcept": {
                "text": med.get("name", "Unknown Medication"),
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "effectiveDateTime": date_of_service,
            "dosage": [
                {
                    "text": f"{med.get('dosage', '')} {med.get('frequency', '')}".strip(),
                }
            ],
        }

        if med.get("prescriber"):
            med_statement["informationSource"] = {"display": med["prescriber"]}

        response = _fhir_create(med_statement)
        resource_ids.append(f"MedicationStatement/{response.get('id', '')}")

    return resource_ids


def _create_encounter_resources(
    patient_id: str, classification: Dict[str, Any], encounter_class: str
) -> List[str]:
    """Create Encounter + DocumentReference for outpatient/inpatient."""
    resource_ids = []
    extracted = classification.get("extractedData", {})
    date_of_service = classification.get("dateOfService", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    class_code = "AMB" if encounter_class == "outpatient" else "IMP"
    class_display = "ambulatory" if encounter_class == "outpatient" else "inpatient encounter"

    encounter = {
        "resourceType": "Encounter",
        "status": "finished",
        "class": {
            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            "code": class_code,
            "display": class_display,
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "period": {"start": date_of_service},
    }

    if extracted.get("chiefComplaint"):
        encounter["reasonCode"] = [{"text": extracted["chiefComplaint"]}]

    if extracted.get("diagnosis"):
        diag_list = extracted["diagnosis"] if isinstance(extracted["diagnosis"], list) else [extracted["diagnosis"]]
        encounter["diagnosis"] = [
            {"condition": {"display": d}, "rank": i + 1}
            for i, d in enumerate(diag_list)
        ]

    if classification.get("providerName"):
        encounter["serviceProvider"] = {"display": classification["providerName"]}

    response = _fhir_create(encounter)
    resource_ids.append(f"Encounter/{response.get('id', '')}")

    return resource_ids


def _create_insurance_resources(
    patient_id: str, classification: Dict[str, Any]
) -> List[str]:
    """Create Coverage resource for insurance documents."""
    resource_ids = []
    extracted = classification.get("extractedData", {})

    coverage = {
        "resourceType": "Coverage",
        "status": "active",
        "beneficiary": {"reference": f"Patient/{patient_id}"},
        "type": {
            "text": extracted.get("coverageType", "Health Insurance"),
        },
    }

    if extracted.get("policyNumber"):
        coverage["identifier"] = [{"value": extracted["policyNumber"]}]

    if extracted.get("provider"):
        coverage["payor"] = [{"display": extracted["provider"]}]

    if extracted.get("effectiveDate"):
        coverage["period"] = {"start": extracted["effectiveDate"]}

    response = _fhir_create(coverage)
    resource_ids.append(f"Coverage/{response.get('id', '')}")

    return resource_ids


def _create_custom_observation(
    patient_id: str, classification: Dict[str, Any], category_code: str
) -> List[str]:
    """Create Observation with custom codes for specialty categories
    (epigenetic_bioage, nutrigenomics, genetic_testing, longevity_assessment)."""
    resource_ids = []
    extracted = classification.get("extractedData", {})
    date_of_service = classification.get("dateOfService", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    custom_codes = {
        "epigenetic_bioage": {
            "code": "EPIBIOAGE",
            "display": "Epigenetic Biological Age Assessment",
        },
        "nutrigenomics": {
            "code": "NUTRGEN",
            "display": "Nutrigenomics Assessment",
        },
        "genetic_testing": {
            "code": "GENTEST",
            "display": "Genetic Testing Results",
        },
        "longevity_assessment": {
            "code": "LONGEV",
            "display": "Longevity Assessment",
        },
    }

    code_info = custom_codes.get(category_code, {"code": "OTHER", "display": "Other Assessment"})

    observation = {
        "resourceType": "Observation",
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "survey",
                        "display": "Survey",
                    }
                ]
            }
        ],
        "code": {
            "coding": [
                {
                    "system": "https://resohealth.life/fhir/CodeSystem/custom",
                    "code": code_info["code"],
                    "display": code_info["display"],
                }
            ],
            "text": code_info["display"],
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "effectiveDateTime": date_of_service,
        "valueString": json.dumps(extracted, default=str),
        "note": [{"text": classification.get("summary", "")}],
    }

    # Add specific components for epigenetic bioage
    if category_code == "epigenetic_bioage":
        components = []
        if extracted.get("biologicalAge"):
            components.append({
                "code": {"text": "Biological Age"},
                "valueQuantity": {"value": float(extracted["biologicalAge"]), "unit": "years"},
            })
        if extracted.get("chronologicalAge"):
            components.append({
                "code": {"text": "Chronological Age"},
                "valueQuantity": {"value": float(extracted["chronologicalAge"]), "unit": "years"},
            })
        if components:
            observation["component"] = components

    # Add specific components for longevity assessment
    if category_code == "longevity_assessment" and extracted.get("overallScore"):
        observation["component"] = [
            {
                "code": {"text": "Longevity Score"},
                "valueQuantity": {"value": float(extracted["overallScore"]), "unit": "score"},
            }
        ]

    response = _fhir_create(observation)
    resource_ids.append(f"Observation/{response.get('id', '')}")

    return resource_ids


def _create_wellness_careplan(
    patient_id: str, classification: Dict[str, Any]
) -> List[str]:
    """Create CarePlan resource for wellness programs."""
    resource_ids = []
    extracted = classification.get("extractedData", {})
    date_of_service = classification.get("dateOfService", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    care_plan: Dict[str, Any] = {
        "resourceType": "CarePlan",
        "status": "active",
        "intent": "plan",
        "title": extracted.get("programName", "Wellness Program"),
        "subject": {"reference": f"Patient/{patient_id}"},
        "period": {"start": date_of_service},
        "description": classification.get("summary", ""),
    }

    # Add goals
    goals = extracted.get("goals", [])
    if goals:
        care_plan["goal"] = [{"display": g} for g in goals]

    # Add activities
    activities = extracted.get("activities", [])
    if activities:
        care_plan["activity"] = [
            {"detail": {"description": a, "status": "in-progress"}}
            for a in activities
        ]

    response = _fhir_create(care_plan)
    resource_ids.append(f"CarePlan/{response.get('id', '')}")

    return resource_ids


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


@functions_framework.cloud_event
def store_fhir(cloud_event: CloudEvent) -> None:
    """Entry point: Pub/Sub mydata-classified → create FHIR resources."""
    # Decode Pub/Sub message
    pubsub_data = cloud_event.data.get("message", {}).get("data", "")
    if pubsub_data:
        message = json.loads(base64.b64decode(pubsub_data).decode("utf-8"))
    else:
        logger.error("No data in Pub/Sub message")
        return

    user_id: str = message["userId"]
    document_id: str = message["documentId"]
    classification_path: str = message["classificationPath"]
    category: str = message.get("category", "")

    logger.info(
        "Creating FHIR resources: userId=%s, documentId=%s, category=%s",
        user_id, document_id, category,
    )

    # ------------------------------------------------------------------
    # 1. Read classification result from GCS
    # ------------------------------------------------------------------
    try:
        if classification_path.startswith("gs://"):
            parts = classification_path[5:].split("/", 1)
            bucket_name = parts[0]
            blob_name = parts[1]
        else:
            bucket_name = PROCESSED_BUCKET
            blob_name = classification_path

        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        classification = json.loads(blob.download_as_text())
        logger.info("Read classification data for category: %s", classification.get("category"))
    except Exception as exc:
        logger.exception("Failed to read classification result")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"Failed to read classification: {exc}",
        })
        return

    # ------------------------------------------------------------------
    # 2. Get the original filename from Firestore
    # ------------------------------------------------------------------
    doc_ref = (
        firestore_client.collection("users")
        .document(user_id)
        .collection("health_documents")
        .document(document_id)
    )
    doc_snapshot = doc_ref.get()
    doc_data = doc_snapshot.to_dict() if doc_snapshot.exists else {}
    filename = doc_data.get("filename", "document.pdf")

    # ------------------------------------------------------------------
    # 3. Ensure Patient resource exists
    # ------------------------------------------------------------------
    try:
        patient_id = _ensure_patient(user_id)
    except Exception as exc:
        logger.exception("Failed to ensure Patient resource")
        _update_firestore_status(user_id, document_id, "error", {
            "errorMessage": f"Failed to create Patient: {exc}",
        })
        return

    # ------------------------------------------------------------------
    # 4. Create DocumentReference
    # ------------------------------------------------------------------
    fhir_resource_ids: Dict[str, Any] = {}
    try:
        doc_ref_id = _create_document_reference(
            patient_id, user_id, document_id, classification, filename
        )
        fhir_resource_ids["DocumentReference"] = doc_ref_id
    except Exception as exc:
        logger.exception("Failed to create DocumentReference")

    # ------------------------------------------------------------------
    # 5. Create category-specific resources
    # ------------------------------------------------------------------
    category = classification.get("category", category)
    resource_creators = {
        "vitals": lambda: _create_vitals_observations(patient_id, classification),
        "lab_results": lambda: _create_lab_results(patient_id, classification),
        "radiology": lambda: _create_radiology_resources(patient_id, classification),
        "medications": lambda: _create_medication_resources(patient_id, classification),
        "outpatient": lambda: _create_encounter_resources(patient_id, classification, "outpatient"),
        "inpatient": lambda: _create_encounter_resources(patient_id, classification, "inpatient"),
        "insurance": lambda: _create_insurance_resources(patient_id, classification),
        "epigenetic_bioage": lambda: _create_custom_observation(patient_id, classification, "epigenetic_bioage"),
        "nutrigenomics": lambda: _create_custom_observation(patient_id, classification, "nutrigenomics"),
        "genetic_testing": lambda: _create_custom_observation(patient_id, classification, "genetic_testing"),
        "longevity_assessment": lambda: _create_custom_observation(patient_id, classification, "longevity_assessment"),
        "wellness_program": lambda: _create_wellness_careplan(patient_id, classification),
        "triage": lambda: _create_encounter_resources(patient_id, classification, "outpatient"),
    }

    creator = resource_creators.get(category)
    if creator:
        try:
            additional_ids = creator()
            fhir_resource_ids["resources"] = additional_ids
            logger.info("Created %d additional FHIR resources", len(additional_ids))
        except Exception as exc:
            logger.exception("Failed to create category-specific FHIR resources for %s", category)
            fhir_resource_ids["error"] = str(exc)
    else:
        logger.warning("No FHIR resource creator for category: %s", category)

    # ------------------------------------------------------------------
    # 6. Update Firestore with FHIR resource IDs and final status
    # ------------------------------------------------------------------
    _update_firestore_status(user_id, document_id, "classified", {
        "fhirResourceIds": fhir_resource_ids,
        "fhirPatientId": patient_id,
    })

    logger.info("✓ store-fhir complete for document %s (%d resources)", document_id, len(fhir_resource_ids))
