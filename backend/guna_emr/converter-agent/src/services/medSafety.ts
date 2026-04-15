import type { ChatDdiWarning, ChatMedicationSignal } from "../types";

const MEDICATION_ALIASES: Record<string, string[]> = {
  aspirin: ["aspirin", "ecosprin"],
  ibuprofen: ["ibuprofen", "brufen", "advil"],
  diclofenac: ["diclofenac", "voveran"],
  warfarin: ["warfarin", "coumadin"],
  metformin: ["metformin", "glycomet"],
  atorvastatin: ["atorvastatin", "atorva", "lipitor"],
  clopidogrel: ["clopidogrel", "clopilet"],
};

interface DdiRule {
  meds: [string, string];
  severity: "mild" | "moderate" | "severe";
  warning: string;
  recommendation: string;
}

const DDI_RULES: DdiRule[] = [
  {
    meds: ["warfarin", "aspirin"],
    severity: "severe",
    warning: "Higher bleeding risk when anticoagulant and antiplatelet are combined.",
    recommendation: "Needs clinician review with INR/bleeding-risk monitoring before continuation.",
  },
  {
    meds: ["warfarin", "ibuprofen"],
    severity: "severe",
    warning: "Marked GI and systemic bleeding risk with NSAID plus warfarin.",
    recommendation: "Avoid self-medication and contact clinician urgently for safer analgesic alternatives.",
  },
  {
    meds: ["aspirin", "ibuprofen"],
    severity: "moderate",
    warning: "Dual NSAID/antiplatelet effect can increase GI irritation and bleeding risk.",
    recommendation: "Use only on explicit clinician advice; report black stools, vomiting blood, or severe abdominal pain.",
  },
  {
    meds: ["atorvastatin", "warfarin"],
    severity: "moderate",
    warning: "May alter anticoagulation response in some patients.",
    recommendation: "Clinician should re-check medication timing and monitor coagulation profile.",
  },
];

function normalizeWord(value: string): string {
  return value.trim().toLowerCase();
}

function containsToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

export function extractMedicationSignals(text: string): ChatMedicationSignal[] {
  if (!text?.trim()) return [];

  const found: ChatMedicationSignal[] = [];
  const lower = text.toLowerCase();

  for (const [canonical, aliases] of Object.entries(MEDICATION_ALIASES)) {
    if (aliases.some((alias) => containsToken(lower, alias))) {
      found.push({ name: canonical, normalized: canonical });
    }
  }

  return found;
}

function hasMedication(signals: ChatMedicationSignal[], name: string) {
  return signals.some((item) => item.normalized === name);
}

export function getDdiWarnings(signals: ChatMedicationSignal[]): ChatDdiWarning[] {
  const warnings: ChatDdiWarning[] = [];

  for (const rule of DDI_RULES) {
    if (hasMedication(signals, rule.meds[0]) && hasMedication(signals, rule.meds[1])) {
      warnings.push({
        severity: rule.severity,
        medications: rule.meds,
        warning: rule.warning,
        recommendation: rule.recommendation,
      });
    }
  }

  return warnings;
}

export function getAdherenceTips(_language: "en", hasWarnings: boolean): string[] {
  return [
    "Take medicines on schedule and avoid missed doses.",
    "Keep a current medication list (photo or written) handy.",
    hasWarnings
      ? "A possible drug interaction was detected — avoid combining medicines until clinician confirmation."
      : "Before starting any new medicine, inform the clinician about all current medications.",
  ];
}
