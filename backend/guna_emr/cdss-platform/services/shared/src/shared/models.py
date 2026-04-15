from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


SeverityLevel = Literal["low", "moderate", "high", "critical"]


class MedicationRequest(BaseModel):
    name: str = Field(..., description="Medication name; normalized to RxNorm where possible")
    dose: Optional[float] = Field(default=None, description="Single dose amount")
    unit: Optional[str] = Field(default="mg", description="Dose unit, default mg")
    frequency_per_day: Optional[int] = Field(default=1, ge=1, le=24)
    route: Optional[str] = Field(default="oral")
    duration_days: Optional[int] = Field(default=5, ge=1, le=365)


class Patient(BaseModel):
    patient_id: str
    name: Optional[str] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    sex: Optional[Literal["male", "female", "other"]] = None
    weight_kg: Optional[float] = Field(default=None, ge=0)
    allergies: List[str] = Field(default_factory=list)
    active_medications: List[MedicationRequest] = Field(default_factory=list)
    medical_history: List[str] = Field(default_factory=list)


class Encounter(BaseModel):
    encounter_id: str
    patient_id: str
    provider_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SOAP(BaseModel):
    subjective: str
    objective: Optional[str] = ""
    assessment: str
    plan: str


class ExtractedEntity(BaseModel):
    text: str
    code: Optional[str] = None
    coding_system: Optional[str] = None
    confidence: float = Field(default=0.0, ge=0, le=1)


class StructuredNLPOutput(BaseModel):
    symptoms: List[ExtractedEntity] = Field(default_factory=list)
    duration: List[ExtractedEntity] = Field(default_factory=list)
    severity: List[ExtractedEntity] = Field(default_factory=list)
    medical_history: List[ExtractedEntity] = Field(default_factory=list)


class PrecheckQuestion(BaseModel):
    question_id: str
    question: str
    rationale: str = ""
    answer_type: Literal["boolean", "text", "number", "choice"] = "text"
    options: List[str] = Field(default_factory=list)
    required: bool = True
    confidence: float = Field(default=0.0, ge=0, le=1)


class PrecheckAnswer(BaseModel):
    question_id: str
    answer: str


class DiagnosisSuggestion(BaseModel):
    name: str
    icd10_code: Optional[str] = None
    confidence: float = Field(default=0.0, ge=0, le=1)
    reasoning: str = ""


class DifferentialDiagnosis(BaseModel):
    name: str
    icd10_code: Optional[str] = None
    confidence: float = Field(default=0.0, ge=0, le=1)


class Alert(BaseModel):
    type: Literal["ddi", "allergy", "dosage", "safety", "workflow", "guideline", "risk"]
    severity: SeverityLevel
    message: str
    blocked: bool = False
    explainable_rule_id: Optional[str] = None


class AI_PreChart(BaseModel):
    encounter_id: str
    transcript: str
    nlp_structured_output: StructuredNLPOutput
    soap_draft: SOAP
    diagnosis_suggestions: List[DiagnosisSuggestion] = Field(default_factory=list)
    differential_diagnoses: List[DifferentialDiagnosis] = Field(default_factory=list)
    prescription_suggestions: List[MedicationRequest] = Field(default_factory=list)
    confidence_scores: Dict[str, float] = Field(default_factory=dict)
    reasoning: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CDSSOutput(BaseModel):
    encounter_id: str
    diagnoses: List[DiagnosisSuggestion] = Field(default_factory=list)
    medications: List[MedicationRequest] = Field(default_factory=list)
    differential_diagnoses: List[DifferentialDiagnosis] = Field(default_factory=list)
    alerts: List[Alert] = Field(default_factory=list)
    confidence_scores: Dict[str, float] = Field(default_factory=dict)
    reasoning: str = ""
    soap: SOAP
    precheck_questions: List[PrecheckQuestion] = Field(default_factory=list)
    precheck_answers: List[PrecheckAnswer] = Field(default_factory=list)
    doctor_validation_required: bool = True
    auto_approved: bool = False


class AnalyzeRequest(BaseModel):
    transcript: str = Field(..., min_length=10)
    patient_id: str
    encounter_id: str
    precheck_answers: List[PrecheckAnswer] = Field(default_factory=list)


class PrecheckRequest(BaseModel):
    patient_id: str
    encounter_id: str
    chief_complaint: str = Field(default="", description="Initial short complaint before full consult")
    transcript: str = Field(default="", description="Optional early transcript if available")


class PrecheckResponse(BaseModel):
    encounter_id: str
    patient_id: str
    questions: List[PrecheckQuestion] = Field(default_factory=list)
    confidence_scores: Dict[str, float] = Field(default_factory=dict)
    reasoning: str = ""
    doctor_validation_required: bool = True
    auto_approved: bool = False


class DDICheckRequest(BaseModel):
    medications: List[MedicationRequest]


class PrescriptionValidationRequest(BaseModel):
    medications: List[MedicationRequest]
    patient: Patient


class ExplainabilityResponse(BaseModel):
    encounter_id: str
    reasoning: str
    confidence_scores: Dict[str, float]
    rule_trace: List[str] = Field(default_factory=list)


class DoctorOverride(BaseModel):
    encounter_id: str
    doctor_id: str
    original_suggestions: Dict[str, object]
    edited_suggestions: Dict[str, object]
    approved: bool
    comments: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
