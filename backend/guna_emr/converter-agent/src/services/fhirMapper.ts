/**
 * FHIR R4 Resource Mapper - Converts extracted entities into FHIR resources.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  FhirPatient, FhirEncounter, FhirObservation, FhirCondition,
  FhirComposition, FhirMedicationRequest, FhirBundle,
} from "../types";
import type { ExtractedEntities } from "./nlpExtractor";

const LOINC = "http://loinc.org";
const SNOMED = "http://snomed.info/sct";
const ICD10 = "http://hl7.org/fhir/sid/icd-10";
const ENCOUNTER_CLASS_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode";

export function createPatient(opts: {
  phone?: string;
  name?: string;
  gender?: string;
  birthDate?: string;
}): FhirPatient {
  const nameParts = (opts.name || "Unknown Patient").split(" ");
  const family = nameParts.pop() || "Unknown";
  const given = nameParts.length > 0 ? nameParts : ["Unknown"];

  return {
    resourceType: "Patient",
    name: [{ use: "official", family, given }],
    telecom: opts.phone
      ? [{ system: "phone", value: opts.phone, use: "mobile" }]
      : undefined,
    gender: (opts.gender as any) || "unknown",
    birthDate: opts.birthDate,
  };
}

export function createEncounter(opts: {
  patientId: string;
  status: FhirEncounter["status"];
  doctorName?: string;
  reason?: string;
}): FhirEncounter {
  return {
    resourceType: "Encounter",
    status: opts.status,
    class: {
      system: ENCOUNTER_CLASS_SYSTEM,
      code: "AMB",
      display: "ambulatory",
    },
    subject: { reference: `Patient/${opts.patientId}` },
    participant: opts.doctorName
      ? [{ individual: { reference: "Practitioner/unknown", display: opts.doctorName } }]
      : undefined,
    period: { start: new Date().toISOString() },
    reasonCode: opts.reason ? [{ text: opts.reason }] : undefined,
  };
}

export function createBloodPressureObservation(opts: {
  patientId: string;
  encounterId?: string;
  systolic: number;
  diastolic: number;
}): FhirObservation {
  return {
    resourceType: "Observation",
    status: "final",
    category: [{
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }],
    }],
    code: {
      coding: [{ system: LOINC, code: "85354-9", display: "Blood pressure panel" }],
      text: "Blood Pressure",
    },
    subject: { reference: `Patient/${opts.patientId}` },
    encounter: opts.encounterId ? { reference: `Encounter/${opts.encounterId}` } : undefined,
    effectiveDateTime: new Date().toISOString(),
    component: [
      {
        code: { coding: [{ system: LOINC, code: "8480-6", display: "Systolic blood pressure" }] },
        valueQuantity: { value: opts.systolic, unit: "mmHg" },
      },
      {
        code: { coding: [{ system: LOINC, code: "8462-4", display: "Diastolic blood pressure" }] },
        valueQuantity: { value: opts.diastolic, unit: "mmHg" },
      },
    ],
  };
}

export function createVitalObservation(opts: {
  patientId: string;
  encounterId?: string;
  type: "heart-rate" | "temperature" | "spo2" | "weight" | "respiratory-rate";
  value: number;
}): FhirObservation {
  const codeMap: Record<string, { code: string; display: string; unit: string }> = {
    "heart-rate": { code: "8867-4", display: "Heart rate", unit: "bpm" },
    temperature: { code: "8310-5", display: "Body temperature", unit: "°F" },
    spo2: { code: "2708-6", display: "Oxygen saturation", unit: "%" },
    weight: { code: "29463-7", display: "Body weight", unit: "kg" },
    "respiratory-rate": { code: "9279-1", display: "Respiratory rate", unit: "/min" },
  };

  const info = codeMap[opts.type];
  return {
    resourceType: "Observation",
    status: "final",
    category: [{
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }],
    }],
    code: {
      coding: [{ system: LOINC, code: info.code, display: info.display }],
      text: info.display,
    },
    subject: { reference: `Patient/${opts.patientId}` },
    encounter: opts.encounterId ? { reference: `Encounter/${opts.encounterId}` } : undefined,
    effectiveDateTime: new Date().toISOString(),
    valueQuantity: { value: opts.value, unit: info.unit },
  };
}

export function createCondition(opts: {
  patientId: string;
  encounterId?: string;
  diagnosisText: string;
}): FhirCondition {
  return {
    resourceType: "Condition",
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
    verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "provisional" }] },
    code: {
      text: opts.diagnosisText,
      coding: [{ system: ICD10, code: "R69", display: opts.diagnosisText }],
    },
    subject: { reference: `Patient/${opts.patientId}` },
    encounter: opts.encounterId ? { reference: `Encounter/${opts.encounterId}` } : undefined,
    recordedDate: new Date().toISOString(),
  };
}

export function createComposition(opts: {
  patientId: string;
  encounterId?: string;
  author: string;
  title: string;
  sections: Array<{ title: string; text: string }>;
}): FhirComposition {
  return {
    resourceType: "Composition",
    status: "preliminary",
    type: {
      coding: [{ system: LOINC, code: "11488-4", display: "Consult note" }],
    },
    subject: { reference: `Patient/${opts.patientId}` },
    encounter: opts.encounterId ? { reference: `Encounter/${opts.encounterId}` } : undefined,
    date: new Date().toISOString(),
    title: opts.title,
    author: [{ display: opts.author }],
    section: opts.sections.map((s) => ({
      title: s.title,
      text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(s.text)}</div>` },
    })),
  };
}

export function createMedicationRequest(opts: {
  patientId: string;
  encounterId?: string;
  medicationName: string;
  doctorName: string;
  dosage?: string;
}): FhirMedicationRequest {
  return {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    medicationCodeableConcept: { text: opts.medicationName },
    subject: { reference: `Patient/${opts.patientId}` },
    encounter: opts.encounterId ? { reference: `Encounter/${opts.encounterId}` } : undefined,
    authoredOn: new Date().toISOString(),
    requester: { display: opts.doctorName },
    dosageInstruction: opts.dosage ? [{ text: opts.dosage }] : undefined,
  };
}

export function buildTransactionBundle(resources: any[]): FhirBundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: resources.map((r) => ({
      resource: r,
      request: {
        method: r.id ? "PUT" : "POST",
        url: r.id ? `${r.resourceType}/${r.id}` : r.resourceType,
      },
    })),
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
