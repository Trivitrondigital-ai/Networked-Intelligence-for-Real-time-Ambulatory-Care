import type {
  CanonicalAiPreChart,
  CanonicalAssessment,
  CanonicalEmrRecord,
  CanonicalObjective,
  CanonicalPlan,
  CanonicalSubjective,
  DoctorEditLogEntry,
} from "../types";
import { getDb } from "./db";

const aiPrechartMemory = new Map<string, CanonicalAiPreChart>();
const emrRecordMemory = new Map<string, CanonicalEmrRecord>();

function parseJsonObject<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

export async function ensureCanonicalEmrSchema(): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_precharts (
      encounter_id VARCHAR(64) PRIMARY KEY,
      patient_fhir_id VARCHAR(64) NOT NULL,
      chief_complaint TEXT,
      history_of_present_illness TEXT,
      symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
      duration TEXT,
      severity TEXT,
      extracted_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
      confidence_score NUMERIC(5,4),
      raw_transcript TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS emr_records (
      encounter_id VARCHAR(64) PRIMARY KEY,
      patient_fhir_id VARCHAR(64) NOT NULL,
      subjective JSONB NOT NULL DEFAULT '{}'::jsonb,
      objective JSONB NOT NULL DEFAULT '{}'::jsonb,
      assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
      plan JSONB NOT NULL DEFAULT '{}'::jsonb,
      ai_prechart JSONB,
      doctor_edits_log JSONB NOT NULL DEFAULT '[]'::jsonb,
      approved BOOLEAN NOT NULL DEFAULT FALSE,
      approved_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      openmrs_sync_status VARCHAR(16) NOT NULL DEFAULT 'pending',
      openmrs_sync_message TEXT,
      openmrs_last_synced_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS doctor_edits_audit (
      id SERIAL PRIMARY KEY,
      encounter_id VARCHAR(64) NOT NULL,
      edited_by VARCHAR(128),
      section VARCHAR(32) NOT NULL,
      change_summary TEXT NOT NULL,
      before_payload JSONB,
      after_payload JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

export async function upsertAiPrechart(record: CanonicalAiPreChart): Promise<void> {
  const db = getDb();

  aiPrechartMemory.set(record.encounter_id, {
    ...record,
    updated_at: new Date().toISOString(),
    created_at: record.created_at || new Date().toISOString(),
  });

  if (!db) return;

  await db.query(
    `INSERT INTO ai_precharts (
      encounter_id, patient_fhir_id, chief_complaint, history_of_present_illness,
      symptoms, duration, severity, extracted_entities, confidence_score, raw_transcript,
      created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
     ON CONFLICT (encounter_id)
     DO UPDATE SET
      patient_fhir_id = EXCLUDED.patient_fhir_id,
      chief_complaint = EXCLUDED.chief_complaint,
      history_of_present_illness = EXCLUDED.history_of_present_illness,
      symptoms = EXCLUDED.symptoms,
      duration = EXCLUDED.duration,
      severity = EXCLUDED.severity,
      extracted_entities = EXCLUDED.extracted_entities,
      confidence_score = EXCLUDED.confidence_score,
      raw_transcript = EXCLUDED.raw_transcript,
      updated_at = NOW()`,
    [
      record.encounter_id,
      record.patient_id,
      record.chief_complaint || null,
      record.history_of_present_illness || null,
      JSON.stringify(record.symptoms || []),
      record.duration || null,
      record.severity || null,
      JSON.stringify(record.extracted_entities || {}),
      record.confidence_score ?? null,
      record.raw_transcript || null,
    ]
  );
}

export async function upsertEmrRecord(record: CanonicalEmrRecord): Promise<void> {
  const db = getDb();

  emrRecordMemory.set(record.encounter_id, {
    ...record,
    updated_at: new Date().toISOString(),
    created_at: record.created_at || new Date().toISOString(),
  });

  if (!db) return;

  await db.query(
    `INSERT INTO emr_records (
      encounter_id, patient_fhir_id, subjective, objective, assessment, plan,
      ai_prechart, doctor_edits_log, approved, approved_at, version,
      openmrs_sync_status, openmrs_sync_message, openmrs_last_synced_at,
      created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     ON CONFLICT (encounter_id)
     DO UPDATE SET
      patient_fhir_id = EXCLUDED.patient_fhir_id,
      subjective = EXCLUDED.subjective,
      objective = EXCLUDED.objective,
      assessment = EXCLUDED.assessment,
      plan = EXCLUDED.plan,
      ai_prechart = EXCLUDED.ai_prechart,
      doctor_edits_log = EXCLUDED.doctor_edits_log,
      approved = EXCLUDED.approved,
      approved_at = EXCLUDED.approved_at,
      version = EXCLUDED.version,
      openmrs_sync_status = EXCLUDED.openmrs_sync_status,
      openmrs_sync_message = EXCLUDED.openmrs_sync_message,
      openmrs_last_synced_at = EXCLUDED.openmrs_last_synced_at,
      updated_at = NOW()`,
    [
      record.encounter_id,
      record.patient_id,
      JSON.stringify(record.subjective || {}),
      JSON.stringify(record.objective || {}),
      JSON.stringify(record.assessment || {}),
      JSON.stringify(record.plan || {}),
      JSON.stringify(record.ai_prechart || null),
      JSON.stringify(record.doctor_edits_log || []),
      record.approved,
      record.approved_at || null,
      record.version,
      record.openmrs_sync_status || "pending",
      record.openmrs_sync_message || null,
      record.openmrs_last_synced_at || null,
    ]
  );
}

export async function initEmrRecord(encounterId: string, patientId: string): Promise<CanonicalEmrRecord> {
  const existing = await getEmrRecord(encounterId);
  if (existing) return existing;

  const next: CanonicalEmrRecord = {
    encounter_id: encounterId,
    patient_id: patientId,
    subjective: {},
    objective: {},
    assessment: {},
    plan: {},
    doctor_edits_log: [],
    approved: false,
    version: 1,
    openmrs_sync_status: "pending",
  };

  await upsertEmrRecord(next);
  return next;
}

export async function attachPrechartToEmr(params: {
  encounterId: string;
  patientId: string;
  prechart: CanonicalAiPreChart;
  subjective?: CanonicalSubjective;
}): Promise<CanonicalEmrRecord> {
  const existing = await initEmrRecord(params.encounterId, params.patientId);

  const updated: CanonicalEmrRecord = {
    ...existing,
    subjective: {
      ...existing.subjective,
      ...(params.subjective || {}),
    },
    ai_prechart: params.prechart,
    version: existing.version + 1,
    approved: false,
    approved_at: undefined,
    openmrs_sync_status: "pending",
    openmrs_sync_message: undefined,
  };

  await upsertEmrRecord(updated);
  return updated;
}

export async function getEmrRecord(encounterId: string): Promise<CanonicalEmrRecord | null> {
  const memory = emrRecordMemory.get(encounterId);
  if (memory) return memory;

  const db = getDb();
  if (!db) return null;

  const result = await db.query(
    `SELECT * FROM emr_records WHERE encounter_id = $1 LIMIT 1`,
    [encounterId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;

  return {
    encounter_id: String(row.encounter_id),
    patient_id: String(row.patient_fhir_id),
    subjective: parseJsonObject<CanonicalSubjective>(row.subjective, {}),
    objective: parseJsonObject<CanonicalObjective>(row.objective, {}),
    assessment: parseJsonObject<CanonicalAssessment>(row.assessment, {}),
    plan: parseJsonObject<CanonicalPlan>(row.plan, {}),
    ai_prechart: row.ai_prechart
      ? parseJsonObject<CanonicalAiPreChart | undefined>(row.ai_prechart, undefined)
      : undefined,
    doctor_edits_log: parseJsonObject<DoctorEditLogEntry[]>(row.doctor_edits_log, []),
    approved: Boolean(row.approved),
    approved_at: row.approved_at ? new Date(String(row.approved_at)).toISOString() : undefined,
    version: Number(row.version || 1),
    openmrs_sync_status: String(row.openmrs_sync_status || "pending") as
      | "pending"
      | "synced"
      | "failed",
    openmrs_sync_message: row.openmrs_sync_message ? String(row.openmrs_sync_message) : undefined,
    openmrs_last_synced_at: row.openmrs_last_synced_at
      ? new Date(String(row.openmrs_last_synced_at)).toISOString()
      : undefined,
    created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : undefined,
  };
}

export async function addDoctorEditAudit(params: {
  encounterId: string;
  editedBy?: string;
  section: DoctorEditLogEntry["section"];
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): Promise<DoctorEditLogEntry> {
  const entry: DoctorEditLogEntry = {
    at: new Date().toISOString(),
    by: params.editedBy,
    section: params.section,
    change_summary: params.summary,
    before: params.before,
    after: params.after,
  };

  const existing = await getEmrRecord(params.encounterId);
  if (existing) {
    const updated: CanonicalEmrRecord = {
      ...existing,
      doctor_edits_log: [...(existing.doctor_edits_log || []), entry],
      version: existing.version + 1,
    };
    await upsertEmrRecord(updated);
  }

  const db = getDb();
  if (db) {
    await db.query(
      `INSERT INTO doctor_edits_audit (encounter_id, edited_by, section, change_summary, before_payload, after_payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        params.encounterId,
        params.editedBy || null,
        params.section,
        params.summary,
        params.before ? JSON.stringify(params.before) : null,
        params.after ? JSON.stringify(params.after) : null,
      ]
    );
  }

  return entry;
}

export async function markEmrApproved(params: {
  encounterId: string;
  doctorName: string;
  subjective?: CanonicalSubjective;
  objective?: CanonicalObjective;
  assessment?: CanonicalAssessment;
  plan?: CanonicalPlan;
  openmrsSyncStatus?: "pending" | "synced" | "failed";
  openmrsSyncMessage?: string;
}): Promise<CanonicalEmrRecord> {
  const existing = await getEmrRecord(params.encounterId);
  if (!existing) {
    throw new Error("EMR record not found for encounter");
  }

  const approvedAt = new Date().toISOString();

  const updated: CanonicalEmrRecord = {
    ...existing,
    subjective: {
      ...existing.subjective,
      ...(params.subjective || {}),
    },
    objective: {
      ...existing.objective,
      ...(params.objective || {}),
    },
    assessment: {
      ...existing.assessment,
      ...(params.assessment || {}),
    },
    plan: {
      ...existing.plan,
      ...(params.plan || {}),
    },
    approved: true,
    approved_at: approvedAt,
    version: existing.version + 1,
    openmrs_sync_status: params.openmrsSyncStatus || existing.openmrs_sync_status || "pending",
    openmrs_sync_message: params.openmrsSyncMessage,
    openmrs_last_synced_at: params.openmrsSyncStatus === "synced" ? approvedAt : existing.openmrs_last_synced_at,
  };

  await upsertEmrRecord(updated);
  await addDoctorEditAudit({
    encounterId: params.encounterId,
    editedBy: params.doctorName,
    section: "approval",
    summary: "Doctor approved EMR record",
  });

  return updated;
}
