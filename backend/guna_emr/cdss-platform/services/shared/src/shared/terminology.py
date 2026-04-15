from __future__ import annotations

from typing import Dict, Optional

# Minimal local mappings; production would sync from official datasets.
RXNORM_NORMALIZATION: Dict[str, str] = {
    "acetaminophen": "paracetamol",
    "tylenol": "paracetamol",
    "crocin": "paracetamol",
    "advil": "ibuprofen",
    "brufen": "ibuprofen",
    "augmentin": "amoxicillin_clavulanate",
    "amoxicillin + clavulanic acid": "amoxicillin_clavulanate",
}

ICD10_LOOKUP: Dict[str, str] = {
    "viral upper respiratory infection": "J06.9",
    "hypertension": "I10",
    "type 2 diabetes mellitus": "E11.9",
    "acute pharyngitis": "J02.9",
    "acute bronchitis": "J20.9",
}

SNOMED_LOOKUP: Dict[str, str] = {
    "fever": "386661006",
    "cough": "49727002",
    "headache": "25064002",
    "dyspnea": "267036007",
    "vomiting": "422400008",
}

OPENFDA_HIGH_RISK_CLASSES: Dict[str, str] = {
    "warfarin": "anticoagulant",
    "aspirin": "antiplatelet",
    "insulin": "high-alert medication",
}


def normalize_medication_name(name: str) -> str:
    key = name.strip().lower()
    return RXNORM_NORMALIZATION.get(key, key)


def icd10_for_term(term: str) -> Optional[str]:
    return ICD10_LOOKUP.get(term.strip().lower())


def snomed_for_symptom(term: str) -> Optional[str]:
    return SNOMED_LOOKUP.get(term.strip().lower())
