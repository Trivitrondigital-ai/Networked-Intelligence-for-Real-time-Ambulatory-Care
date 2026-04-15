import { Router, Request, Response } from "express";
import { z } from "zod";
import { extractMedicationSignals, getDdiWarnings } from "../services/medSafety";
import { extractEntitiesForEmrConversion } from "../services/nlpExtractor";
import { fhirClient } from "../services/hapiFhir";
import * as mapper from "../services/fhirMapper";
import {
  attachPrechartToEmr,
  getEmrRecord,
  initEmrRecord,
  markEmrApproved,
  upsertAiPrechart,
  addDoctorEditAudit,
} from "../services/emrPersistence";
import { pushBundleToOpenMrs } from "../services/openmrsSync";
import type {
  CanonicalAssessment,
  CanonicalPlan,
  CanonicalSubjective,
  EmrApproveRequest,
  FhirResource,
} from "../types";

export const emrRouter = Router();

const createEncounterSchema = z.object({
  patientId: z.string().min(1).optional(),
  patientPhone: z.string().min(5).optional(),
  patientName: z.string().min(1).optional(),
  doctorName: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  status: z.enum(["planned", "arrived", "triaged", "in-progress", "finished", "cancelled"]).optional(),
});

const prechartSchema = z.object({
  encounterId: z.string().min(1),
  patientId: z.string().min(1),
  transcript: z.string().min(5),
  chiefComplaint: z.string().optional(),
  historyOfPresentIllness: z.string().optional(),
  severity: z.string().optional(),
});

const approveSchema = z.object({
  encounterId: z.string().min(1),
  doctorName: z.string().min(1),
  subjective: z.record(z.any()).optional(),
  objective: z.record(z.any()).optional(),
  assessment: z.record(z.any()).optional(),
  plan: z.record(z.any()).optional(),
  doctorEditSummary: z.string().optional(),
});

function estimateConfidence(text: string, extractedCount: number): number {
  const lengthSignal = Math.min(0.35, text.trim().length / 1200);
  const extractionSignal = Math.min(0.55, extractedCount * 0.08);
  const baseline = 0.35;
  return Number(Math.min(0.99, baseline + lengthSignal + extractionSignal).toFixed(4));
}

function deriveSeverity(symptoms: string[]): string {
  const emergency = ["chest pain", "shortness of breath", "blood in stool", "blood in urine"];
  const urgent = ["fever", "vomiting", "diarrhea", "dizziness", "palpitations"];

  if (symptoms.some((item) => emergency.includes(item))) return "high";
  if (symptoms.some((item) => urgent.includes(item))) return "moderate";
  return "low";
}

function getDiagnosisNames(assessment?: CanonicalAssessment): string[] {
  const diagnoses = assessment?.diagnosis || [];
  return diagnoses.map((item) => item.name).filter(Boolean);
}

function suggestMedications(assessment?: CanonicalAssessment, subjective?: CanonicalSubjective): CanonicalPlan["medications"] {
  const diagnosisNames = getDiagnosisNames(assessment).map((item) => item.toLowerCase());
  const symptomNames = (subjective?.symptoms || []).map((item) => item.toLowerCase());

  const suggestions: CanonicalPlan["medications"] = [];

  const addSuggestion = (drug: string, dosage: string, frequency: string, duration: string, route = "PO") => {
    if (!suggestions?.some((med) => med.drug_name.toLowerCase() === drug.toLowerCase())) {
      suggestions?.push({ drug_name: drug, dosage, frequency, duration, route });
    }
  };

  if (diagnosisNames.some((dx) => dx.includes("fever") || dx.includes("viral")) || symptomNames.includes("fever")) {
    addSuggestion("Paracetamol", "500 mg", "TID", "3 days");
  }

  if (diagnosisNames.some((dx) => dx.includes("gastritis") || dx.includes("acid")) || symptomNames.includes("abdominal pain")) {
    addSuggestion("Pantoprazole", "40 mg", "OD", "5 days");
  }

  if (diagnosisNames.some((dx) => dx.includes("allergy") || dx.includes("urticaria")) || symptomNames.includes("itching")) {
    addSuggestion("Cetirizine", "10 mg", "HS", "5 days");
  }

  return suggestions || [];
}

emrRouter.post("/encounter/create", async (req: Request, res: Response) => {
  try {
    const parsed = createEncounterSchema.parse(req.body || {});

    let patientId = parsed.patientId;

    if (!patientId && parsed.patientPhone) {
      const existing = await fhirClient.findPatientByPhone(parsed.patientPhone);
      patientId = existing?.id;
    }

    if (!patientId) {
      const patient = await fhirClient.createResource(
        mapper.createPatient({
          phone: parsed.patientPhone,
          name: parsed.patientName,
        })
      );
      patientId = patient.id;
    }

    if (!patientId) {
      throw new Error("Unable to resolve patient ID");
    }

    const encounter = await fhirClient.createResource(
      mapper.createEncounter({
        patientId,
        status: parsed.status || "arrived",
        doctorName: parsed.doctorName,
        reason: parsed.reason || "OPD encounter",
      })
    );

    await initEmrRecord(encounter.id!, patientId);

    return res.status(201).json({
      success: true,
      patientId,
      encounterId: encounter.id,
      message: "Encounter created and canonical EMR record initialized",
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "Failed to create encounter" });
  }
});

emrRouter.post("/ai/prechart", async (req: Request, res: Response) => {
  try {
    const parsed = prechartSchema.parse(req.body || {});
    const extracted = await extractEntitiesForEmrConversion(parsed.transcript);

    const extractedCount = [
      extracted.symptoms.length,
      extracted.diagnoses.length,
      extracted.medications.length,
      extracted.examFindings.length,
      Object.values(extracted.vitals).filter((value) => value !== undefined).length,
    ].reduce((acc, value) => acc + value, 0);

    const severity = parsed.severity || deriveSeverity(extracted.symptoms);
    const confidence = estimateConfidence(parsed.transcript, extractedCount);

    const prechart = {
      encounter_id: parsed.encounterId,
      patient_id: parsed.patientId,
      chief_complaint: parsed.chiefComplaint || extracted.chiefComplaint,
      history_of_present_illness:
        parsed.historyOfPresentIllness ||
        [
          extracted.chiefComplaint ? `Chief complaint: ${extracted.chiefComplaint}` : "",
          extracted.duration ? `Duration: ${extracted.duration}` : "",
          extracted.symptoms.length > 0 ? `Symptoms: ${extracted.symptoms.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      symptoms: extracted.symptoms,
      duration: extracted.duration,
      severity,
      extracted_entities: extracted as unknown as Record<string, unknown>,
      confidence_score: confidence,
      raw_transcript: parsed.transcript,
    };

    await upsertAiPrechart(prechart);

    const emrRecord = await attachPrechartToEmr({
      encounterId: parsed.encounterId,
      patientId: parsed.patientId,
      prechart,
      subjective: {
        chief_complaint: prechart.chief_complaint,
        history: prechart.history_of_present_illness,
        symptoms: prechart.symptoms,
      },
    });

    return res.status(200).json({
      success: true,
      encounterId: parsed.encounterId,
      patientId: parsed.patientId,
      aiPrechart: prechart,
      emrRecord,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "Failed to persist AI prechart" });
  }
});

emrRouter.get("/emr/:encounterId", async (req: Request, res: Response) => {
  try {
    const encounterId = req.params.encounterId;
    const emrRecord = await getEmrRecord(encounterId);

    if (!emrRecord) {
      return res.status(404).json({ error: "EMR record not found" });
    }

    return res.status(200).json({ success: true, emrRecord });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to load EMR record" });
  }
});

emrRouter.post("/emr/approve", async (req: Request, res: Response) => {
  try {
    const parsed = approveSchema.parse(req.body || {}) as EmrApproveRequest;
    const existing = await getEmrRecord(parsed.encounterId);

    if (!existing) {
      return res.status(404).json({ error: "EMR record not found for encounter" });
    }

    const subjective = {
      ...existing.subjective,
      ...(parsed.subjective || {}),
    };
    const objective = {
      ...existing.objective,
      ...(parsed.objective || {}),
    };
    const assessment = {
      ...existing.assessment,
      ...(parsed.assessment || {}),
    };
    const plan = {
      ...existing.plan,
      ...(parsed.plan || {}),
    };

    if (parsed.doctorEditSummary?.trim()) {
      await addDoctorEditAudit({
        encounterId: parsed.encounterId,
        editedBy: parsed.doctorName,
        section: "assessment",
        summary: parsed.doctorEditSummary,
        before: {
          subjective: existing.subjective,
          objective: existing.objective,
          assessment: existing.assessment,
          plan: existing.plan,
        },
        after: {
          subjective,
          objective,
          assessment,
          plan,
        },
      });
    }

    const createdResources: FhirResource[] = [];

    for (const diagnosis of assessment.diagnosis || []) {
      const condition = await fhirClient.createResource(
        mapper.createCondition({
          patientId: existing.patient_id,
          encounterId: parsed.encounterId,
          diagnosisText: diagnosis.name,
        })
      );
      createdResources.push(condition);
    }

    for (const medication of plan.medications || []) {
      const dosageLine = [medication.dosage, medication.frequency, medication.duration]
        .filter(Boolean)
        .join(" | ");

      const medicationRequest = await fhirClient.createResource(
        mapper.createMedicationRequest({
          patientId: existing.patient_id,
          encounterId: parsed.encounterId,
          medicationName: medication.drug_name,
          doctorName: parsed.doctorName,
          dosage: dosageLine || undefined,
        })
      );
      createdResources.push(medicationRequest);
    }

    const composition = await fhirClient.createResource(
      mapper.createComposition({
        patientId: existing.patient_id,
        encounterId: parsed.encounterId,
        author: parsed.doctorName,
        title: "Final OPD EMR Record",
        sections: [
          {
            title: "Subjective",
            text: JSON.stringify(subjective),
          },
          {
            title: "Objective",
            text: JSON.stringify(objective),
          },
          {
            title: "Assessment",
            text: JSON.stringify(assessment),
          },
          {
            title: "Plan",
            text: JSON.stringify(plan),
          },
        ],
      })
    );
    createdResources.push(composition);

    const bundle = mapper.buildTransactionBundle(createdResources);
    const openmrsSync = await pushBundleToOpenMrs(bundle);

    const approvedRecord = await markEmrApproved({
      encounterId: parsed.encounterId,
      doctorName: parsed.doctorName,
      subjective,
      objective,
      assessment,
      plan,
      openmrsSyncStatus: openmrsSync.status,
      openmrsSyncMessage: openmrsSync.message,
    });

    return res.status(200).json({
      success: true,
      emrRecord: approvedRecord,
      resourcesCreated: createdResources.map((resource) => `${resource.resourceType}/${resource.id || "new"}`),
      openmrsSync,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "Failed to approve EMR record" });
  }
});

emrRouter.post("/prescription/generate", async (req: Request, res: Response) => {
  try {
    const encounterId = typeof req.body?.encounterId === "string" ? req.body.encounterId : "";
    if (!encounterId) return res.status(400).json({ error: "encounterId is required" });

    const emrRecord = await getEmrRecord(encounterId);
    if (!emrRecord) return res.status(404).json({ error: "EMR record not found" });

    const suggestions = suggestMedications(emrRecord.assessment, emrRecord.subjective) || [];
    const signalText = suggestions.map((item) => item.drug_name).join(" ");
    const signals = extractMedicationSignals(signalText);
    const ddiWarnings = getDdiWarnings(signals);

    return res.status(200).json({
      success: true,
      encounterId,
      suggestions,
      ddiWarnings,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to generate prescription" });
  }
});
