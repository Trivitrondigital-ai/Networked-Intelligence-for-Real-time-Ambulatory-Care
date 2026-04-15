import { Router, Request, Response } from "express";
import { fhirClient } from "../services/hapiFhir";
import { getDb } from "../services/db";

export const fhirRouter = Router();

const ABHA_IDENTIFIER_SYSTEM = "https://abha.abdm.gov.in/health-id";

type FhirIdentifier = {
  system?: string;
  value?: string;
  use?: string;
  type?: unknown;
};

type FhirPatientResource = {
  id?: string;
  resourceType: "Patient";
  identifier?: FhirIdentifier[];
  [key: string]: unknown;
};

function emptyBundle() {
  return {
    resourceType: "Bundle",
    type: "searchset",
    entry: [],
  };
}

async function safeSearchResource(resourceType: string, params: Record<string, string>) {
  try {
    return await fhirClient.searchResource(resourceType, params);
  } catch {
    return emptyBundle();
  }
}

/**
 * GET /api/fhir/patient/:id - Get patient FHIR resource
 */
fhirRouter.get("/patient/:id", async (req: Request, res: Response) => {
  try {
    const patient = await fhirClient.getResource("Patient", req.params.id);
    return res.json(patient);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/fhir/patient/:id/everything - Get all resources for a patient
 */
fhirRouter.get("/patient/:id/everything", async (req: Request, res: Response) => {
  try {
    const [encounters, observations, conditions, compositions, medications, diagnosticReports] =
      await Promise.all([
        safeSearchResource("Encounter", { patient: req.params.id }),
        safeSearchResource("Observation", { patient: req.params.id }),
        safeSearchResource("Condition", { patient: req.params.id }),
        safeSearchResource("Composition", { patient: req.params.id }),
        safeSearchResource("MedicationRequest", { patient: req.params.id }),
        safeSearchResource("DiagnosticReport", { patient: req.params.id }),
      ]);

    return res.json({
      patientId: req.params.id,
      encounters,
      observations,
      conditions,
      compositions,
      medications,
      diagnosticReports,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/fhir/encounter/:id - Get encounter details
 */
fhirRouter.get("/encounter/:id", async (req: Request, res: Response) => {
  try {
    const encounter = await fhirClient.getResource("Encounter", req.params.id);
    return res.json(encounter);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/fhir/search/:resourceType - Search FHIR resources
 */
fhirRouter.get("/search/:resourceType", async (req: Request, res: Response) => {
  try {
    const allowedTypes = [
      "Patient", "Encounter", "Observation", "Condition",
      "Composition", "MedicationRequest", "DiagnosticReport",
    ];
    const resourceType = req.params.resourceType;
    if (!allowedTypes.includes(resourceType)) {
      return res.status(400).json({ error: "Invalid resource type" });
    }

    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") params[key] = value;
    }

    const result = await fhirClient.searchResource(resourceType, params);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/fhir/patient/:id/abha
 * Link or unlink ABHA ID for a patient in FHIR + audit in DB.
 */
fhirRouter.post("/patient/:id/abha", async (req: Request, res: Response) => {
  try {
    const patientId = req.params.id;
    const abhaRaw = typeof req.body?.abhaNumber === "string" ? req.body.abhaNumber.trim() : "";
    const localPatientId = typeof req.body?.localPatientId === "string" ? req.body.localPatientId : null;
    const linkedBy = typeof req.body?.linkedBy === "string" ? req.body.linkedBy : null;
    const normalizedAbha = abhaRaw.replace(/[\s-]/g, "");

    if (normalizedAbha && !/^[A-Za-z0-9]{10,20}$/.test(normalizedAbha)) {
      return res.status(400).json({ error: "Invalid ABHA format" });
    }

    const patient = (await fhirClient.getResource("Patient", patientId)) as FhirPatientResource;
    const existingIdentifiers = Array.isArray(patient.identifier) ? patient.identifier : [];

    const retainedIdentifiers = existingIdentifiers.filter(
      (identifier) => identifier?.system !== ABHA_IDENTIFIER_SYSTEM
    );

    const action = normalizedAbha ? "link" : "unlink";
    const nextIdentifiers = normalizedAbha
      ? [
          ...retainedIdentifiers,
          {
            system: ABHA_IDENTIFIER_SYSTEM,
            use: "official",
            value: normalizedAbha,
          },
        ]
      : retainedIdentifiers;

    const updatedPatient = await fhirClient.updateResource({
      ...patient,
      identifier: nextIdentifiers,
    } as FhirPatientResource);

    let dbPersisted = false;
    const db = getDb();
    if (db) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS patient_abha_links (
          id SERIAL PRIMARY KEY,
          patient_fhir_id VARCHAR(64) NOT NULL,
          local_patient_id VARCHAR(64),
          abha_number VARCHAR(32),
          action VARCHAR(16) NOT NULL,
          linked_by VARCHAR(128),
          payload JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await db.query(
        `INSERT INTO patient_abha_links
          (patient_fhir_id, local_patient_id, abha_number, action, linked_by, payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          patientId,
          localPatientId,
          normalizedAbha || null,
          action,
          linkedBy,
          JSON.stringify({
            route: "/api/fhir/patient/:id/abha",
            timestamp: new Date().toISOString(),
          }),
        ]
      );
      dbPersisted = true;
    }

    return res.status(200).json({
      success: true,
      action,
      patientId,
      abhaNumber: normalizedAbha || null,
      dbPersisted,
      patient: updatedPatient,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
