from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

from .models import Alert, MedicationRequest, Patient
from .terminology import normalize_medication_name


@dataclass(frozen=True)
class DDIRule:
    a: str
    b: str
    severity: str
    message: str
    blocked: bool
    rule_id: str


DDI_RULES: List[DDIRule] = [
    DDIRule(
        a="warfarin",
        b="aspirin",
        severity="critical",
        message="Warfarin + Aspirin significantly increases bleeding risk.",
        blocked=True,
        rule_id="DDI-CRIT-001",
    ),
    DDIRule(
        a="ibuprofen",
        b="warfarin",
        severity="high",
        message="Ibuprofen may increase anticoagulant bleeding risk with warfarin.",
        blocked=True,
        rule_id="DDI-HIGH-002",
    ),
    DDIRule(
        a="azithromycin",
        b="warfarin",
        severity="moderate",
        message="Azithromycin can elevate INR in patients on warfarin.",
        blocked=False,
        rule_id="DDI-MOD-003",
    ),
]

MAX_DAILY_DOSE_MG: Dict[str, float] = {
    "paracetamol": 4000,
    "ibuprofen": 2400,
    "amoxicillin_clavulanate": 1750,
}

ALLERGY_KEYWORDS: Dict[str, List[str]] = {
    "penicillin": ["amoxicillin", "amoxicillin_clavulanate"],
    "nsaid": ["ibuprofen", "aspirin", "diclofenac"],
}


class RuleEngine:
    """Deterministic, explainable clinical safety checks."""

    def normalize(self, medications: List[MedicationRequest]) -> List[MedicationRequest]:
        normalized: List[MedicationRequest] = []
        for med in medications:
            normalized.append(med.model_copy(update={"name": normalize_medication_name(med.name)}))
        return normalized

    def check_ddi(self, medications: List[MedicationRequest]) -> List[Alert]:
        meds = self.normalize(medications)
        names = [m.name for m in meds]
        alerts: List[Alert] = []

        for rule in DDI_RULES:
            if rule.a in names and rule.b in names:
                alerts.append(
                    Alert(
                        type="ddi",
                        severity=rule.severity,
                        message=rule.message,
                        blocked=rule.blocked,
                        explainable_rule_id=rule.rule_id,
                    )
                )
        return alerts

    def check_allergies(self, medications: List[MedicationRequest], patient: Patient) -> List[Alert]:
        meds = self.normalize(medications)
        patient_allergies = [a.lower() for a in patient.allergies]
        alerts: List[Alert] = []

        for allergy in patient_allergies:
            mapped = ALLERGY_KEYWORDS.get(allergy, [allergy])
            for med in meds:
                if med.name in mapped or allergy in med.name:
                    alerts.append(
                        Alert(
                            type="allergy",
                            severity="critical",
                            message=f"Allergy conflict: patient allergy '{allergy}' with medication '{med.name}'.",
                            blocked=True,
                            explainable_rule_id="ALG-CRIT-001",
                        )
                    )
        return alerts

    def validate_dose(self, medications: List[MedicationRequest], patient: Patient) -> List[Alert]:
        meds = self.normalize(medications)
        alerts: List[Alert] = []

        for med in meds:
            if med.dose is None:
                continue

            frequency = med.frequency_per_day or 1
            max_daily = MAX_DAILY_DOSE_MG.get(med.name)
            if not max_daily:
                continue

            unit = (med.unit or "mg").lower()
            if unit != "mg":
                continue

            daily_total = med.dose * frequency
            if daily_total > max_daily:
                alerts.append(
                    Alert(
                        type="dosage",
                        severity="high",
                        message=(
                            f"Daily dose for {med.name} is {daily_total} mg/day, exceeding safe limit {max_daily} mg/day."
                        ),
                        blocked=True,
                        explainable_rule_id="DOSE-HIGH-001",
                    )
                )

            if patient.age is not None and patient.age < 12 and med.name == "ibuprofen" and daily_total > 1200:
                alerts.append(
                    Alert(
                        type="dosage",
                        severity="high",
                        message="Pediatric ibuprofen dose exceeds conservative OPD threshold.",
                        blocked=True,
                        explainable_rule_id="DOSE-PEDS-002",
                    )
                )
        return alerts

    def validate_prescription(self, medications: List[MedicationRequest], patient: Patient) -> Tuple[bool, List[Alert], List[str]]:
        ddi_alerts = self.check_ddi(medications)
        allergy_alerts = self.check_allergies(medications, patient)
        dose_alerts = self.validate_dose(medications, patient)

        all_alerts = ddi_alerts + allergy_alerts + dose_alerts
        blocked = any(a.blocked for a in all_alerts)

        rule_trace = [
            "Applied rule set: DDI_RULES(v1)",
            "Applied rule set: ALLERGY_KEYWORDS(v1)",
            "Applied rule set: MAX_DAILY_DOSE_MG(v1)",
        ]
        return (not blocked, all_alerts, rule_trace)
