/**
 * Universal Converter - Orchestrates input detection, NLP extraction,
 * FHIR mapping, persistence, and queue management.
 */

import { extractEntities, extractEntitiesForEmrConversion } from "./nlpExtractor";
import * as mapper from "./fhirMapper";
import { fhirClient } from "./hapiFhir";
import * as queue from "./bahmniQueue";
import { publishQueueRealtimeEvent, resolveChatContextKey } from "./chatContext";
import { appendEmrExportRow } from "./emrExcelExport";
import type {
  BookingInput, SymptomInput, DoctorNotesInput, VitalsInput,
  ConvertInput, ConvertResult, AppointmentDetails, EmrStructuredData,
} from "../types";

/**
 * Detect input type from raw data.
 */
export function detectInputType(data: any): ConvertInput {
  if (typeof data === "string") {
    // Free text — could be symptom or doctor notes
    // Heuristic: if it contains dx/rx/exam → doctor notes
    if (/\b(dx|rx|diagnosis|prescribed|exam|impression|assessment)\b/i.test(data)) {
      return { type: "doctor_notes", data: { text: data, patientId: "unknown", doctorName: "Unknown" } };
    }
    return { type: "symptom", data: { text: data } };
  }

  if (typeof data === "object") {
    if (data.type) return data as ConvertInput;
    if (data.text && data.doctorName) return { type: "doctor_notes", data: data as DoctorNotesInput };
    if (data.text) return { type: "symptom", data: data as SymptomInput };
    if (data.phone && data.doctor) return { type: "booking", data: data as BookingInput };
    if (data.phone && data.time) return { type: "booking", data: data as BookingInput };
    if (data.systolic || data.heartRate || data.temperature || data.spo2) {
      return { type: "vitals", data: data as VitalsInput };
    }
  }

  return { type: "raw", data: { text: JSON.stringify(data) } };
}

/**
 * Process booking input → Patient + Encounter(planned)
 */
async function processBooking(input: BookingInput): Promise<ConvertResult> {
  const resourcesCreated: string[] = [];

  // Find or create patient
  let patient: any = null;
  if (input.phone) {
    patient = await fhirClient.findPatientByPhone(input.phone);
  }
  if (!patient) {
    patient = await fhirClient.createResource(
      mapper.createPatient({ phone: input.phone, name: input.patientName })
    );
    resourcesCreated.push(`Patient/${patient.id}`);
  }

  // Create planned encounter
  const encounter = await fhirClient.createResource(
    mapper.createEncounter({
      patientId: patient.id,
      status: "planned",
      doctorName: input.doctor,
      reason: `Appointment at ${input.time}`,
    })
  );
  resourcesCreated.push(`Encounter/${encounter.id}`);

  // Add to queue
  const queueEntry = await queue.addToQueue({
    patientFhirId: patient.id,
    encounterId: encounter.id,
    doctorName: input.doctor,
    notes: `Booked for ${input.time}`,
  });

  const contextKey = resolveChatContextKey({ patientPhone: input.phone, role: "patient" });
  await publishQueueRealtimeEvent({
    contextKey,
    eventType: "booking-created",
    escalationBand: "green",
    triageLevel: "routine",
    queueToken: queueEntry.token_number ?? undefined,
    encounterId: encounter.id,
    message: `Booking created for ${input.doctor} at ${input.time}`,
  });

  return {
    success: true,
    inputType: "booking",
    resourcesCreated,
    patientId: patient.id,
    encounterId: encounter.id,
    queueToken: queueEntry.token_number ?? undefined,
    appointmentScheduled: true,
    appointmentDetails: {
      doctor: input.doctor,
      time: input.time,
      date: input.date,
      source: "form",
    },
    emrStructuredData: {
      chiefComplaint: "Appointment booking",
      symptoms: [],
      vitals: {},
      diagnoses: [],
      medications: [],
      examFindings: [],
      appointment: {
        intent: true,
        doctor: input.doctor,
        time: input.time,
        date: input.date,
        source: "form",
      },
    },
  };
}

/**
 * Process symptom text → Composition + Observations + Encounter(arrived)
 */
async function processSymptoms(input: SymptomInput): Promise<ConvertResult> {
  const resourcesCreated: string[] = [];
  const extractionText = input.summary?.trim() || input.text;
  const transcript = input.transcript?.trim();
  const entities = await extractEntitiesForEmrConversion(extractionText);
  const shouldScheduleAppointment =
    Boolean(input.autoScheduleAppointment) ||
    entities.appointment.intent ||
    Boolean(input.preferredDoctor || input.preferredTime || input.preferredDate);
  const appointmentDetails = shouldScheduleAppointment
    ? buildAppointmentDetails(input, entities)
    : undefined;

  // Find or create patient
  let patientId = input.patientId;
  if (!patientId && input.patientPhone) {
    const existing = await fhirClient.findPatientByPhone(input.patientPhone);
    patientId = existing ? (existing as any).id : undefined;
  }
  if (!patientId) {
    const patient = await fhirClient.createResource(
      mapper.createPatient({ phone: input.patientPhone, name: input.patientName })
    );
    patientId = patient.id!;
    resourcesCreated.push(`Patient/${patientId}`);
  }

  // Create encounter. Appointment requests from chat become planned visits.
  const encounter = await fhirClient.createResource(
    mapper.createEncounter({
      patientId,
      status: shouldScheduleAppointment ? "planned" : "arrived",
      doctorName: appointmentDetails?.doctor,
      reason: shouldScheduleAppointment
        ? buildAppointmentReason(entities.chiefComplaint, appointmentDetails!)
        : entities.chiefComplaint || "Symptom interview",
    })
  );
  resourcesCreated.push(`Encounter/${encounter.id}`);

  // Create vitals observations
  const { vitals } = entities;
  if (vitals.systolic && vitals.diastolic) {
    const obs = await fhirClient.createResource(
      mapper.createBloodPressureObservation({
        patientId,
        encounterId: encounter.id,
        systolic: vitals.systolic,
        diastolic: vitals.diastolic,
      })
    );
    resourcesCreated.push(`Observation/${obs.id}`);
  }

  const vitalTypes: Array<{ key: keyof typeof vitals; type: any }> = [
    { key: "heartRate", type: "heart-rate" },
    { key: "temperature", type: "temperature" },
    { key: "spo2", type: "spo2" },
    { key: "weight", type: "weight" },
    { key: "respiratoryRate", type: "respiratory-rate" },
  ];
  for (const vt of vitalTypes) {
    if (vitals[vt.key]) {
      const obs = await fhirClient.createResource(
        mapper.createVitalObservation({
          patientId,
          encounterId: encounter.id,
          type: vt.type,
          value: vitals[vt.key]!,
        })
      );
      resourcesCreated.push(`Observation/${obs.id}`);
    }
  }

  // Create composition with chief complaint
  if (entities.symptoms.length > 0 || entities.chiefComplaint) {
    const comp = await fhirClient.createResource(
      mapper.createComposition({
        patientId,
        encounterId: encounter.id,
        author: "Patient/System",
        title: "Symptom Interview",
        sections: [
          { title: "Chief Complaint", text: entities.chiefComplaint || entities.symptoms.join(", ") },
          ...(entities.symptoms.length > 0
            ? [{ title: "Symptoms", text: entities.symptoms.join(", ") }]
            : []),
          ...(entities.duration
            ? [{ title: "Duration", text: entities.duration }]
            : []),
          ...(input.summary
            ? [{ title: "AI Intake Summary", text: input.summary }]
            : []),
          ...(transcript
            ? [{ title: "Chat Transcript", text: transcript }]
            : []),
          ...(appointmentDetails
            ? [{ title: "Appointment Request", text: formatAppointmentDetails(appointmentDetails) }]
            : []),
        ],
      })
    );
    resourcesCreated.push(`Composition/${comp.id}`);
  }

  // Add to queue
  const queueEntry = await queue.addToQueue({
    patientFhirId: patientId,
    encounterId: encounter.id,
    doctorName: appointmentDetails?.doctor,
    notes: appointmentDetails
      ? `${formatAppointmentDetails(appointmentDetails)}${entities.chiefComplaint ? ` | Symptoms: ${entities.chiefComplaint}` : ""}`
      : entities.chiefComplaint,
  });

  const triageLevel = entities.symptoms.some((symptom) =>
    ["chest pain", "shortness of breath", "blood in stool", "blood in urine"].includes(symptom)
  )
    ? "emergency"
    : entities.symptoms.some((symptom) =>
        ["fever", "vomiting", "diarrhea", "dizziness", "palpitations"].includes(symptom)
      )
      ? "urgent"
      : "routine";

  const escalationBand = triageLevel === "emergency" ? "red" : triageLevel === "urgent" ? "yellow" : "green";
  const contextKey =
    input.contextKey ||
    resolveChatContextKey({
      userId: input.userId,
      role: input.role,
      patientPhone: input.patientPhone,
    });

  await publishQueueRealtimeEvent({
    contextKey,
    eventType: "queue-updated",
    escalationBand,
    triageLevel,
    queueToken: queueEntry.token_number ?? undefined,
    encounterId: encounter.id,
    message: appointmentDetails
      ? `Triage converted to queue and appointment requested with ${appointmentDetails.doctor}`
      : "Triage converted to queue successfully.",
  });

  return {
    success: true,
    inputType: "symptom",
    resourcesCreated,
    patientId,
    encounterId: encounter.id,
    queueToken: queueEntry.token_number ?? undefined,
    appointmentScheduled: shouldScheduleAppointment,
    appointmentDetails,
    emrStructuredData: buildStructuredDataFromEntities(entities, appointmentDetails),
  };
}

/**
 * Process doctor notes → Composition + Condition + MedicationRequest updates
 */
async function processDoctorNotes(input: DoctorNotesInput): Promise<ConvertResult> {
  const resourcesCreated: string[] = [];
  const entities = await extractEntitiesForEmrConversion(input.text);
  const patientId = input.patientId;
  const encounterId = input.encounterId;

  // Composition with exam + plan
  const sections: Array<{ title: string; text: string }> = [];
  if (entities.examFindings.length > 0) {
    sections.push({ title: "Physical Examination", text: entities.examFindings.join("; ") });
  }
  if (entities.diagnoses.length > 0) {
    sections.push({ title: "Assessment", text: entities.diagnoses.join(", ") });
  }
  if (entities.medications.length > 0) {
    sections.push({ title: "Plan", text: entities.medications.join(", ") });
  }
  if (sections.length === 0) {
    sections.push({ title: "Clinical Notes", text: input.text });
  }

  const comp = await fhirClient.createResource(
    mapper.createComposition({
      patientId,
      encounterId,
      author: input.doctorName,
      title: "Doctor Notes",
      sections,
    })
  );
  resourcesCreated.push(`Composition/${comp.id}`);

  // Create conditions
  for (const dx of entities.diagnoses) {
    const cond = await fhirClient.createResource(
      mapper.createCondition({ patientId, encounterId, diagnosisText: dx })
    );
    resourcesCreated.push(`Condition/${cond.id}`);
  }

  // Create medication requests
  for (const med of entities.medications) {
    const rx = await fhirClient.createResource(
      mapper.createMedicationRequest({
        patientId,
        encounterId,
        medicationName: med,
        doctorName: input.doctorName,
      })
    );
    resourcesCreated.push(`MedicationRequest/${rx.id}`);
  }

  // Extract vitals from doctor notes too
  const { vitals } = entities;
  if (vitals.systolic && vitals.diastolic) {
    const obs = await fhirClient.createResource(
      mapper.createBloodPressureObservation({
        patientId,
        encounterId,
        systolic: vitals.systolic,
        diastolic: vitals.diastolic,
      })
    );
    resourcesCreated.push(`Observation/${obs.id}`);
  }

  return {
    success: true,
    inputType: "doctor_notes",
    resourcesCreated,
    patientId,
    encounterId,
    emrStructuredData: buildStructuredDataFromEntities(entities),
  };
}

/**
 * Process structured vitals → Observations
 */
async function processVitals(input: VitalsInput): Promise<ConvertResult> {
  const resourcesCreated: string[] = [];
  let extractedFromRawText: ReturnType<typeof extractEntities> | undefined;

  // If rawText provided, extract first
  if (input.rawText) {
    const entities = await extractEntitiesForEmrConversion(input.rawText);
    extractedFromRawText = entities;
    Object.assign(input, {
      systolic: input.systolic || entities.vitals.systolic,
      diastolic: input.diastolic || entities.vitals.diastolic,
      heartRate: input.heartRate || entities.vitals.heartRate,
      temperature: input.temperature || entities.vitals.temperature,
      spo2: input.spo2 || entities.vitals.spo2,
      weight: input.weight || entities.vitals.weight,
      respiratoryRate: input.respiratoryRate || entities.vitals.respiratoryRate,
    });
  }

  const patientId = input.patientId;
  const encounterId = input.encounterId;

  if (input.systolic && input.diastolic) {
    const obs = await fhirClient.createResource(
      mapper.createBloodPressureObservation({
        patientId, encounterId,
        systolic: input.systolic, diastolic: input.diastolic,
      })
    );
    resourcesCreated.push(`Observation/${obs.id}`);
  }

  const vitalEntries: Array<[number | undefined, string]> = [
    [input.heartRate, "heart-rate"],
    [input.temperature, "temperature"],
    [input.spo2, "spo2"],
    [input.weight, "weight"],
    [input.respiratoryRate, "respiratory-rate"],
  ];

  for (const [value, type] of vitalEntries) {
    if (value) {
      const obs = await fhirClient.createResource(
        mapper.createVitalObservation({ patientId, encounterId, type: type as any, value })
      );
      resourcesCreated.push(`Observation/${obs.id}`);
    }
  }

  return {
    success: true,
    inputType: "vitals",
    resourcesCreated,
    patientId,
    encounterId,
    emrStructuredData: extractedFromRawText
      ? buildStructuredDataFromEntities(extractedFromRawText)
      : {
          symptoms: [],
          vitals: {
            systolic: input.systolic,
            diastolic: input.diastolic,
            heartRate: input.heartRate,
            temperature: input.temperature,
            spo2: input.spo2,
            weight: input.weight,
            respiratoryRate: input.respiratoryRate,
          },
          diagnoses: [],
          medications: [],
          examFindings: [],
          appointment: { intent: false },
        },
  };
}

/**
 * Main universal convert function.
 */
export async function universalConvert(rawData: any): Promise<ConvertResult> {
  const input = detectInputType(rawData);
  const logId = await queue.logRawInput(input.type, rawData);

  try {
    let result: ConvertResult;

    switch (input.type) {
      case "booking":
        result = await processBooking(input.data);
        break;
      case "symptom":
        result = await processSymptoms(input.data);
        break;
      case "doctor_notes":
        result = await processDoctorNotes(input.data);
        break;
      case "vitals":
        result = await processVitals(input.data);
        break;
      case "raw":
        // Treat as symptom text
        result = await processSymptoms({ text: input.data.text, patientId: input.data.patientId });
        break;
      default:
        throw new Error(`Unknown input type`);
    }

    await queue.updateRawInputLog(logId, result.resourcesCreated, "completed");
    try {
      await appendEmrExportRow({
        timestamp: new Date().toISOString(),
        logId,
        inputType: input.type,
        status: "completed",
        patientId: result.patientId,
        encounterId: result.encounterId,
        queueToken: result.queueToken,
        resourcesCreated: result.resourcesCreated,
        errors: result.errors,
        structuredData: result.emrStructuredData,
        rawPayload: rawData,
      });
    } catch (exportError: any) {
      console.warn("Failed to append EMR Excel export row:", exportError?.message || exportError);
    }
    return result;
  } catch (error: any) {
    await queue.updateRawInputLog(logId, [], "failed", error.message);
    const failedResult = {
      success: false,
      inputType: input.type,
      resourcesCreated: [],
      emrStructuredData: {
        symptoms: [],
        vitals: {},
        diagnoses: [],
        medications: [],
        examFindings: [],
        appointment: { intent: false },
      },
      errors: [error.message],
    };
    try {
      await appendEmrExportRow({
        timestamp: new Date().toISOString(),
        logId,
        inputType: input.type,
        status: "failed",
        resourcesCreated: [],
        errors: failedResult.errors,
        structuredData: failedResult.emrStructuredData,
        rawPayload: rawData,
      });
    } catch (exportError: any) {
      console.warn("Failed to append EMR Excel export row:", exportError?.message || exportError);
    }
    return failedResult;
  }
}

function buildAppointmentDetails(
  input: SymptomInput,
  entities: ReturnType<typeof extractEntities>
): AppointmentDetails {
  const providedDoctor = input.preferredDoctor?.trim();
  const providedTime = input.preferredTime?.trim();
  const providedDate = input.preferredDate?.trim();
  const extractedDoctor = entities.appointment.doctor?.trim();
  const extractedTime = entities.appointment.time?.trim();
  const extractedDate = entities.appointment.date?.trim();

  let source: AppointmentDetails["source"] = "auto";
  if (providedDoctor || providedTime || providedDate) {
    source = "form";
  } else if (entities.appointment.intent || extractedDoctor || extractedTime || extractedDate) {
    source = "chat";
  }

  return {
    doctor: providedDoctor || extractedDoctor || inferDoctorFromSymptoms(entities.symptoms),
    time: providedTime || extractedTime || "Next available slot",
    date: providedDate || extractedDate,
    source,
  };
}

function inferDoctorFromSymptoms(symptoms: string[]): string {
  const hasAny = (...needles: string[]) => needles.some((needle) => symptoms.includes(needle));

  if (hasAny("chest pain", "palpitations")) return "Cardiology OPD";
  if (hasAny("sore throat", "runny nose", "congestion")) return "ENT OPD";
  if (hasAny("abdominal pain", "stomach pain", "nausea", "vomiting", "diarrhea", "diarrhoea")) {
    return "Gastroenterology OPD";
  }
  if (hasAny("rash", "itching")) return "Dermatology OPD";
  if (hasAny("burning urination", "frequent urination", "blood in urine")) return "Urology OPD";
  if (hasAny("blurred vision")) return "Ophthalmology OPD";
  if (hasAny("anxiety", "insomnia", "depression")) return "Mental Health OPD";
  return "General Medicine OPD";
}

function buildAppointmentReason(chiefComplaint: string | undefined, details: AppointmentDetails): string {
  const summary = formatAppointmentDetails(details);
  return chiefComplaint ? `${chiefComplaint} | ${summary}` : summary;
}

function formatAppointmentDetails(details: AppointmentDetails): string {
  const slotLabel = details.date ? `${details.date} at ${details.time}` : details.time;
  return `Appointment requested with ${details.doctor} for ${slotLabel}`;
}

function buildStructuredDataFromEntities(
  entities: ReturnType<typeof extractEntities>,
  appointmentDetails?: AppointmentDetails
): EmrStructuredData {
  return {
    chiefComplaint: entities.chiefComplaint,
    duration: entities.duration,
    symptoms: entities.symptoms,
    vitals: entities.vitals,
    diagnoses: entities.diagnoses,
    medications: entities.medications,
    examFindings: entities.examFindings,
    appointment: {
      intent: entities.appointment.intent || Boolean(appointmentDetails),
      doctor: appointmentDetails?.doctor || entities.appointment.doctor,
      time: appointmentDetails?.time || entities.appointment.time,
      date: appointmentDetails?.date || entities.appointment.date,
      source: appointmentDetails?.source,
    },
  };
}
