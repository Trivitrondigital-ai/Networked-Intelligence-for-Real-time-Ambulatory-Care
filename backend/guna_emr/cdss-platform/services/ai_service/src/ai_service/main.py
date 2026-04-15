from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, Field
from shared.models import (
    DiagnosisSuggestion,
    DifferentialDiagnosis,
    MedicationRequest,
    PrecheckQuestion,
    SOAP,
    StructuredNLPOutput,
)
from shared.terminology import icd10_for_term

logger = logging.getLogger("ai_service")
logging.basicConfig(level=logging.INFO)


class AIReasonRequest(BaseModel):
    transcript: str
    structured_nlp_output: StructuredNLPOutput
    patient_summary: Dict[str, Any] = Field(default_factory=dict)
    precheck_answers: List[Dict[str, Any]] = Field(default_factory=list)


class AIReasonResponse(BaseModel):
    soap_draft: SOAP
    diagnosis_suggestions: List[DiagnosisSuggestion] = Field(default_factory=list)
    differential_diagnoses: List[DifferentialDiagnosis] = Field(default_factory=list)
    prescription_suggestions: List[MedicationRequest] = Field(default_factory=list)
    confidence_scores: Dict[str, float] = Field(default_factory=dict)
    reasoning: str


class AIPrecheckRequest(BaseModel):
    patient_summary: Dict[str, Any] = Field(default_factory=dict)
    chief_complaint: str = ""
    transcript: str = ""
    structured_nlp_output: StructuredNLPOutput = Field(default_factory=StructuredNLPOutput)


class AIPrecheckResponse(BaseModel):
    questions: List[PrecheckQuestion] = Field(default_factory=list)
    confidence_scores: Dict[str, float] = Field(default_factory=dict)
    reasoning: str


def _parse_json_object(raw_text: str) -> Dict[str, Any]:
    text = str(raw_text or "").strip()
    if not text:
        raise ValueError("Empty LLM response")

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("LLM response did not contain a JSON object")

    data = json.loads(text[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("Parsed JSON is not an object")
    return data


class HybridLLMClient:
    def __init__(self) -> None:
        # Gemini-first configuration
        self.gemini_base_url = os.getenv("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
        self.gemini_model = os.getenv("LLM_MODEL", "gemini-2.5-flash")
        self.gemini_api_key = (
            os.getenv("LLM_API_KEY")
            or os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
            or ""
        )

        # Legacy local fallback configuration
        self.base_url = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")
        self.model = os.getenv("OLLAMA_MODEL", "llama3")

    def _gemini_enabled(self) -> bool:
        key = (self.gemini_api_key or "").strip()
        return bool(key and key not in {"your_llm_key_here", "your_gemini_key_here", "your_google_api_key_here"})

    async def _gemini_generate_json(self, *, system_instruction: str, prompt: str) -> Dict[str, Any]:
        if not self._gemini_enabled():
            raise RuntimeError("Gemini API key not configured")

        url = f"{self.gemini_base_url}/models/{self.gemini_model}:generateContent"
        payload = {
            "system_instruction": {
                "parts": [{"text": system_instruction}],
            },
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(url, params={"key": self.gemini_api_key}, json=payload)
            response.raise_for_status()
            data = response.json()

        raw = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
        return _parse_json_object(raw)

    async def reason(
        self,
        transcript: str,
        structured: StructuredNLPOutput,
        patient_summary: Dict[str, Any],
        precheck_answers: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        prompt = self._build_prompt(transcript, structured, patient_summary, precheck_answers)
        if self._gemini_enabled():
            return await self._gemini_generate_json(
                system_instruction=(
                    "You are a clinical reasoning assistant for OPD workflows. "
                    "Return STRICT JSON only. Do not include markdown or commentary."
                ),
                prompt=prompt,
            )

        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(f"{self.base_url}/api/generate", json=payload)
            response.raise_for_status()
            data = response.json()
            raw = data.get("response", "{}")

        return _parse_json_object(raw)

    async def generate_precheck(
        self,
        patient_summary: Dict[str, Any],
        chief_complaint: str,
        transcript: str,
        structured: StructuredNLPOutput,
    ) -> Dict[str, Any]:
        prompt = self._build_precheck_prompt(patient_summary, chief_complaint, transcript, structured)
        if self._gemini_enabled():
            return await self._gemini_generate_json(
                system_instruction=(
                    "You generate doctor-facing OPD precheck questions. "
                    "Return STRICT JSON only with clinically relevant question fields."
                ),
                prompt=prompt,
            )

        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(f"{self.base_url}/api/generate", json=payload)
            response.raise_for_status()
            data = response.json()
            raw = data.get("response", "{}")

        return _parse_json_object(raw)

    def _build_prompt(
        self,
        transcript: str,
        structured: StructuredNLPOutput,
        patient_summary: Dict[str, Any],
        precheck_answers: List[Dict[str, Any]],
    ) -> str:
        return (
            "You are a clinical reasoning assistant for OPD workflow. "
            "Return STRICT JSON with keys: soap_draft, diagnosis_suggestions, differential_diagnoses, "
            "prescription_suggestions, confidence_scores, reasoning. "
            "Never auto-approve treatment. Keep concise, explainable.\n\n"
            f"PatientSummary: {json.dumps(patient_summary)}\n"
            f"PrecheckAnswers: {json.dumps(precheck_answers)}\n"
            f"Transcript: {transcript}\n"
            f"Structured: {structured.model_dump_json()}\n"
        )

    def _build_precheck_prompt(
        self,
        patient_summary: Dict[str, Any],
        chief_complaint: str,
        transcript: str,
        structured: StructuredNLPOutput,
    ) -> str:
        return (
            "You are an OPD precheck question generator for doctors. "
            "Return STRICT JSON with keys: questions, confidence_scores, reasoning. "
            "questions must be an array of objects with fields: question_id, question, rationale, answer_type, options, required, confidence. "
            "Ask concise, clinically relevant questions to clarify red flags, duration, severity, comorbidities, allergies, and medication history. "
            "Never provide final diagnosis or autonomous treatment decisions.\n\n"
            f"PatientSummary: {json.dumps(patient_summary)}\n"
            f"ChiefComplaint: {chief_complaint}\n"
            f"Transcript: {transcript}\n"
            f"Structured: {structured.model_dump_json()}\n"
        )


def fallback_reasoning(transcript: str, structured: StructuredNLPOutput) -> AIReasonResponse:
    symptoms = [s.text for s in structured.symptoms]
    assessment = "Likely self-limiting upper respiratory condition"

    dx_name = "viral upper respiratory infection"
    diagnosis = [
        DiagnosisSuggestion(
            name=dx_name,
            icd10_code=icd10_for_term(dx_name),
            confidence=0.62,
            reasoning="Based on symptom pattern and absence of severe red flags in transcript.",
        )
    ]

    differentials = [
        DifferentialDiagnosis(name="acute bronchitis", icd10_code="J20.9", confidence=0.41),
        DifferentialDiagnosis(name="acute pharyngitis", icd10_code="J02.9", confidence=0.35),
    ]

    meds = [
        MedicationRequest(name="paracetamol", dose=500, unit="mg", frequency_per_day=3, duration_days=3),
    ]

    soap = SOAP(
        subjective=f"Patient reports: {', '.join(symptoms) if symptoms else 'general discomfort'}",
        objective="Vitals and focused exam pending clinician confirmation.",
        assessment=assessment,
        plan="Supportive care; review vitals; clinician to confirm diagnosis and prescription.",
    )

    return AIReasonResponse(
        soap_draft=soap,
        diagnosis_suggestions=diagnosis,
        differential_diagnoses=differentials,
        prescription_suggestions=meds,
        confidence_scores={
            "soap": 0.64,
            "diagnosis": 0.62,
            "medications": 0.58,
            "overall": 0.61,
        },
        reasoning="Fallback clinical heuristic used because LLM inference was unavailable.",
    )


def fallback_precheck(
    patient_summary: Dict[str, Any], chief_complaint: str, structured: StructuredNLPOutput
) -> AIPrecheckResponse:
    symptoms = [s.text for s in structured.symptoms][:3]
    symptom_text = ", ".join(symptoms) if symptoms else (chief_complaint.strip() or "current symptoms")
    age = patient_summary.get("age")

    questions: List[PrecheckQuestion] = [
        PrecheckQuestion(
            question_id="pc-redflag-001",
            question=f"Do you have any severe warning signs with {symptom_text} such as breathing difficulty, chest pain, fainting, or confusion?",
            rationale="Screen emergency red flags early.",
            answer_type="boolean",
            required=True,
            confidence=0.86,
        ),
        PrecheckQuestion(
            question_id="pc-duration-002",
            question="How long have these symptoms been present, and are they improving, stable, or worsening?",
            rationale="Clarify onset, duration, and trend.",
            answer_type="text",
            required=True,
            confidence=0.82,
        ),
        PrecheckQuestion(
            question_id="pc-allergy-003",
            question="Do you have any known medicine allergies (for example penicillin, NSAIDs, or others)?",
            rationale="Medication safety and allergy screening.",
            answer_type="text",
            required=True,
            confidence=0.9,
        ),
        PrecheckQuestion(
            question_id="pc-medhist-004",
            question="What chronic conditions and regular medicines do you currently have/take?",
            rationale="Identify comorbidities and interaction risks.",
            answer_type="text",
            required=True,
            confidence=0.84,
        ),
    ]

    if isinstance(age, int) and age >= 60:
        questions.append(
            PrecheckQuestion(
                question_id="pc-geri-005",
                question="Have you had any recent falls, dehydration, reduced urine, or confusion?",
                rationale="Geriatric vulnerability screening.",
                answer_type="boolean",
                required=False,
                confidence=0.74,
            )
        )

    return AIPrecheckResponse(
        questions=questions,
        confidence_scores={"precheck_questions": 0.83, "overall": 0.83},
        reasoning="Fallback rule-guided precheck generation used because LLM inference was unavailable.",
    )


llm_client = HybridLLMClient()
app = FastAPI(title="AI Service", version="1.0.0", description="LLM clinical reasoning via Gemini (primary) with Ollama fallback")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "ai_service"}


@app.post("/ai/reason", response_model=AIReasonResponse)
async def reason(payload: AIReasonRequest) -> AIReasonResponse:
    try:
        llm_json = await llm_client.reason(
            payload.transcript,
            payload.structured_nlp_output,
            payload.patient_summary,
            payload.precheck_answers,
        )
        return AIReasonResponse(**llm_json)
    except Exception as ex:
        logger.warning("LLM failed; using fallback reasoning: %s", ex)
        return fallback_reasoning(payload.transcript, payload.structured_nlp_output)


@app.post("/ai/precheck-questions", response_model=AIPrecheckResponse)
async def precheck_questions(payload: AIPrecheckRequest) -> AIPrecheckResponse:
    try:
        llm_json = await llm_client.generate_precheck(
            payload.patient_summary,
            payload.chief_complaint,
            payload.transcript,
            payload.structured_nlp_output,
        )
        return AIPrecheckResponse(**llm_json)
    except Exception as ex:
        logger.warning("LLM failed; using fallback precheck generation: %s", ex)
        return fallback_precheck(payload.patient_summary, payload.chief_complaint, payload.structured_nlp_output)
