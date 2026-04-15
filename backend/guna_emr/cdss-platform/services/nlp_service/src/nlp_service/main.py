from __future__ import annotations

import logging
import os
import re
from typing import Dict, List

from fastapi import FastAPI
from pydantic import BaseModel, Field
from shared.models import ExtractedEntity, StructuredNLPOutput
from shared.terminology import snomed_for_symptom

logger = logging.getLogger("nlp_service")
logging.basicConfig(level=logging.INFO)


class NLPExtractRequest(BaseModel):
    transcript: str = Field(..., min_length=5)


SYMPTOM_VOCAB = [
    "fever",
    "cough",
    "headache",
    "dyspnea",
    "shortness of breath",
    "vomiting",
    "chest pain",
    "diarrhea",
]
SEVERITY_VOCAB = ["mild", "moderate", "severe", "intense", "worsening"]
DURATION_PATTERNS = [r"\b\d+\s*(day|days|week|weeks|month|months|hour|hours)\b", r"since\s+\w+"]
HISTORY_HINTS = ["diabetes", "hypertension", "asthma", "thyroid", "surgery", "allergy"]


class NLPExtractor:
    def __init__(self) -> None:
        self._spacy_nlp = None
        self._medcat = None
        self._load_backends()

    def _load_backends(self) -> None:
        use_spacy = os.getenv("NLP_USE_SPACY", "true").lower() == "true"
        use_medcat = os.getenv("NLP_USE_MEDCAT", "true").lower() == "true"

        if use_spacy:
            try:
                import spacy  # type: ignore

                self._spacy_nlp = spacy.load(os.getenv("SPACY_MODEL", "en_core_web_sm"))
                logger.info("spaCy model loaded")
            except Exception as ex:
                logger.warning("spaCy unavailable: %s", ex)

        if use_medcat:
            model_path = os.getenv("MEDCAT_MODEL_PATH", "")
            if not model_path:
                logger.warning("MEDCAT_MODEL_PATH not set; skipping MedCAT initialization")
                return
            try:
                from medcat.cat import CAT  # type: ignore

                self._medcat = CAT.load_model_pack(model_path)
                logger.info("MedCAT loaded from %s", model_path)
            except Exception as ex:
                logger.warning("MedCAT unavailable: %s", ex)

    def _extract_with_regex(self, transcript: str) -> StructuredNLPOutput:
        lower = transcript.lower()

        symptoms: List[ExtractedEntity] = []
        for symptom in SYMPTOM_VOCAB:
            if symptom in lower:
                base = "dyspnea" if symptom == "shortness of breath" else symptom
                symptoms.append(
                    ExtractedEntity(
                        text=base,
                        code=snomed_for_symptom(base),
                        coding_system="SNOMED-CT",
                        confidence=0.75,
                    )
                )

        duration: List[ExtractedEntity] = []
        for pattern in DURATION_PATTERNS:
            for match in re.findall(pattern, lower):
                value = match if isinstance(match, str) else " ".join(match)
                duration.append(ExtractedEntity(text=value, confidence=0.8))

        severity = [
            ExtractedEntity(text=word, confidence=0.7)
            for word in SEVERITY_VOCAB
            if word in lower
        ]

        history = [
            ExtractedEntity(text=term, confidence=0.65)
            for term in HISTORY_HINTS
            if term in lower
        ]

        return StructuredNLPOutput(
            symptoms=symptoms,
            duration=duration,
            severity=severity,
            medical_history=history,
        )

    def extract(self, transcript: str) -> StructuredNLPOutput:
        output = self._extract_with_regex(transcript)

        if self._spacy_nlp:
            doc = self._spacy_nlp(transcript)
            for ent in doc.ents:
                if ent.label_ in {"DATE", "TIME"}:
                    output.duration.append(ExtractedEntity(text=ent.text, confidence=0.6))

        if self._medcat:
            try:
                entities = self._medcat.get_entities(transcript)
                for _, details in entities.get("entities", {}).items():
                    name = details.get("pretty_name") or details.get("detected_name")
                    if not name:
                        continue
                    output.medical_history.append(
                        ExtractedEntity(
                            text=str(name).lower(),
                            code=str(details.get("cui") or ""),
                            coding_system="UMLS/MedCAT",
                            confidence=float(details.get("acc") or 0.6),
                        )
                    )
            except Exception as ex:
                logger.warning("MedCAT extraction failed: %s", ex)

        return output


extractor = NLPExtractor()
app = FastAPI(title="NLP Service", version="1.0.0", description="spaCy + MedCAT structured extraction")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "nlp_service"}


@app.post("/nlp/extract", response_model=StructuredNLPOutput)
def extract_entities(payload: NLPExtractRequest) -> StructuredNLPOutput:
    return extractor.extract(payload.transcript)
