from __future__ import annotations

import os
from typing import Any, Dict, List

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from shared.audit_store import AuditStore
from shared.models import (
    Alert,
    AnalyzeRequest,
    CDSSOutput,
    DDICheckRequest,
    DoctorOverride,
    ExplainabilityResponse,
    MedicationRequest,
    Patient,
    PrecheckAnswer,
    PrecheckQuestion,
    PrecheckRequest,
    PrecheckResponse,
    PrescriptionValidationRequest,
    SOAP,
)
from shared.rule_engine import RuleEngine

app = FastAPI(
    title="CDSS Service",
    version="1.0.0",
    description="Hybrid CDSS orchestrator: NLP + LLM + deterministic safety rules",
)

NLP_SERVICE_URL = os.getenv("NLP_SERVICE_URL", "http://nlp-service:8012")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:8011")
EMR_SERVICE_URL = os.getenv("EMR_SERVICE_URL", "http://emr-service:8013")
AUDIT_DB_PATH = os.getenv("AUDIT_DB_PATH", "/tmp/cdss_audit.db")


class PrescriptionValidationResponse(BaseModel):
    safe: bool
    warnings: List[Alert]
    rule_trace: List[str]


class DDICheckResponse(BaseModel):
    alerts: List[Alert]


rule_engine = RuleEngine()
audit_store = AuditStore(AUDIT_DB_PATH)


async def _fetch_patient_context(patient_id: str) -> Patient:
    """Attempt EMR fetch first; fallback to minimal patient profile."""
    url = f"{EMR_SERVICE_URL}/emr/patient/{patient_id}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json()

        allergies = []
        for item in payload.get("allergyIntolerance", []):
            code = item.get("code", {}).get("text")
            if code:
                allergies.append(str(code).lower())

        return Patient(
            patient_id=patient_id,
            name=payload.get("name", [{}])[0].get("text"),
            allergies=allergies,
            medical_history=[],
            active_medications=[],
        )
    except Exception:
        return Patient(patient_id=patient_id)


async def _persist_precheck_to_emr(payload: Dict[str, Any]) -> None:
    url = f"{EMR_SERVICE_URL}/emr/cdss/precheck"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(url, json=payload)
    except Exception:
        # non-blocking by design; local audit store remains source of truth
        return


async def _persist_analysis_to_emr(payload: Dict[str, Any]) -> None:
    url = f"{EMR_SERVICE_URL}/emr/cdss/analysis"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(url, json=payload)
    except Exception:
        return


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "cdss_service"}


@app.post("/cdss/ddi-check", response_model=DDICheckResponse)
def ddi_check(payload: DDICheckRequest) -> DDICheckResponse:
    alerts = rule_engine.check_ddi(payload.medications)
    return DDICheckResponse(alerts=alerts)


@app.post("/cdss/validate-prescription", response_model=PrescriptionValidationResponse)
def validate_prescription(payload: PrescriptionValidationRequest) -> PrescriptionValidationResponse:
    safe, alerts, trace = rule_engine.validate_prescription(payload.medications, payload.patient)
    return PrescriptionValidationResponse(safe=safe, warnings=alerts, rule_trace=trace)


@app.post("/cdss/analyze", response_model=CDSSOutput)
async def analyze(payload: AnalyzeRequest) -> CDSSOutput:
    patient = await _fetch_patient_context(payload.patient_id)

    async with httpx.AsyncClient(timeout=45.0) as client:
        nlp_resp = await client.post(f"{NLP_SERVICE_URL}/nlp/extract", json={"transcript": payload.transcript})
        if nlp_resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"NLP service error: {nlp_resp.text}")
        nlp_data = nlp_resp.json()

        ai_resp = await client.post(
            f"{AI_SERVICE_URL}/ai/reason",
            json={
                "transcript": payload.transcript,
                "structured_nlp_output": nlp_data,
                "precheck_answers": [ans.model_dump(mode="json") for ans in payload.precheck_answers],
                "patient_summary": patient.model_dump(mode="json"),
            },
        )
        if ai_resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"AI service error: {ai_resp.text}")
        ai_data = ai_resp.json()

    medication_suggestions = [MedicationRequest(**m) for m in ai_data.get("prescription_suggestions", [])]
    safe, alerts, trace = rule_engine.validate_prescription(medication_suggestions, patient)

    if not safe:
        alerts.append(
            Alert(
                type="workflow",
                severity="critical",
                message="Unsafe prescription combination detected. Recommendation is blocked pending clinician revision.",
                blocked=True,
                explainable_rule_id="WF-BLOCK-001",
            )
        )

    alerts.append(
        Alert(
            type="workflow",
            severity="high",
            message="Doctor validation is mandatory. AI output is advisory only.",
            blocked=False,
            explainable_rule_id="WF-VALIDATE-002",
        )
    )

    output = CDSSOutput(
        encounter_id=payload.encounter_id,
        diagnoses=ai_data.get("diagnosis_suggestions", []),
        medications=medication_suggestions,
        differential_diagnoses=ai_data.get("differential_diagnoses", []),
        alerts=alerts,
        confidence_scores=ai_data.get("confidence_scores", {}),
        reasoning=(ai_data.get("reasoning", "") + "\n" + "\n".join(trace)).strip(),
        soap=SOAP(**ai_data.get("soap_draft", {})),
        precheck_questions=[],
        precheck_answers=payload.precheck_answers,
        doctor_validation_required=True,
        auto_approved=False,
    )

    audit_store.save_analysis(
        encounter_id=payload.encounter_id,
        patient_id=payload.patient_id,
        transcript=payload.transcript,
        reasoning=output.reasoning,
        confidence_scores=output.confidence_scores,
        payload=output.model_dump(mode="json"),
    )

    await _persist_analysis_to_emr(
        {
            "encounter_id": payload.encounter_id,
            "patient_id": payload.patient_id,
            "transcript": payload.transcript,
            "cdss_output": output.model_dump(mode="json"),
            "doctor_validation_required": True,
            "auto_approved": False,
        }
    )

    return output


@app.post("/cdss/precheck", response_model=PrecheckResponse)
async def generate_precheck(payload: PrecheckRequest) -> PrecheckResponse:
    patient = await _fetch_patient_context(payload.patient_id)
    combined_text = (payload.transcript or "").strip() or (payload.chief_complaint or "").strip()

    async with httpx.AsyncClient(timeout=45.0) as client:
        nlp_json: Dict[str, Any] = {"symptoms": [], "duration": [], "severity": [], "medical_history": []}
        if combined_text:
            nlp_resp = await client.post(f"{NLP_SERVICE_URL}/nlp/extract", json={"transcript": combined_text})
            if nlp_resp.status_code < 400:
                nlp_json = nlp_resp.json()

        ai_resp = await client.post(
            f"{AI_SERVICE_URL}/ai/precheck-questions",
            json={
                "patient_summary": patient.model_dump(mode="json"),
                "chief_complaint": payload.chief_complaint,
                "transcript": payload.transcript,
                "structured_nlp_output": nlp_json,
            },
        )
        if ai_resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"AI service error: {ai_resp.text}")
        ai_data = ai_resp.json()

    questions = [PrecheckQuestion(**q) for q in ai_data.get("questions", [])]
    response = PrecheckResponse(
        encounter_id=payload.encounter_id,
        patient_id=payload.patient_id,
        questions=questions,
        confidence_scores=ai_data.get("confidence_scores", {}),
        reasoning=ai_data.get("reasoning", ""),
        doctor_validation_required=True,
        auto_approved=False,
    )

    audit_store.save_precheck(
        encounter_id=payload.encounter_id,
        patient_id=payload.patient_id,
        questions={"questions": [q.model_dump(mode="json") for q in questions]},
        confidence_scores=response.confidence_scores,
        reasoning=response.reasoning,
    )

    await _persist_precheck_to_emr(
        {
            "encounter_id": payload.encounter_id,
            "patient_id": payload.patient_id,
            "chief_complaint": payload.chief_complaint,
            "transcript": payload.transcript,
            "questions": [q.model_dump(mode="json") for q in questions],
            "confidence_scores": response.confidence_scores,
            "reasoning": response.reasoning,
            "doctor_validation_required": True,
            "auto_approved": False,
        }
    )

    return response


@app.get("/cdss/explain/{encounter_id}", response_model=ExplainabilityResponse)
def explain(encounter_id: str) -> ExplainabilityResponse:
    record = audit_store.get_analysis(encounter_id)
    if not record:
        raise HTTPException(status_code=404, detail="No analysis found for encounter")

    reasoning = str(record.get("reasoning", ""))
    trace = [line.strip() for line in reasoning.splitlines() if line.strip().startswith("Applied rule set")]
    return ExplainabilityResponse(
        encounter_id=encounter_id,
        reasoning=reasoning,
        confidence_scores=record.get("confidence_scores", {}),
        rule_trace=trace,
    )


@app.get("/cdss/precheck/{encounter_id}", response_model=PrecheckResponse)
def get_precheck(encounter_id: str) -> PrecheckResponse:
    record = audit_store.get_precheck(encounter_id)
    if not record:
        raise HTTPException(status_code=404, detail="No precheck found for encounter")

    questions_payload = record.get("questions", {}).get("questions", [])
    questions = [PrecheckQuestion(**q) for q in questions_payload]
    return PrecheckResponse(
        encounter_id=record["encounter_id"],
        patient_id=record["patient_id"],
        questions=questions,
        confidence_scores=record.get("confidence_scores", {}),
        reasoning=record.get("reasoning", ""),
        doctor_validation_required=True,
        auto_approved=False,
    )


@app.post("/cdss/doctor-override")
def doctor_override(payload: DoctorOverride) -> Dict[str, Any]:
    audit_store.save_override(
        encounter_id=payload.encounter_id,
        doctor_id=payload.doctor_id,
        approved=payload.approved,
        comments=payload.comments or "",
        original_suggestions=payload.original_suggestions,
        edited_suggestions=payload.edited_suggestions,
    )
    return {"status": "logged", "message": "Doctor override stored for model governance"}
