/** FHIR R4 Resource type definitions for NIRA EMR */

export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: { lastUpdated?: string; profile?: string[] };
}

export interface FhirPatient extends FhirResource {
  resourceType: "Patient";
  name: Array<{ use: string; family: string; given: string[] }>;
  telecom?: Array<{ system: string; value: string; use?: string }>;
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  address?: Array<{ line?: string[]; city?: string; state?: string; postalCode?: string }>;
}

export interface FhirEncounter extends FhirResource {
  resourceType: "Encounter";
  status: "planned" | "arrived" | "triaged" | "in-progress" | "finished" | "cancelled";
  class: { system: string; code: string; display: string };
  subject: { reference: string };
  participant?: Array<{ individual: { reference: string; display: string } }>;
  period?: { start: string; end?: string };
  reasonCode?: Array<{ text: string }>;
}

export interface FhirObservation extends FhirResource {
  resourceType: "Observation";
  status: "final" | "preliminary" | "registered";
  category: Array<{ coding: Array<{ system: string; code: string; display: string }> }>;
  code: { coding: Array<{ system: string; code: string; display: string }>; text: string };
  subject: { reference: string };
  encounter?: { reference: string };
  effectiveDateTime?: string;
  valueQuantity?: { value: number; unit: string; system?: string; code?: string };
  valueString?: string;
  component?: Array<{
    code: { coding: Array<{ system: string; code: string; display: string }> };
    valueQuantity?: { value: number; unit: string };
  }>;
}

export interface FhirCondition extends FhirResource {
  resourceType: "Condition";
  clinicalStatus: { coding: Array<{ system: string; code: string }> };
  verificationStatus?: { coding: Array<{ system: string; code: string }> };
  category?: Array<{ coding: Array<{ system: string; code: string; display: string }> }>;
  code: { coding?: Array<{ system: string; code: string; display: string }>; text: string };
  subject: { reference: string };
  encounter?: { reference: string };
  recordedDate?: string;
}

export interface FhirComposition extends FhirResource {
  resourceType: "Composition";
  status: "preliminary" | "final" | "amended";
  type: { coding: Array<{ system: string; code: string; display: string }> };
  subject: { reference: string };
  encounter?: { reference: string };
  date: string;
  title: string;
  author: Array<{ display: string }>;
  section: Array<{
    title: string;
    code?: { coding: Array<{ system: string; code: string; display: string }> };
    text: { status: string; div: string };
  }>;
}

export interface FhirMedicationRequest extends FhirResource {
  resourceType: "MedicationRequest";
  status: "active" | "completed" | "cancelled" | "draft";
  intent: "order" | "plan" | "proposal";
  medicationCodeableConcept: { text: string; coding?: Array<{ system: string; code: string; display: string }> };
  subject: { reference: string };
  encounter?: { reference: string };
  authoredOn?: string;
  requester?: { display: string };
  dosageInstruction?: Array<{ text: string }>;
}

export interface FhirBundle extends FhirResource {
  resourceType: "Bundle";
  type: "transaction" | "collection" | "searchset";
  entry: Array<{
    resource: FhirResource;
    request?: { method: string; url: string };
  }>;
}

// Input types
export interface BookingInput {
  phone: string;
  time: string;
  doctor: string;
  patientName?: string;
  date?: string;
}

export interface AppointmentDetails {
  doctor: string;
  time: string;
  date?: string;
  source: "chat" | "form" | "auto";
}

export interface EmrAppointmentExtraction {
  intent: boolean;
  doctor?: string;
  time?: string;
  date?: string;
  source?: "chat" | "form" | "auto";
}

export interface EmrStructuredData {
  chiefComplaint?: string;
  duration?: string;
  symptoms: string[];
  vitals: {
    systolic?: number;
    diastolic?: number;
    heartRate?: number;
    temperature?: number;
    spo2?: number;
    weight?: number;
    respiratoryRate?: number;
  };
  diagnoses: string[];
  medications: string[];
  examFindings: string[];
  appointment: EmrAppointmentExtraction;
}

export interface SymptomInput {
  text: string;
  patientId?: string;
  patientPhone?: string;
  patientName?: string;
  userId?: string;
  role?: "patient" | "doctor" | "admin" | "nurse" | "unknown";
  language?: "en";
  contextKey?: string;
  summary?: string;
  transcript?: string;
  autoScheduleAppointment?: boolean;
  preferredDoctor?: string;
  preferredTime?: string;
  preferredDate?: string;
}

export interface DoctorNotesInput {
  text: string;
  patientId: string;
  encounterId?: string;
  doctorName: string;
}

export interface VitalsInput {
  patientId: string;
  encounterId?: string;
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
  temperature?: number;
  spo2?: number;
  weight?: number;
  height?: number;
  respiratoryRate?: number;
  rawText?: string;
}

export type ConvertInput =
  | { type: "booking"; data: BookingInput }
  | { type: "symptom"; data: SymptomInput }
  | { type: "doctor_notes"; data: DoctorNotesInput }
  | { type: "vitals"; data: VitalsInput }
  | { type: "raw"; data: { text: string; patientId?: string } };

export interface ConvertResult {
  success: boolean;
  inputType: string;
  resourcesCreated: string[];
  patientId?: string;
  encounterId?: string;
  queueToken?: number;
  appointmentScheduled?: boolean;
  appointmentDetails?: AppointmentDetails;
  emrStructuredData?: EmrStructuredData;
  errors?: string[];
}

export interface QueueEntry {
  id: number;
  patient_fhir_id: string;
  encounter_fhir_id: string | null;
  doctor_name: string | null;
  status: string;
  priority: number;
  token_number: number | null;
  check_in_time: string;
  called_time: string | null;
  completed_time: string | null;
  notes: string | null;
}

export type TriageLevel = "routine" | "urgent" | "emergency";
export type EscalationBand = "green" | "yellow" | "red";

export interface ChatFallbackChannels {
  whatsapp: boolean;
  sms: boolean;
  reason?: string;
}

export interface ChatMedicationSignal {
  name: string;
  normalized: string;
}

export interface ChatDdiWarning {
  severity: "mild" | "moderate" | "severe";
  medications: [string, string];
  warning: string;
  recommendation: string;
}

export interface ChatMemorySnapshot {
  contextKey: string;
  userId?: string;
  role?: "patient" | "doctor" | "admin" | "nurse" | "unknown";
  language?: "en";
  summary?: string;
  triageLevel?: TriageLevel;
  escalationBand?: EscalationBand;
  lastEncounterAt?: string;
  medications?: string[];
  allergies?: string[];
}

export interface CanonicalSubjective {
  chief_complaint?: string;
  history?: string;
  symptoms?: string[];
}

export interface CanonicalObjective {
  vitals?: {
    temperature?: number;
    bp?: string;
    pulse?: number;
    spo2?: number;
  };
  examination?: string;
}

export interface CanonicalAssessmentDiagnosis {
  name: string;
  icd10_code?: string;
  confidence?: number;
}

export interface CanonicalAssessment {
  diagnosis?: CanonicalAssessmentDiagnosis[];
  differential_diagnosis?: string[];
}

export interface CanonicalPlanMedication {
  drug_name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  route?: string;
}

export interface CanonicalPlan {
  medications?: CanonicalPlanMedication[];
  tests?: string[];
  advice?: string;
  follow_up_days?: number;
}

export interface CanonicalAiPreChart {
  encounter_id: string;
  patient_id: string;
  chief_complaint?: string;
  history_of_present_illness?: string;
  symptoms: string[];
  duration?: string;
  severity?: string;
  extracted_entities: Record<string, unknown>;
  confidence_score?: number;
  raw_transcript?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DoctorEditLogEntry {
  at: string;
  by?: string;
  section: "subjective" | "objective" | "assessment" | "plan" | "approval";
  change_summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface CanonicalEmrRecord {
  encounter_id: string;
  patient_id: string;
  subjective: CanonicalSubjective;
  objective: CanonicalObjective;
  assessment: CanonicalAssessment;
  plan: CanonicalPlan;
  ai_prechart?: CanonicalAiPreChart;
  doctor_edits_log: DoctorEditLogEntry[];
  approved: boolean;
  approved_at?: string;
  version: number;
  openmrs_sync_status?: "pending" | "synced" | "failed";
  openmrs_sync_message?: string;
  openmrs_last_synced_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EncounterCreateRequest {
  patientId?: string;
  patientPhone?: string;
  patientName?: string;
  doctorName?: string;
  reason?: string;
  status?: FhirEncounter["status"];
}

export interface AiPrechartRequest {
  encounterId: string;
  patientId: string;
  transcript: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  severity?: string;
}

export interface EmrApproveRequest {
  encounterId: string;
  doctorName: string;
  subjective?: CanonicalSubjective;
  objective?: CanonicalObjective;
  assessment?: CanonicalAssessment;
  plan?: CanonicalPlan;
  doctorEditSummary?: string;
}
