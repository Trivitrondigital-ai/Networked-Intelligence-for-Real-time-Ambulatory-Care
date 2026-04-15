from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any, Dict

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

OPENMRS_BASE_URL = os.getenv("OPENMRS_BASE_URL", "http://openmrs:8080/openmrs")
OPENMRS_USER = os.getenv("OPENMRS_USERNAME", "admin")
OPENMRS_PASS = os.getenv("OPENMRS_PASSWORD", "Admin123")
OPENMRS_FHIR_PATH = os.getenv("OPENMRS_FHIR_PATH", "/ws/fhir2/R4")
EMR_AUDIT_DB_PATH = os.getenv("EMR_AUDIT_DB_PATH", "/tmp/emr_cdss_bridge.db")

app = FastAPI(title="EMR Service", version="1.0.0", description="OpenMRS integration adapter")


class PrecheckStoreRequest(BaseModel):
    encounter_id: str
    patient_id: str
    chief_complaint: str = ""
    transcript: str = ""
    questions: list[dict[str, Any]] = Field(default_factory=list)
    confidence_scores: Dict[str, float] = Field(default_factory=dict)
    reasoning: str = ""
    doctor_validation_required: bool = True
    auto_approved: bool = False


class AnalysisStoreRequest(BaseModel):
    encounter_id: str
    patient_id: str
    transcript: str
    cdss_output: Dict[str, Any] = Field(default_factory=dict)
    doctor_validation_required: bool = True
    auto_approved: bool = False


class EMRBridgeStore:
    def __init__(self, db_path: str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cdss_precheck_store (
                    encounter_id TEXT PRIMARY KEY,
                    patient_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cdss_analysis_store (
                    encounter_id TEXT PRIMARY KEY,
                    patient_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def save_precheck(self, encounter_id: str, patient_id: str, payload: Dict[str, Any]) -> None:
        with self._lock, sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO cdss_precheck_store (encounter_id, patient_id, payload_json)
                VALUES (?, ?, ?)
                """,
                (encounter_id, patient_id, json.dumps(payload)),
            )

    def save_analysis(self, encounter_id: str, patient_id: str, payload: Dict[str, Any]) -> None:
        with self._lock, sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO cdss_analysis_store (encounter_id, patient_id, payload_json)
                VALUES (?, ?, ?)
                """,
                (encounter_id, patient_id, json.dumps(payload)),
            )

    def get_encounter_artifacts(self, encounter_id: str) -> Dict[str, Any]:
        with self._lock, sqlite3.connect(self._path) as conn:
            conn.row_factory = sqlite3.Row
            precheck_row = conn.execute(
                "SELECT payload_json FROM cdss_precheck_store WHERE encounter_id = ?",
                (encounter_id,),
            ).fetchone()
            analysis_row = conn.execute(
                "SELECT payload_json FROM cdss_analysis_store WHERE encounter_id = ?",
                (encounter_id,),
            ).fetchone()

        return {
            "precheck": json.loads(precheck_row["payload_json"]) if precheck_row else None,
            "analysis": json.loads(analysis_row["payload_json"]) if analysis_row else None,
        }


bridge_store = EMRBridgeStore(EMR_AUDIT_DB_PATH)


async def _push_cdss_observation_to_openmrs(patient_id: str, encounter_id: str, payload: Dict[str, Any]) -> None:
    """
    Best-effort FHIR Observation push for CDSS artifacts. Local bridge store is the durable source.
    """
    url = f"{OPENMRS_BASE_URL}{OPENMRS_FHIR_PATH}/Observation"
    observation = {
        "resourceType": "Observation",
        "status": "final",
        "code": {
            "text": "CDSS Assistive Output",
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "valueString": json.dumps(payload)[:100000],
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.post(url, auth=(OPENMRS_USER, OPENMRS_PASS), json=observation)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "emr_service"}


@app.get("/emr/patient/{patient_id}")
async def get_patient(patient_id: str) -> Dict[str, Any]:
    url = f"{OPENMRS_BASE_URL}{OPENMRS_FHIR_PATH}/Patient/{patient_id}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, auth=(OPENMRS_USER, OPENMRS_PASS))

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.get("/emr/encounter/{encounter_id}")
async def get_encounter(encounter_id: str) -> Dict[str, Any]:
    url = f"{OPENMRS_BASE_URL}{OPENMRS_FHIR_PATH}/Encounter/{encounter_id}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, auth=(OPENMRS_USER, OPENMRS_PASS))

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.post("/emr/cdss/precheck")
async def store_precheck(payload: PrecheckStoreRequest) -> Dict[str, Any]:
    data = payload.model_dump(mode="json")
    bridge_store.save_precheck(payload.encounter_id, payload.patient_id, data)

    pushed = False
    try:
        await _push_cdss_observation_to_openmrs(payload.patient_id, payload.encounter_id, data)
        pushed = True
    except Exception:
        pushed = False

    return {
        "status": "stored",
        "encounter_id": payload.encounter_id,
        "openmrs_pushed": pushed,
    }


@app.post("/emr/cdss/analysis")
async def store_analysis(payload: AnalysisStoreRequest) -> Dict[str, Any]:
    data = payload.model_dump(mode="json")
    bridge_store.save_analysis(payload.encounter_id, payload.patient_id, data)

    pushed = False
    try:
        await _push_cdss_observation_to_openmrs(payload.patient_id, payload.encounter_id, data)
        pushed = True
    except Exception:
        pushed = False

    return {
        "status": "stored",
        "encounter_id": payload.encounter_id,
        "openmrs_pushed": pushed,
    }


@app.get("/emr/cdss/{encounter_id}")
def get_cdss_artifacts(encounter_id: str) -> Dict[str, Any]:
    data = bridge_store.get_encounter_artifacts(encounter_id)
    if not data.get("precheck") and not data.get("analysis"):
        raise HTTPException(status_code=404, detail="No CDSS artifacts found for encounter")
    return {"encounter_id": encounter_id, **data}
