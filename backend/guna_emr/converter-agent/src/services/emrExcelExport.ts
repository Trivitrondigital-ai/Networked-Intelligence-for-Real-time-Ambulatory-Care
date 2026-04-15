import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import type { EmrStructuredData } from "../types";

type EmrExportStatus = "completed" | "failed";

export interface EmrExportRow {
  timestamp: string;
  logId?: number;
  inputType: string;
  status: EmrExportStatus;
  patientId?: string;
  encounterId?: string;
  queueToken?: number;
  resourcesCreated: string[];
  errors?: string[];
  structuredData?: EmrStructuredData;
  rawPayload: unknown;
}

const SHEET_NAME = "EMR_Log";
const SNAPSHOT_SHEET_NAME = "Queue_Snapshot";
const DEFAULT_EXPORT_DIR = path.resolve(process.cwd(), "exports");

function getExportDirectory(): string {
  const fromEnv = process.env.EMR_EXPORT_DIR?.trim();
  return fromEnv ? path.resolve(fromEnv) : DEFAULT_EXPORT_DIR;
}

function getExportFilePath(): string {
  const customFile = process.env.EMR_EXPORT_FILE?.trim();
  if (customFile) {
    return path.resolve(customFile);
  }
  return path.join(getExportDirectory(), "emr-data.xlsx");
}

function serializeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ensureWorkbookWithSheet(filePath: string): XLSX.WorkBook {
  if (fs.existsSync(filePath)) {
    const workbook = XLSX.readFile(filePath);
    if (!workbook.SheetNames.includes(SHEET_NAME)) {
      workbook.SheetNames.push(SHEET_NAME);
      workbook.Sheets[SHEET_NAME] = XLSX.utils.json_to_sheet([]);
    }
    if (!workbook.SheetNames.includes(SNAPSHOT_SHEET_NAME)) {
      workbook.SheetNames.push(SNAPSHOT_SHEET_NAME);
      workbook.Sheets[SNAPSHOT_SHEET_NAME] = XLSX.utils.json_to_sheet([]);
    }
    return workbook;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), SNAPSHOT_SHEET_NAME);
  return workbook;
}

export async function ensureEmrExportFile(): Promise<string> {
  const filePath = getExportFilePath();
  const exportDir = path.dirname(filePath);
  await fs.promises.mkdir(exportDir, { recursive: true });

  if (!fs.existsSync(filePath)) {
    const workbook = ensureWorkbookWithSheet(filePath);
    XLSX.writeFile(workbook, filePath);
  }

  return filePath;
}

export async function appendEmrExportRow(row: EmrExportRow): Promise<string> {
  const filePath = await ensureEmrExportFile();
  const workbook = ensureWorkbookWithSheet(filePath);
  const currentRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[SHEET_NAME] || XLSX.utils.json_to_sheet([]));

  currentRows.push({
    timestamp: row.timestamp,
    log_id: row.logId ?? null,
    input_type: row.inputType,
    processing_status: row.status,
    patient_id: row.patientId ?? null,
    encounter_id: row.encounterId ?? null,
    queue_token: row.queueToken ?? null,
    resources_created: serializeJson(row.resourcesCreated),
    errors: serializeJson(row.errors ?? []),
    structured_data: serializeJson(row.structuredData ?? null),
    raw_payload: serializeJson(row.rawPayload),
  });

  workbook.Sheets[SHEET_NAME] = XLSX.utils.json_to_sheet(currentRows);
  if (!workbook.SheetNames.includes(SHEET_NAME)) {
    workbook.SheetNames.push(SHEET_NAME);
  }

  const snapshotRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[SNAPSHOT_SHEET_NAME] || XLSX.utils.json_to_sheet([])
  );

  const snapshotRow = buildSnapshotRow(row);
  const existingIndex = snapshotRows.findIndex((entry) => String(entry.snapshot_key || "") === snapshotRow.snapshot_key);
  if (existingIndex >= 0) {
    snapshotRows[existingIndex] = snapshotRow;
  } else {
    snapshotRows.push(snapshotRow);
  }

  workbook.Sheets[SNAPSHOT_SHEET_NAME] = XLSX.utils.json_to_sheet(snapshotRows);
  if (!workbook.SheetNames.includes(SNAPSHOT_SHEET_NAME)) {
    workbook.SheetNames.push(SNAPSHOT_SHEET_NAME);
  }

  XLSX.writeFile(workbook, filePath);
  return filePath;
}

export function getEmrExportFilePath(): string {
  return getExportFilePath();
}

function buildSnapshotRow(row: EmrExportRow): Record<string, unknown> {
  const structured = row.structuredData;

  return {
    snapshot_key: buildSnapshotKey(row),
    last_updated: row.timestamp,
    log_id: row.logId ?? null,
    patient_id: row.patientId ?? null,
    encounter_id: row.encounterId ?? null,
    input_type: row.inputType,
    processing_status: row.status,
    queue_token: row.queueToken ?? null,
    chief_complaint: structured?.chiefComplaint ?? null,
    duration: structured?.duration ?? null,
    symptoms: serializeJson(structured?.symptoms ?? []),
    diagnoses: serializeJson(structured?.diagnoses ?? []),
    medications: serializeJson(structured?.medications ?? []),
    exam_findings: serializeJson(structured?.examFindings ?? []),
    vitals: serializeJson(structured?.vitals ?? {}),
    appointment_intent: structured?.appointment?.intent ?? false,
    appointment_doctor: structured?.appointment?.doctor ?? null,
    appointment_time: structured?.appointment?.time ?? null,
    appointment_date: structured?.appointment?.date ?? null,
    resources_created: serializeJson(row.resourcesCreated),
    last_error: row.errors?.[0] ?? null,
    structured_data: serializeJson(structured ?? null),
  };
}

function buildSnapshotKey(row: EmrExportRow): string {
  const patient = row.patientId?.trim();
  if (patient) return `patient:${patient}`;

  const encounter = row.encounterId?.trim();
  if (encounter) return `encounter:${encounter}`;

  return `log:${row.logId ?? row.timestamp}`;
}
