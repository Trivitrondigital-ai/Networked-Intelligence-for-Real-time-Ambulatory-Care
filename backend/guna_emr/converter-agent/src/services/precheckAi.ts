import axios from "axios";

export interface PrecheckQuestion {
  id?: string;
  question: string;
  type?: "text" | "yesno" | "multiple_choice" | "rating";
  options?: string[];
  required?: boolean;
  category?: string;
  priority?: number;
}

export interface PrecheckQuestionRequest {
  encounterId?: string;
  chiefComplaint?: string;
  patientName?: string;
  patientAge?: number;
  patientGender?: string;
  patientNotes?: string;
  specialty?: string;
  appointmentType?: string;
  existingConditions?: string[];
  latestSymptoms?: string[];
  currentMedications?: string[];
}

export interface PrecheckQuestionResponse {
  questions: PrecheckQuestion[];
  model: string;
  usedFallback: boolean;
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

function parseJsonObject(text: string): any | null {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeQuestionType(type: unknown): PrecheckQuestion["type"] {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "yesno" || normalized === "yes_no" || normalized === "boolean") return "yesno";
  if (normalized === "multiple_choice" || normalized === "multiple-choice") return "multiple_choice";
  if (normalized === "rating" || normalized === "scale") return "rating";
  return "text";
}

function normalizeQuestions(questions: unknown): PrecheckQuestion[] {
  if (!Array.isArray(questions)) return [];

  const seen = new Set<string>();
  const normalized = questions
    .map((item, index) => {
      const questionText = String((item as any)?.question || (item as any)?.text || "").trim();
      if (!questionText) return null;

      return {
        id: `ai-precheck-${index + 1}`,
        question: questionText,
        type: normalizeQuestionType((item as any)?.type),
        options: Array.isArray((item as any)?.options)
          ? (item as any).options.map((value: unknown) => String(value)).filter(Boolean).slice(0, 6)
          : [],
        required: (item as any)?.required !== false,
        category: String((item as any)?.category || "general").toLowerCase(),
        priority: Number.isFinite(Number((item as any)?.priority)) ? Number((item as any)?.priority) : 5
      } as PrecheckQuestion;
    })
    .filter((item): item is PrecheckQuestion => Boolean(item))
    .filter((item) => {
      const key = item.question.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);

  return normalized;
}

function buildFallbackQuestions(payload: PrecheckQuestionRequest): PrecheckQuestion[] {
  const complaint = String(payload.chiefComplaint || "").trim();
  const symptomHint = (payload.latestSymptoms || []).slice(0, 4).join(", ");
  const specialty = String(payload.specialty || "").trim();

  const base: PrecheckQuestion[] = [
    {
      id: "fallback-1",
      question: complaint
        ? `You mentioned "${complaint}" — can you describe how it feels and what triggered it?`
        : "In your own words, what's the main reason for your visit today?",
      type: "text",
      required: true,
      category: "symptoms",
      priority: 9
    },
    {
      id: "fallback-2",
      question: "When did this start? Is it getting better, worse, or staying the same?",
      type: "multiple_choice",
      options: ["Started today", "A few days ago", "About a week", "More than a week", "It comes and goes"],
      required: true,
      category: "timeline",
      priority: 9
    },
    {
      id: "fallback-3",
      question: "How would you rate the severity right now?",
      type: "multiple_choice",
      options: ["Mild — I can manage", "Moderate — it's affecting my day", "Severe — I need relief soon"],
      required: true,
      category: "symptoms",
      priority: 8
    },
    {
      id: "fallback-4",
      question: payload.currentMedications?.length
        ? `Are you still taking: ${payload.currentMedications.join(", ")}? Any new medicines or supplements started recently?`
        : "What medicines, supplements, or vitamins are you currently taking? (Include dosage if you know it.)",
      type: "text",
      required: true,
      category: "medications",
      priority: 8
    },
    {
      id: "fallback-5",
      question: "Do you have any known allergies to medicines, foods, or anything else?",
      type: "yesno",
      required: true,
      category: "allergies",
      priority: 8
    },
    {
      id: "fallback-6",
      question: "Have you had any of these warning signs recently: chest pain, difficulty breathing, sudden severe headache, fainting, or blood in stool/urine?",
      type: "yesno",
      required: true,
      category: "red_flags",
      priority: 9
    }
  ];

  if (symptomHint) {
    base.push({
      id: "fallback-7",
      question: `Among your recent symptoms (${symptomHint}), which one bothers you the most right now?`,
      type: "text",
      required: false,
      category: "symptoms",
      priority: 7
    });
  }

  base.push({
    id: "fallback-8",
    question: "Is there anything else you'd like your doctor to know before the appointment?",
    type: "text",
    required: false,
    category: "follow_up",
    priority: 6
  });

  return base.slice(0, 10);
}

function buildPrompt(payload: PrecheckQuestionRequest): string {
  return [
    "You are an expert clinical intake nurse preparing a patient for an outpatient consultation.",
    "Generate warm, empathetic, and clinically precise pre-appointment questions.",
    "",
    "GOAL: Collect the most useful information so the doctor can:",
    "1. Triage the patient accurately before the visit",
    "2. Identify red-flag symptoms early",
    "3. Review medications and allergies to avoid adverse events",
    "4. Reduce in-clinic waiting time by having context upfront",
    "",
    "QUESTION DESIGN GUIDELINES:",
    "- Start with the chief complaint: ask what brings them in, in their own words",
    "- Ask about timeline: when did it start, is it getting better/worse/same?",
    "- Severity and character: mild/moderate/severe, constant/intermittent, what worsens or relieves it",
    "- Screen for RED FLAGS relevant to the chief complaint (e.g. chest pain with breathlessness, sudden severe headache, blood in stool)",
    "- Current medications and dosages — especially if they take blood thinners, insulin, or cardiac drugs",
    "- Known allergies: drug, food, environmental",
    "- Recent changes: new symptoms in the last 48 hours, recent travel, recent hospital visits",
    "- Functional impact: how is this affecting daily life, work, or sleep?",
    "- End with an open question: 'Is there anything else you want your doctor to know?'",
    "",
    "TONE: Write questions as if a caring, experienced nurse is asking them face-to-face.",
    "- Use simple, jargon-free language",
    "- Be specific to the patient's context (specialty, complaint, age, gender)",
    "- Avoid generic filler questions",
    "- Use yes/no or multiple-choice where a quick answer suffices",
    "- Use free-text for nuanced responses",
    "",
    "Return ONLY valid JSON with this schema:",
    '{"questions":[{"question":"...","type":"text|yesno|multiple_choice|rating","required":true,"category":"symptoms|history|medications|allergies|red_flags|lifestyle|follow_up","options":[],"priority":9}]}',
    "Do not include markdown fences or commentary.",
    "Generate 6 to 10 questions. Deduplicate rigorously.",
    "",
    `Patient context: ${JSON.stringify(payload)}`
  ].join("\n");
}

export async function generateAiPrecheckQuestions(payload: PrecheckQuestionRequest): Promise<PrecheckQuestionResponse> {
  const model = getModel();
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      questions: buildFallbackQuestions(payload),
      model: `${model} (fallback mode)` ,
      usedFallback: true
    };
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/models/${model}:generateContent?key=${apiKey}`,
      {
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(payload) }]
          }
        ]
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 20000
      }
    );

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = parseJsonObject(rawText);
    const questions = normalizeQuestions(parsed?.questions);

    if (!questions.length) {
      return {
        questions: buildFallbackQuestions(payload),
        model: `${model} (fallback mode)` ,
        usedFallback: true
      };
    }

    return {
      questions,
      model,
      usedFallback: false
    };
  } catch (error) {
    return {
      questions: buildFallbackQuestions(payload),
      model: `${model} (fallback mode)` ,
      usedFallback: true
    };
  }
}
