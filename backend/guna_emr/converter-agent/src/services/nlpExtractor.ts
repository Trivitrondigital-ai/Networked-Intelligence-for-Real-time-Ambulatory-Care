/**
 * NLP Entity Extractor - Extracts medical entities from unstructured text.
 * Uses regex-based extraction for offline use; can be swapped for LLM-based extraction.
 */

import axios from "axios";

export interface ExtractedEntities {
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
  chiefComplaint?: string;
  duration?: string;
  appointment: {
    intent: boolean;
    doctor?: string;
    time?: string;
    date?: string;
  };
}

// Blood pressure patterns: 140/90, BP 140/90, bp: 140/90
const BP_REGEX = /\b(?:bp|blood\s*pressure)[:\s]*(\d{2,3})\s*[\/\\]\s*(\d{2,3})/i;
const BP_BARE_REGEX = /\b(\d{2,3})\s*\/\s*(\d{2,3})\s*(?:mm\s*hg|mmhg)?/i;

// Heart rate: HR 72, pulse 72, heart rate 72 bpm
const HR_REGEX = /\b(?:hr|heart\s*rate|pulse)[:\s]*(\d{2,3})\s*(?:bpm|\/min)?/i;

// Temperature: temp 98.6, temperature 101 F, fever 102
const TEMP_REGEX = /\b(?:temp(?:erature)?|fever)[:\s]*(\d{2,3}(?:\.\d)?)\s*(?:°?\s*[fFcC])?/i;

// SpO2: spo2 98%, oxygen 95%
const SPO2_REGEX = /\b(?:spo2|sp\s*o2|oxygen\s*sat(?:uration)?|o2\s*sat)[:\s]*(\d{2,3})\s*%?/i;

// Weight: 70 kg, weight 70
const WEIGHT_REGEX = /\b(?:weight|wt)[:\s]*(\d{2,3}(?:\.\d)?)\s*(?:kg|lbs?)?/i;

// Respiratory rate
const RR_REGEX = /\b(?:rr|resp(?:iratory)?\s*rate)[:\s]*(\d{1,2})\s*(?:\/min)?/i;

// Common symptoms list
const SYMPTOM_KEYWORDS = [
  "fever", "cough", "cold", "headache", "body ache", "bodyache", "fatigue",
  "nausea", "vomiting", "diarrhea", "diarrhoea", "constipation", "chest pain",
  "shortness of breath", "breathlessness", "dizziness", "palpitations",
  "sore throat", "runny nose", "congestion", "abdominal pain", "stomach pain",
  "back pain", "joint pain", "muscle pain", "weakness", "weight loss",
  "weight gain", "loss of appetite", "rash", "itching", "swelling",
  "burning urination", "frequent urination", "blood in urine", "blood in stool",
  "blurred vision", "anxiety", "insomnia", "depression",
];

// Duration patterns: "for 3 days", "since 2 weeks", "x 5 days"
const DURATION_REGEX = /(?:for|since|x|from|past|last)\s*(\d+\s*(?:day|week|month|year|hr|hour)s?)/i;

// Common diagnosis markers
const DX_MARKERS = /\b(?:dx|diagnosis|diagnosed|impression|assessment)[:\s]*(.*?)(?:\.|,|;|$)/gi;

// Medication patterns: Rx paracetamol, prescribed amoxicillin, tab. xyz
const MED_MARKERS = /\b(?:rx|prescribed?|tab\.?|cap\.?|syp?\.?|inj\.?|medication)[:\s]*([\w\s-]+?)(?:\d|,|;|\.|$)/gi;

// Exam findings
const EXAM_MARKERS = /\b(?:exam(?:ination)?|o\/e|on examination|findings?)[:\s]*(.*?)(?:\.|;|$)/gi;
const APPOINTMENT_INTENT_REGEX =
  /\b(?:book|schedule|arrange|need|want|plan)\b.{0,30}\b(?:appointment|consult(?:ation)?|visit|slot)\b|\b(?:appointment|consult(?:ation)?|visit|slot)\b.{0,20}\b(?:book|schedule|arrange|please|needed?)\b|\bsee\s+(?:a\s+)?doctor\b/i;
const DOCTOR_REGEX = /\b(?:dr\.?|doctor)\s+([a-z]+(?:\s+[a-z]+)?)/i;
const TIME_WITH_MARKER_REGEX = /\b(?:at|around|by)\s+((?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:am|pm)|morning|afternoon|evening)\b/i;
const TIME_FALLBACK_REGEX = /\b((?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:am|pm))\b/i;
const DATE_WORD_REGEX = /\b(today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const DATE_NUMERIC_REGEX = /\b(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/;

export function extractEntities(text: string): ExtractedEntities {
  const lower = text.toLowerCase();
  const result: ExtractedEntities = {
    symptoms: [],
    vitals: {},
    diagnoses: [],
    medications: [],
    examFindings: [],
    appointment: {
      intent: false,
    },
  };

  // Extract vitals
  const bp = BP_REGEX.exec(text) || BP_BARE_REGEX.exec(text);
  if (bp) {
    result.vitals.systolic = parseInt(bp[1]);
    result.vitals.diastolic = parseInt(bp[2]);
  }

  const hr = HR_REGEX.exec(text);
  if (hr) result.vitals.heartRate = parseInt(hr[1]);

  const temp = TEMP_REGEX.exec(text);
  if (temp) result.vitals.temperature = parseFloat(temp[1]);

  const spo2 = SPO2_REGEX.exec(text);
  if (spo2) result.vitals.spo2 = parseInt(spo2[1]);

  const wt = WEIGHT_REGEX.exec(text);
  if (wt) result.vitals.weight = parseFloat(wt[1]);

  const rr = RR_REGEX.exec(text);
  if (rr) result.vitals.respiratoryRate = parseInt(rr[1]);

  // Extract symptoms
  for (const symptom of SYMPTOM_KEYWORDS) {
    if (lower.includes(symptom)) {
      result.symptoms.push(symptom);
    }
  }

  // Duration
  const durMatch = DURATION_REGEX.exec(text);
  if (durMatch) result.duration = durMatch[1].trim();

  // Chief complaint = first sentence or symptoms summary
  if (result.symptoms.length > 0) {
    result.chiefComplaint = result.symptoms.join(", ");
    if (result.duration) {
      result.chiefComplaint += ` for ${result.duration}`;
    }
  }

  // Diagnoses
  let dxMatch;
  while ((dxMatch = DX_MARKERS.exec(text)) !== null) {
    const dx = dxMatch[1].trim();
    if (dx.length > 2) result.diagnoses.push(dx);
  }
  // Also look for common inline diagnoses
  const inlineDx = [
    "viral urti", "urti", "lrti", "pneumonia", "bronchitis", "gastritis",
    "uti", "hypertension", "diabetes", "asthma", "migraine", "dengue",
    "malaria", "typhoid", "covid", "pharyngitis", "tonsillitis",
  ];
  for (const dx of inlineDx) {
    if (lower.includes(dx) && !result.diagnoses.some((d) => d.toLowerCase().includes(dx))) {
      result.diagnoses.push(dx.toUpperCase());
    }
  }

  // Medications
  let medMatch;
  while ((medMatch = MED_MARKERS.exec(text)) !== null) {
    const med = medMatch[1].trim();
    if (med.length > 2) result.medications.push(med);
  }
  // Common medications inline
  const commonMeds = [
    "paracetamol", "amoxicillin", "azithromycin", "ibuprofen", "cetirizine",
    "pantoprazole", "omeprazole", "metformin", "amlodipine", "atorvastatin",
    "dolo", "crocin", "augmentin", "ceftriaxone", "doxycycline",
  ];
  for (const med of commonMeds) {
    if (lower.includes(med) && !result.medications.some((m) => m.toLowerCase().includes(med))) {
      result.medications.push(med);
    }
  }

  // Exam findings
  let examMatch;
  while ((examMatch = EXAM_MARKERS.exec(text)) !== null) {
    const finding = examMatch[1].trim();
    if (finding.length > 2) result.examFindings.push(finding);
  }
  // "exam normal" shorthand
  if (/\bexam\s+normal\b/i.test(text) && result.examFindings.length === 0) {
    result.examFindings.push("Normal examination");
  }

  result.appointment.intent = APPOINTMENT_INTENT_REGEX.test(text);

  const doctorMatch = DOCTOR_REGEX.exec(text);
  if (doctorMatch) {
    result.appointment.doctor = normalizeDoctorName(doctorMatch[1]);
  }

  const timeMatch = TIME_WITH_MARKER_REGEX.exec(text) || TIME_FALLBACK_REGEX.exec(text);
  if (timeMatch) {
    result.appointment.time = normalizeWhitespace(timeMatch[1]);
  }

  const dateMatch = DATE_WORD_REGEX.exec(text) || DATE_NUMERIC_REGEX.exec(text);
  if (dateMatch) {
    result.appointment.date = normalizeWhitespace(dateMatch[1]);
  }

  return result;
}

interface LlmExtractionResponse {
  symptoms?: string[];
  vitals?: {
    systolic?: number;
    diastolic?: number;
    heartRate?: number;
    temperature?: number;
    spo2?: number;
    weight?: number;
    respiratoryRate?: number;
  };
  diagnoses?: string[];
  medications?: string[];
  examFindings?: string[];
  chiefComplaint?: string;
  duration?: string;
  appointment?: {
    intent?: boolean;
    doctor?: string;
    time?: string;
    date?: string;
  };
}

const LLM_EXTRACTION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["symptoms", "vitals", "diagnoses", "medications", "examFindings", "appointment"],
  properties: {
    symptoms: { type: "ARRAY", items: { type: "STRING" } },
    vitals: {
      type: "OBJECT",
      properties: {
        systolic: { type: "NUMBER" },
        diastolic: { type: "NUMBER" },
        heartRate: { type: "NUMBER" },
        temperature: { type: "NUMBER" },
        spo2: { type: "NUMBER" },
        weight: { type: "NUMBER" },
        respiratoryRate: { type: "NUMBER" },
      },
    },
    diagnoses: { type: "ARRAY", items: { type: "STRING" } },
    medications: { type: "ARRAY", items: { type: "STRING" } },
    examFindings: { type: "ARRAY", items: { type: "STRING" } },
    chiefComplaint: { type: "STRING" },
    duration: { type: "STRING" },
    appointment: {
      type: "OBJECT",
      required: ["intent"],
      properties: {
        intent: { type: "BOOLEAN" },
        doctor: { type: "STRING" },
        time: { type: "STRING" },
        date: { type: "STRING" },
      },
    },
  },
};

function getLlmModel() {
  return process.env.LLM_MODEL || "gemini-3.1-pro";
}

function getLlmBaseUrl() {
  return process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
}

function getLlmApiKey() {
  const key =
    process.env.LLM_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
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

function parseJsonObject(text: string): LlmExtractionResponse | null {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as LlmExtractionResponse;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as LlmExtractionResponse;
    } catch {
      return null;
    }
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeVital(value: unknown, min: number, max: number): number | undefined {
  const normalized = normalizeNumber(value);
  if (normalized === undefined) return undefined;
  if (normalized < min || normalized > max) return undefined;
  return normalized;
}

function mergeEntities(base: ExtractedEntities, llm: LlmExtractionResponse): ExtractedEntities {
  const llmSymptoms = normalizeStringList(llm.symptoms);
  const llmDiagnoses = normalizeStringList(llm.diagnoses);
  const llmMedications = normalizeStringList(llm.medications);
  const llmExamFindings = normalizeStringList(llm.examFindings);

  return {
    symptoms: llmSymptoms.length > 0 ? llmSymptoms : base.symptoms,
    vitals: {
      systolic: normalizeVital(llm.vitals?.systolic, 50, 280) ?? base.vitals.systolic,
      diastolic: normalizeVital(llm.vitals?.diastolic, 30, 180) ?? base.vitals.diastolic,
      heartRate: normalizeVital(llm.vitals?.heartRate, 20, 260) ?? base.vitals.heartRate,
      temperature: normalizeVital(llm.vitals?.temperature, 85, 113) ?? base.vitals.temperature,
      spo2: normalizeVital(llm.vitals?.spo2, 30, 100) ?? base.vitals.spo2,
      weight: normalizeVital(llm.vitals?.weight, 1, 400) ?? base.vitals.weight,
      respiratoryRate: normalizeVital(llm.vitals?.respiratoryRate, 5, 80) ?? base.vitals.respiratoryRate,
    },
    diagnoses: llmDiagnoses.length > 0 ? llmDiagnoses : base.diagnoses,
    medications: llmMedications.length > 0 ? llmMedications : base.medications,
    examFindings: llmExamFindings.length > 0 ? llmExamFindings : base.examFindings,
    chiefComplaint: llm.chiefComplaint?.trim() || base.chiefComplaint,
    duration: llm.duration?.trim() || base.duration,
    appointment: {
      intent: typeof llm.appointment?.intent === "boolean" ? llm.appointment.intent : base.appointment.intent,
      doctor: llm.appointment?.doctor?.trim() || base.appointment.doctor,
      time: llm.appointment?.time?.trim() || base.appointment.time,
      date: llm.appointment?.date?.trim() || base.appointment.date,
    },
  };
}

async function extractEntitiesWithLlm(text: string): Promise<LlmExtractionResponse | null> {
  const apiKey = getLlmApiKey();
  if (!apiKey) return null;

  const model = getLlmModel();
  const baseUrl = getLlmBaseUrl();

  const response = await axios.post(
    `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
    {
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: LLM_EXTRACTION_RESPONSE_SCHEMA,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "You are a strict EMR field extraction engine.",
                "Extract only explicit clinical facts from text into EMR fields.",
                "STRICT RULES:",
                "1) Return ONLY valid JSON.",
                "2) Do not add markdown, explanation, or comments.",
                "3) Do not hallucinate missing vitals, diagnoses, medications, or findings.",
                "4) If unknown, use empty arrays, false, or omit optional scalar fields.",
                "5) Map terms to the closest EMR field only once; avoid duplicates.",
                "6) Keep chiefComplaint concise and clinically meaningful.",
                "Return JSON with this exact shape:",
                "{",
                '  "symptoms": string[],',
                '  "vitals": { "systolic"?: number, "diastolic"?: number, "heartRate"?: number, "temperature"?: number, "spo2"?: number, "weight"?: number, "respiratoryRate"?: number },',
                '  "diagnoses": string[],',
                '  "medications": string[],',
                '  "examFindings": string[],',
                '  "chiefComplaint"?: string,',
                '  "duration"?: string,',
                '  "appointment": { "intent": boolean, "doctor"?: string, "time"?: string, "date"?: string }',
                "}",
                "Do not invent values. Use empty arrays/false when uncertain.",
                "Clinical text:",
                text,
              ].join("\n"),
            },
          ],
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== "string") return null;

  return parseJsonObject(content);
}

export async function extractEntitiesForEmrConversion(text: string): Promise<ExtractedEntities> {
  const regexEntities = extractEntities(text);

  try {
    const llmEntities = await extractEntitiesWithLlm(text);
    if (!llmEntities) return regexEntities;
    return mergeEntities(regexEntities, llmEntities);
  } catch (error: any) {
    console.warn("LLM extraction unavailable, falling back to regex extractor:", error?.message || error);
    return regexEntities;
  }
}

function normalizeDoctorName(name: string): string {
  const cleaned = normalizeWhitespace(name.replace(/^dr\.?\s*/i, ""));
  const titleCased = cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
  return titleCased ? `Dr. ${titleCased}` : "Doctor";
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
