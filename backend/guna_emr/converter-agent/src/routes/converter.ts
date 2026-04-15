import { Router, Request, Response } from "express";
import axios from "axios";
import { universalConvert } from "../services/universalConverter";
import { generateSymptomChatReply } from "../services/aiChat";
import { generateAiPrecheckQuestions } from "../services/precheckAi";
import { loadChatMemory, resolveChatContextKey } from "../services/chatContext";
import { ensureEmrExportFile } from "../services/emrExcelExport";

export const converterRouter = Router();

const CDSS_BASE_URL = (process.env.CDSS_BASE_URL || "http://localhost:8010").replace(/\/$/, "");

interface CdssPrecheckQuestion {
  question_id?: string;
  question?: string;
  rationale?: string;
  answer_type?: "boolean" | "text" | "number" | "choice";
  options?: string[];
  required?: boolean;
}

interface CdssPrecheckResponse {
  questions?: CdssPrecheckQuestion[];
  confidence_scores?: Record<string, number>;
  reasoning?: string;
}

interface CdssAnalyzeResponse {
  encounter_id?: string;
  confidence_scores?: Record<string, number>;
  reasoning?: string;
}

async function tryCdssPrecheck(reqBody: Record<string, unknown>) {
  const encounterId = String(reqBody.encounterId || "").trim();
  const patientId = String(reqBody.patientId || "").trim();
  if (!encounterId || !patientId) return null;

  const payload = {
    encounter_id: encounterId,
    patient_id: patientId,
    chief_complaint: String(reqBody.chiefComplaint || ""),
    transcript: String(reqBody.transcript || reqBody.patientNotes || ""),
  };

  const { data } = await axios.post<CdssPrecheckResponse>(`${CDSS_BASE_URL}/cdss/precheck`, payload, {
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
  });

  const questions = (data.questions || []).map((item, index) => ({
    id: item.question_id || `cdss-precheck-${index + 1}`,
    question: item.question || "",
    type:
      item.answer_type === "boolean"
        ? "yesno"
        : item.answer_type === "choice"
          ? "multiple_choice"
          : item.answer_type === "number"
            ? "rating"
            : "text",
    options: Array.isArray(item.options) ? item.options : [],
    required: item.required !== false,
    category: "cdss",
    priority: 8,
    rationale: item.rationale || "",
  }));

  return {
    questions,
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    usedFallback: false,
    source: "cdss",
    confidenceScores: data.confidence_scores || {},
    reasoning: data.reasoning || "",
  };
}

async function tryCdssAnalyze(input: {
  transcript: string;
  patientId?: string;
  encounterId?: string;
}) {
  const patientId = String(input.patientId || "").trim();
  const encounterId = String(input.encounterId || "").trim();
  if (!patientId || !encounterId) return null;

  const payload = {
    transcript: input.transcript,
    patient_id: patientId,
    encounter_id: encounterId,
    precheck_answers: [],
  };

  const { data } = await axios.post<CdssAnalyzeResponse>(`${CDSS_BASE_URL}/cdss/analyze`, payload, {
    timeout: 20000,
    headers: { "Content-Type": "application/json" },
  });

  return {
    encounterId: data.encounter_id || encounterId,
    confidenceScores: data.confidence_scores || {},
    reasoning: data.reasoning || "",
    source: "cdss",
  };
}

/**
 * GET /api/convert/emr-export
 * Downloads EMR conversion log as an Excel file.
 */
converterRouter.get("/emr-export", async (_req: Request, res: Response) => {
  try {
    const filePath = await ensureEmrExportFile();
    return res.download(filePath, "emr-data.xlsx");
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/convert
 * Universal endpoint - accepts ANY input format.
 * Body can be JSON object or plain text.
 */
converterRouter.post("/", async (req: Request, res: Response) => {
  try {
    const data = typeof req.body === "string" ? req.body : req.body;

    if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
      return res.status(400).json({ error: "Empty input" });
    }

    const result = await universalConvert(data);

    // Notify doctor portal via Socket.IO
    const io = req.app.get("io");
    if (io && result.success) {
      io.emit("queue-update", {
        type: result.inputType,
        patientId: result.patientId,
        encounterId: result.encounterId,
        queueToken: result.queueToken,
        resourcesCreated: result.resourcesCreated,
        timestamp: new Date().toISOString(),
      });
    }

    const status = result.success ? 200 : 500;
    return res.status(status).json(result);
  } catch (error: any) {
    console.error("Converter error:", error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/convert/booking
 * Explicit booking endpoint.
 */
converterRouter.post("/booking", async (req: Request, res: Response) => {
  try {
    const result = await universalConvert({ type: "booking", data: req.body });
    const io = req.app.get("io");
    if (io && result.success) io.emit("queue-update", result);
    return res.status(result.success ? 200 : 500).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/convert/symptoms
 * Explicit symptom interview endpoint.
 */
converterRouter.post("/symptoms", async (req: Request, res: Response) => {
  try {
    const result = await universalConvert({ type: "symptom", data: req.body });
    const io = req.app.get("io");
    if (io && result.success) io.emit("queue-update", result);
    return res.status(result.success ? 200 : 500).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/convert/symptom-chat
 * Guided chatbot intake for symptom collection.
 */
converterRouter.post("/symptom-chat", async (req: Request, res: Response) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length === 0) {
      return res.status(400).json({ error: "At least one chat message is required" });
    }

    const result = await generateSymptomChatReply({
      messages,
      patientPhone: req.body?.patientPhone,
      userId: req.body?.userId,
      role: req.body?.role,
      language: req.body?.language,
      contextKey: req.body?.contextKey,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/convert/precheck-questions
 * Generates contextual doctor pre-check suggestions using configured LLM.
 */
converterRouter.post("/precheck-questions", async (req: Request, res: Response) => {
  try {
    try {
      const cdssResponse = await tryCdssPrecheck((req.body || {}) as Record<string, unknown>);
      if (cdssResponse) {
        return res.status(200).json(cdssResponse);
      }
    } catch (cdssError: any) {
      console.warn("CDSS precheck unavailable, falling back to converter precheck:", cdssError?.message || cdssError);
    }

    const result = await generateAiPrecheckQuestions(req.body || {});
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/convert/symptom-chat/submit
 * Converts chat transcript + triage summary into FHIR Composition draft and queues EMR in realtime.
 */
converterRouter.post("/symptom-chat/submit", async (req: Request, res: Response) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length === 0) {
      return res.status(400).json({ error: "At least one chat message is required" });
    }

    const chatResult = await generateSymptomChatReply({
      messages,
      patientPhone: req.body?.patientPhone,
      userId: req.body?.userId,
      role: req.body?.role,
      language: req.body?.language,
      contextKey: req.body?.contextKey,
    });

    const transcript = messages
      .map((message: any) => `${message.role === "assistant" ? "assistant" : "user"}: ${message.content}`)
      .join("\n");

    const conversion = await universalConvert({
      type: "symptom",
      data: {
        text: transcript,
        summary: chatResult.summary,
        transcript,
        patientPhone: req.body?.patientPhone,
        patientName: req.body?.patientName,
        autoScheduleAppointment: Boolean(chatResult.needsAppointment),
        preferredDoctor: chatResult.appointmentDetails?.doctor,
        preferredTime: chatResult.appointmentDetails?.time,
        preferredDate: chatResult.appointmentDetails?.date,
      },
    });

    const io = req.app.get("io");
    if (io && conversion.success) {
      io.emit("queue-update", {
        type: "symptom-chat-submit",
        triageLevel: chatResult.triageLevel,
        escalationBand: chatResult.escalationBand,
        queueToken: conversion.queueToken,
        patientId: conversion.patientId,
        encounterId: conversion.encounterId,
        timestamp: new Date().toISOString(),
      });
    }

    let cdss: Record<string, unknown> | null = null;
    if (conversion.success) {
      try {
        cdss = await tryCdssAnalyze({
          transcript,
          patientId: conversion.patientId,
          encounterId: conversion.encounterId,
        });
      } catch (cdssError: any) {
        cdss = {
          source: "cdss",
          skipped: true,
          reason: cdssError?.message || "CDSS analyze unavailable",
        };
      }
    }

    return res.status(conversion.success ? 200 : 500).json({
      ...conversion,
      chat: chatResult,
      cdss,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/convert/symptom-chat/memory
 * Returns personalized memory snapshot for current context.
 */
converterRouter.get("/symptom-chat/memory", async (req: Request, res: Response) => {
  try {
    const contextKey =
      typeof req.query.contextKey === "string" && req.query.contextKey
        ? req.query.contextKey
        : resolveChatContextKey({
            userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
            role: typeof req.query.role === "string" ? req.query.role : undefined,
            patientPhone: typeof req.query.patientPhone === "string" ? req.query.patientPhone : undefined,
          });

    const memory = await loadChatMemory(contextKey);
    return res.status(200).json({ contextKey, memory });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/convert/doctor-notes
 * Explicit doctor notes endpoint.
 */
converterRouter.post("/doctor-notes", async (req: Request, res: Response) => {
  try {
    const result = await universalConvert({ type: "doctor_notes", data: req.body });
    const io = req.app.get("io");
    if (io && result.success) io.emit("queue-update", result);
    return res.status(result.success ? 200 : 500).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/convert/vitals
 * Explicit vitals endpoint.
 */
converterRouter.post("/vitals", async (req: Request, res: Response) => {
  try {
    const result = await universalConvert({ type: "vitals", data: req.body });
    const io = req.app.get("io");
    if (io && result.success) io.emit("queue-update", result);
    return res.status(result.success ? 200 : 500).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
