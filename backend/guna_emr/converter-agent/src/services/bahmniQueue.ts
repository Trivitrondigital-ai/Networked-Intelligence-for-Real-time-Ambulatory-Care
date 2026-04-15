/**
 * Bahmni/OpenMRS Integration - Queue management and OPD workflow.
 */

import { getDb } from "./db";
import type { QueueEntry } from "../types";

let inMemoryQueue: QueueEntry[] = [];
let tokenCounter = 0;

function nextToken(): number {
  return ++tokenCounter;
}

export async function addToQueue(opts: {
  patientFhirId: string;
  encounterId?: string;
  doctorName?: string;
  notes?: string;
  priority?: number;
}): Promise<QueueEntry> {
  const db = getDb();
  const tokenNumber = nextToken();

  if (db) {
    try {
      const result = await db.query(
        `INSERT INTO opd_queue (patient_fhir_id, encounter_fhir_id, doctor_name, status, priority, token_number, notes)
         VALUES ($1, $2, $3, 'waiting', $4, $5, $6)
         RETURNING *`,
        [opts.patientFhirId, opts.encounterId || null, opts.doctorName || null, opts.priority || 5, tokenNumber, opts.notes || null]
      );
      return result.rows[0];
    } catch { /* fall through to in-memory */ }
  }

  const entry: QueueEntry = {
    id: tokenNumber,
    patient_fhir_id: opts.patientFhirId,
    encounter_fhir_id: opts.encounterId || null,
    doctor_name: opts.doctorName || null,
    status: "waiting",
    priority: opts.priority || 5,
    token_number: tokenNumber,
    check_in_time: new Date().toISOString(),
    called_time: null,
    completed_time: null,
    notes: opts.notes || null,
  };
  inMemoryQueue.push(entry);
  return entry;
}

export async function getQueueForDoctor(doctorName: string): Promise<QueueEntry[]> {
  const db = getDb();
  if (db) {
    try {
      const result = await db.query(
        `SELECT * FROM opd_queue WHERE doctor_name = $1 AND status IN ('waiting', 'in-progress') ORDER BY priority ASC, check_in_time ASC`,
        [doctorName]
      );
      return result.rows;
    } catch { /* fall through */ }
  }
  return inMemoryQueue.filter((e) => e.doctor_name === doctorName && ["waiting", "in-progress"].includes(e.status));
}

export async function getFullQueue(): Promise<QueueEntry[]> {
  const db = getDb();
  if (db) {
    try {
      const result = await db.query(
        `SELECT * FROM opd_queue WHERE status IN ('waiting', 'in-progress') ORDER BY priority ASC, check_in_time ASC`
      );
      return result.rows;
    } catch { /* fall through */ }
  }
  return inMemoryQueue.filter((e) => ["waiting", "in-progress"].includes(e.status));
}

export async function updateQueueStatus(
  queueId: number,
  status: "waiting" | "in-progress" | "completed" | "cancelled"
): Promise<QueueEntry> {
  const db = getDb();
  if (db) {
    try {
      const timeField =
        status === "in-progress" ? ", called_time = NOW()" :
        status === "completed" ? ", completed_time = NOW()" : "";
      const result = await db.query(
        `UPDATE opd_queue SET status = $1, updated_at = NOW() ${timeField} WHERE id = $2 RETURNING *`,
        [status, queueId]
      );
      if (result.rows.length > 0) return result.rows[0];
    } catch { /* fall through */ }
  }
  const entry = inMemoryQueue.find((e) => e.id === queueId);
  if (!entry) throw new Error(`Queue entry ${queueId} not found`);
  entry.status = status;
  if (status === "in-progress") entry.called_time = new Date().toISOString();
  if (status === "completed") entry.completed_time = new Date().toISOString();
  return entry;
}

export async function logRawInput(inputType: string, rawPayload: any): Promise<number> {
  const db = getDb();
  if (db) {
    try {
      const result = await db.query(
        `INSERT INTO raw_input_log (input_type, raw_payload, processing_status) VALUES ($1, $2, 'processing') RETURNING id`,
        [inputType, JSON.stringify(rawPayload)]
      );
      return result.rows[0].id;
    } catch { /* fall through */ }
  }
  return Date.now(); // fallback ID
}

export async function updateRawInputLog(
  logId: number,
  resourcesCreated: string[],
  status: "completed" | "failed",
  errorMessage?: string
): Promise<void> {
  const db = getDb();
  if (db) {
    try {
      await db.query(
        `UPDATE raw_input_log SET fhir_resources_created = $1, processing_status = $2, error_message = $3 WHERE id = $4`,
        [JSON.stringify(resourcesCreated), status, errorMessage || null, logId]
      );
    } catch { /* ignore */ }
  }
}
