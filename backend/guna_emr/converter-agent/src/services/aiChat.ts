import axios from "axios";
import { extractEntities } from "./nlpExtractor";
import { extractMedicationSignals, getAdherenceTips, getDdiWarnings } from "./medSafety";
import {
  loadChatMemory,
  notifyFallbackChannels,
  publishQueueRealtimeEvent,
  resolveChatContextKey,
  upsertChatMemory,
} from "./chatContext";
import type {
  ChatDdiWarning,
  ChatFallbackChannels,
  EscalationBand,
  TriageLevel,
} from "../types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SymptomChatRequest {
  messages: ChatMessage[];
  patientPhone?: string;
  userId?: string;
  role?: "patient" | "doctor" | "admin" | "nurse" | "unknown";
  language?: "en";
  contextKey?: string;
}

export interface SymptomChatResponse {
  reply: string;
  summary: string;
  readyForSubmission: boolean;
  triageLevel: TriageLevel;
  escalationBand: EscalationBand;
  redFlags: string[];
  suggestedVitals: string[];
  adherenceTips: string[];
  ddiWarnings: ChatDdiWarning[];
  fallbackChannels: ChatFallbackChannels;
  contextKey: string;
  usedFallback: boolean;
  model: string;
  appointmentBookingOffered?: boolean;
  needsAppointment?: boolean;
  appointmentDetails?: {
    doctor?: string;
    time?: string;
    date?: string;
    source: "chat" | "form" | "auto";
  };
}

interface LlmChatPayload {
  assistantMessage: string;
  clinicalSummary: string;
  readyForSubmission: boolean;
  triageLevel: TriageLevel;
  redFlags: string[];
  suggestedVitals: string[];
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are NIRA AI, a sophisticated clinical intake assistant in an outpatient EMR workflow.",
  "Your purpose: Systematically collect structured clinical history to enable accurate triage, EMR documentation, and FHIR-compliant clinical records.",
  "",
  "CLINICAL ASSESSMENT FRAMEWORK:",
  "Perform targeted history-taking following evidence-based triage protocols. Structure your intake around the 'Chief Complaint (CC)' and establish:",
  "1. CHIEF COMPLAINT & ONSET: Brief description + exact/relative timing (acute vs chronic)",
  "2. CHARACTERIZATION: Severity (mild/moderate/severe), quality (sharp/dull/throbbing), pattern (constant/intermittent), progression",
  "3. ASSOCIATED SYMPTOMS: Related systemic symptoms, constitutional signs (fever, weight change, fatigue/malaise)",
  "4. MODIFYING FACTORS: What makes symptoms better/worse? (positional, activity-related, medication response)",
  "5. PAST MEDICAL HISTORY: Relevant chronic conditions, previous similar episodes, surgical history as applicable",
  "6. MEDICATIONS & ALLERGIES: Current medications, dosages if available; document ALL known allergies (drug, food, environmental)",
  "7. VITAL SIGNS: Obtain or estimate: temperature, heart rate, respiratory rate, blood pressure, oxygen saturation if respiratory symptoms",
  "8. PSYCHOSOCIAL CONTEXT: Work/stress factors, social support, functional impact",
  "",
  "CLINICAL COMMUNICATION STANDARDS:",
  "- Use precise medical terminology (e.g., 'dyspnea' for shortness of breath, 'hypertension' for high blood pressure, 'tachycardia' for rapid heart rate)",
  "- Employ standardized triage descriptors: acute vs chronic, localized vs systemic, stable vs progressive",
  "- Ask clarifying questions in plain language while documenting using clinical terminology",
  "- Maintain patient rapport while being thorough and systematic",
  "- Show empathy and avoid unnecessary jargon overload",
  "",
  "EMERGENCY RECOGNITION - RED FLAGS requiring immediate escalation to EMERGENCY level:",
  "Cardiovascular: Chest pain/pressure, acute dyspnea, syncope, severe tachycardia (>120), hypotension (<90 systolic), acute severe headache with focal neuro signs",
  "Respiratory: Severe dyspnea, stridor, wheezing unresponsive to rescue inhalers, SpO2 <90%",
  "Neurological: Altered mental status, confusion, stroke symptoms (facial droop, arm weakness, speech difficulty - FAST exam), severe headache with meningeal signs",
  "Hemorrhage: Active severe bleeding, hemoptysis, melena/severe GI bleeding, hematuria with trauma",
  "Metabolic: Severe hyperglycemia/hypoglycemia with altered mental status, severe dehydration with shock signs",
  "Trauma: Significant mechanisms of injury, penetrating injuries, signs of internal hemorrhage",
  "Severe Infection: Fever >103F with altered mental status, sepsis signs (tachycardia, hypotension, altered perfusion)",
  "",
  "URGENT FLAGS (triage to URGENT):",
  "Moderate dehydration with persistent vomiting/diarrhea, controlled substance overdose, moderate to severe pain, persistent fever, acute neurological changes, significant abdominal pain",
  "",
  "APPOINTMENT BOOKING:",
  "When ready for clinical handoff: Offer appointment scheduling for routine cases (non-emergency).",
  "If patient indicates interest in booking: Collect preferred date/time, preferred provider if available.",
  "Do not offer appointments for emergency/urgent cases - direct to immediate care.",
  "",
  "PRE-APPOINTMENT PREPARATION MODE:",
  "When a patient says they want to prepare for an upcoming visit, mentions pre-check, or starts a pre-appointment flow:",
  "- Systematically gather: chief complaint, symptom timeline and severity, current medications, allergies, and lifestyle factors",
  "- Ask warm, conversational questions ONE at a time — like a caring experienced nurse preparing them",
  "- Cover these areas in order: (1) main reason for visit, (2) when it started and progression, (3) what makes it better/worse, (4) current medications, (5) known allergies, (6) anything else for the doctor",
  "- After 4-6 exchanges, provide a concise structured summary of everything collected",
  "- Flag any red-flag symptoms or urgent findings prominently in the summary",
  "- Be reassuring and empathetic — patients may be anxious before appointments",
  "- Do NOT rush through questions; let the patient elaborate if they want to",
  "",
  "RESPONSE FORMAT - Always return valid JSON:",
  "{\"assistantMessage\": string, \"clinicalSummary\": string, \"readyForSubmission\": boolean, \"triageLevel\": \"routine\"|\"urgent\"|\"emergency\", \"redFlags\": string[], \"suggestedVitals\": string[]}",
  "",
  "CONSTRAINTS:",
  "- Do NOT provide medical advice, treatment recommendations, or prescriptions",
  "- Do NOT render diagnosis; focus on systematic data collection",
  "- Do NOT share PHI beyond the system boundary",
  "- Ask ONE focused follow-up question per message",
  "- When submission-ready, explicitly offer appointment scheduling for routine/urgent cases",
  "- Keep each assistant response under 150 words for optimal mobile/accessibility experience",
].join("\n");

function getSystemPrompt() {
  const configuredPrompt =
    process.env.LLM_SYSTEM_PROMPT ||
    process.env.CHAT_SYSTEM_PROMPT ||
    process.env.NIRA_SYSTEM_PROMPT;

  if (configuredPrompt && configuredPrompt.trim().length > 0) {
    return configuredPrompt.trim();
  }

  return DEFAULT_SYSTEM_PROMPT;
}

function getModel() {
  return process.env.LLM_MODEL || "gemini-3.1-pro";
}

function getBaseUrl() {
  return process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
}

function getApiKey() {
  const key =
    process.env.LLM_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (
    !key ||
    key === "your_openai_key_here" ||
    key === "your_llm_key_here" ||
    key === "your_gemini_key_here" ||
    key === "your_google_api_key_here"
  ) {
    return "";
  }
  return key;
}

function normalizeTriageLevel(value: unknown): SymptomChatResponse["triageLevel"] {
  if (value === "urgent" || value === "emergency") return value;
  return "routine";
}

function triageToEscalationBand(value: TriageLevel): EscalationBand {
  if (value === "emergency") return "red";
  if (value === "urgent") return "yellow";
  return "green";
}

function parseJsonObject(text: string): LlmChatPayload | null {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as LlmChatPayload;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as LlmChatPayload;
    } catch {
      return null;
    }
  }
}

function inferRedFlags(text: string) {
  const lower = text.toLowerCase();
  const redFlags: string[] = [];

  if (lower.includes("chest pain") || lower.includes("chest pressure")) redFlags.push("chest pain/pressure");
  if (
    lower.includes("shortness of breath") ||
    lower.includes("dyspnea") ||
    lower.includes("difficulty breathing") ||
    lower.includes("can't breathe")
  ) {
    redFlags.push("acute dyspnea");
  }
  if (lower.includes("confusion") || lower.includes("altered mental status") || lower.includes("unconscious")) {
    redFlags.push("altered mental status");
  }
  if (lower.includes("stroke") || lower.includes("slurred speech") || lower.includes("face droop")) {
    redFlags.push("possible stroke symptoms (FAST positive)");
  }
  if (lower.includes("heavy bleeding") || lower.includes("severe bleeding") || lower.includes("hemoptysis")) {
    redFlags.push("active hemorrhage");
  }
  if (lower.includes("syncope") || lower.includes("fainting") || lower.includes("passed out")) {
    redFlags.push("syncope/presyncope");
  }
  if (lower.includes("severe dehydration")) {
    redFlags.push("severe dehydration with shock signs");
  }

  return redFlags;
}

function buildSuggestedVitals(text: string) {
  const suggestions: string[] = [];

  if (/\b(fever|temperature|chills|pyrexia)\b/i.test(text)) suggestions.push("temperature");
  if (/\b(cough|dyspnea|breathing|breathless|asthma|wheezing|chest)\b/i.test(text)) suggestions.push("SpO2");
  if (/\b(dizziness|vertigo|bp|pressure|hypertension|headache|tachycardia|palpitation)\b/i.test(text)) suggestions.push("blood pressure");
  if (!suggestions.includes("pulse")) suggestions.push("heart rate");

  return suggestions.slice(0, 4);
}

function detectAppointmentIntent(messages: ChatMessage[]): boolean {
  const lastMessages = messages.slice(-3); // Check last 3 messages
  const appointmentKeywords = [
    "book", "appointment", "schedule", "meeting", "visit", "availability", 
    "when can", "can i see", "available", "time", "date", "available",
    "consult", "doctor", "doctor's appointment", "need appointment"
  ];
  
  return lastMessages.some(msg => {
    if (msg.role !== "user") return false;
    const lower = msg.content.toLowerCase();
    return appointmentKeywords.some(keyword => lower.includes(keyword));
  });
}

function extractAppointmentDetails(text: string): Partial<SymptomChatResponse["appointmentDetails"]> {
  const details: Partial<SymptomChatResponse["appointmentDetails"]> = {
    source: "chat"
  };
  
  // Try to extract time preferences (simple patterns)
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)?/i,
    /(morning|afternoon|evening|night)/i
  ];
  
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      details.time = match[0];
      break;
    }
  }
  
  // Try to extract date preferences
  const datePatterns = [
    /tomorrow/i,
    /today/i,
    /next\s+week/i,
    /this\s+week/i,
    /(\d{1,2})\s*\/\s*(\d{1,2})/
  ];
  
  for (const pattern of datePatterns) {
    if (pattern.test(text)) {
      details.date = text.match(pattern)?.[0] || "flexible";
      break;
    }
  }
  
  // Try to extract doctor/specialist preference
  const doctorPattern = /(?:see|book|with)\s+(?:dr\.?|doctor)\s+(\w+)/i;
  const doctorMatch = text.match(doctorPattern);
  if (doctorMatch) {
    details.doctor = doctorMatch[1];
  }
  
  return details;
}

function buildFallbackResponse(request: SymptomChatRequest): SymptomChatResponse {
  const conversation = request.messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  const latestUserMessage =
    [...request.messages].reverse().find((message) => message.role === "user")?.content || "";
  const entities = extractEntities(conversation);
  const redFlags = inferRedFlags(conversation);
  const suggestedVitals = buildSuggestedVitals(conversation);
  const appointmentIntent = detectAppointmentIntent(request.messages);
  const appointmentDetails = appointmentIntent ? extractAppointmentDetails(latestUserMessage) : {};

  let triageLevel: SymptomChatResponse["triageLevel"] = redFlags.length > 0 ? "emergency" : "routine";
  let readyForSubmission = false;
  let appointmentBookingOffered = false;
  let reply = "I'm here to help with your health concern. Could you describe your chief complaint—what symptom is bothering you most today? Please include when it started.";

  if (triageLevel === "emergency") {
    readyForSubmission = true;
    reply = "⚠️ EMERGENCY: Your symptoms suggest a medical emergency requiring immediate evaluation. Please call 911 or proceed directly to the nearest Emergency Department (ED) immediately. We'll prepare your clinical intake for the ED team.";
  } else if (appointmentIntent && readyForSubmission === false && entities.symptoms.length > 0) {
    reply = "I can help you schedule an appointment. To complete your booking, could you please tell me your preferred time? Would you prefer a morning, afternoon, or evening consultation? Do you have a preferred healthcare provider or specialty in mind?";
    appointmentBookingOffered = true;
  } else if (entities.symptoms.length === 0) {
    reply = "I'd like to document your initial history properly. What is your chief complaint—the primary reason for today's visit?";
  } else if (!entities.duration) {
    const symptomLabel =
      entities.symptoms.length === 1
        ? entities.symptoms[0]
        : `symptoms (${entities.symptoms.join(", ")})`;
    reply = `I've noted ${symptomLabel}. When did this start? For example: today, 2 days ago, or last week.`;
  } else if (!entities.vitals.temperature && suggestedVitals.includes("temperature")) {
    reply = "Have you checked your vital signs? If you have access to a thermometer, please share your current temperature. Also, do you feel feverish or have any chills or diaphoresis (sweating)?";
  } else if (!entities.vitals.spo2 && suggestedVitals.includes("SpO2")) {
    reply = "Have you measured your oxygen saturation (SpO2) or blood pressure? If you have these measurements available, they're helpful for clinical assessment. Are you experiencing any dyspnea (shortness of breath) or orthopnea (difficulty breathing when lying flat)?";
  } else {
    readyForSubmission = true;
    triageLevel = /\b(high fever|dyspnea|tachycardia|severe|vomiting|tachypnea)\b/i.test(latestUserMessage)
      ? "urgent"
      : "routine";
    
    if (triageLevel === "urgent") {
      reply = "I have collected sufficient clinical data for urgent triage assessment. Your case is prioritized and ready for immediate clinical evaluation. Would you like me to schedule an urgent same-day or next-morning appointment?";
    } else {
      reply = "Your clinical intake is complete and ready for provider review. Your symptoms have been documented. Would you like to schedule a routine appointment with one of our clinicians?";
    }
    appointmentBookingOffered = true;
  }

  const summaryParts = [
    entities.symptoms.length > 0 ? `Chief Complaint: ${entities.symptoms.join(", ")}` : "",
    entities.duration ? `Duration: ${entities.duration}` : "",
    entities.vitals.systolic && entities.vitals.diastolic
      ? `BP: ${entities.vitals.systolic}/${entities.vitals.diastolic} mmHg`
      : "",
    entities.vitals.temperature ? `Temperature: ${entities.vitals.temperature}°C` : "",
    entities.vitals.heartRate ? `Heart Rate: ${entities.vitals.heartRate} bpm` : "",
    redFlags.length > 0 ? `Red Flags: ${redFlags.join(", ")}` : "",
  ].filter(Boolean);

  const escalationBand = triageToEscalationBand(triageLevel);
  const medicationSignals = extractMedicationSignals(conversation);
  const ddiWarnings = getDdiWarnings(medicationSignals);
  const contextKey =
    request.contextKey ||
    resolveChatContextKey({
      userId: request.userId,
      role: request.role,
      patientPhone: request.patientPhone,
    });

  const response: SymptomChatResponse = {
    reply,
    summary: summaryParts.join(" | ") || "Clinical intake assessment in progress.",
    readyForSubmission,
    triageLevel,
    escalationBand,
    redFlags,
    suggestedVitals,
    adherenceTips: getAdherenceTips("en", ddiWarnings.length > 0),
    ddiWarnings,
    fallbackChannels: {
      whatsapp: false,
      sms: false,
      reason: "Fallback not triggered in local mode yet.",
    },
    contextKey,
    usedFallback: true,
    model: `${getModel()} (fallback mode)`,
    appointmentBookingOffered,
    needsAppointment: readyForSubmission && triageLevel !== "emergency" ? true : false,
  };

  if (appointmentIntent) {
    response.appointmentDetails = appointmentDetails as SymptomChatResponse["appointmentDetails"];
  }

  return response;
}

async function fetchLlmResponse(request: SymptomChatRequest): Promise<SymptomChatResponse | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const model = getModel();
  const baseUrl = getBaseUrl();

  const conversationText = request.messages
    .map((msg) => `${msg.role === "user" ? "Patient" : "Assistant"}: ${msg.content}`)
    .join("\n");

  const memoryContextKey =
    request.contextKey ||
    resolveChatContextKey({
      userId: request.userId,
      role: request.role,
      patientPhone: request.patientPhone,
    });
  const memory = await loadChatMemory(memoryContextKey);

  const contents = request.messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  if (memory?.summary) {
    contents.unshift({
      role: "user",
      parts: [
        {
          text: `Prior clinical context for continuity (do not expose verbatim to patient): ${memory.summary}`,
        },
      ],
    });
  }

  const response = await axios.post(
    `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
    {
      system_instruction: {
        parts: [
          {
            text: getSystemPrompt(),
          },
        ],
      },
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
      contents,
    },
    {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: 20000
    }
  );

  const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== "string") return null;

  const parsed = parseJsonObject(content);
  if (!parsed?.assistantMessage) return null;

  // Detect appointment intent and extract details from LLM response context
  const appointmentIntent = detectAppointmentIntent(request.messages);
  const appointmentDetails =  appointmentIntent ? extractAppointmentDetails(conversationText) : {};

  const normalizedTriage = normalizeTriageLevel(parsed.triageLevel);
  const escalationBand = triageToEscalationBand(normalizedTriage);
  const medicationSignals = extractMedicationSignals(conversationText);
  const ddiWarnings = getDdiWarnings(medicationSignals);

  const response_obj: SymptomChatResponse = {
    reply: parsed.assistantMessage,
    summary: parsed.clinicalSummary || "Clinical intake assessment in progress.",
    readyForSubmission: Boolean(parsed.readyForSubmission),
    triageLevel: normalizedTriage,
    escalationBand,
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags.filter(Boolean) : [],
    suggestedVitals: Array.isArray(parsed.suggestedVitals) ? parsed.suggestedVitals.filter(Boolean) : [],
    adherenceTips: getAdherenceTips("en", ddiWarnings.length > 0),
    ddiWarnings,
    fallbackChannels: {
      whatsapp: false,
      sms: false,
      reason: "Fallback channels not required for this interaction.",
    },
    contextKey: memoryContextKey,
    usedFallback: false,
    model: getModel(),
    appointmentBookingOffered: parsed.readyForSubmission,
    needsAppointment: parsed.readyForSubmission && parsed.triageLevel !== "emergency",
  };

    if (appointmentIntent && appointmentDetails && Object.keys(appointmentDetails).length > 0) {
    response_obj.appointmentDetails = appointmentDetails as SymptomChatResponse["appointmentDetails"];
  }

  return response_obj;
}

export async function generateSymptomChatReply(
  request: SymptomChatRequest
): Promise<SymptomChatResponse> {
  const contextKey =
    request.contextKey ||
    resolveChatContextKey({
      userId: request.userId,
      role: request.role,
      patientPhone: request.patientPhone,
    });

  const withContext = {
    ...request,
    contextKey,
  };

  try {
    const llmResponse = await fetchLlmResponse(withContext);
    if (llmResponse) {
      const fallbackChannels = await notifyFallbackChannels({
        patientPhone: request.patientPhone,
        contextKey,
        message: llmResponse.reply,
        escalationBand: llmResponse.escalationBand,
        triageLevel: llmResponse.triageLevel,
      });

      const enriched = {
        ...llmResponse,
        fallbackChannels,
      };

      await upsertChatMemory({
        contextKey,
        userId: request.userId,
        role: request.role || "unknown",
        language: "en",
        summary: enriched.summary,
        triageLevel: enriched.triageLevel,
        escalationBand: enriched.escalationBand,
        medications: enriched.ddiWarnings.flatMap((item) => item.medications),
      });

      await publishQueueRealtimeEvent({
        contextKey,
        eventType: "triage-updated",
        escalationBand: enriched.escalationBand,
        triageLevel: enriched.triageLevel,
        message: enriched.summary,
      });

      if (fallbackChannels.whatsapp || fallbackChannels.sms) {
        await publishQueueRealtimeEvent({
          contextKey,
          eventType: "fallback-triggered",
          escalationBand: enriched.escalationBand,
          triageLevel: enriched.triageLevel,
          message: fallbackChannels.reason || "Fallback dispatched.",
        });
      }

      return enriched;
    }
  } catch (error: any) {
    console.warn("LLM chat unavailable, using fallback clinical intake:", error.message);
  }

  const fallback = buildFallbackResponse(withContext);
  const fallbackChannels = await notifyFallbackChannels({
    patientPhone: request.patientPhone,
    contextKey,
    message: fallback.reply,
    escalationBand: fallback.escalationBand,
    triageLevel: fallback.triageLevel,
  });

  const enrichedFallback = {
    ...fallback,
    fallbackChannels,
  };

  await upsertChatMemory({
    contextKey,
    userId: request.userId,
    role: request.role || "unknown",
    language: "en",
    summary: enrichedFallback.summary,
    triageLevel: enrichedFallback.triageLevel,
    escalationBand: enrichedFallback.escalationBand,
    medications: enrichedFallback.ddiWarnings.flatMap((item) => item.medications),
  });

  await publishQueueRealtimeEvent({
    contextKey,
    eventType: "triage-updated",
    escalationBand: enrichedFallback.escalationBand,
    triageLevel: enrichedFallback.triageLevel,
    message: enrichedFallback.summary,
  });

  if (fallbackChannels.whatsapp || fallbackChannels.sms) {
    await publishQueueRealtimeEvent({
      contextKey,
      eventType: "fallback-triggered",
      escalationBand: enrichedFallback.escalationBand,
      triageLevel: enrichedFallback.triageLevel,
      message: fallbackChannels.reason || "Fallback dispatched.",
    });
  }

  return enrichedFallback;
}
