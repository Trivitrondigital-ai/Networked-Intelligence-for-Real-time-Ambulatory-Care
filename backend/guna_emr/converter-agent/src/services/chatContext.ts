import type { ChatMemorySnapshot, ChatFallbackChannels } from "../types";

interface UpsertMemoryInput {
  contextKey: string;
  userId?: string;
  role?: "patient" | "doctor" | "admin" | "nurse" | "unknown";
  language?: "en";
  summary?: string;
  triageLevel?: "routine" | "urgent" | "emergency";
  escalationBand?: "green" | "yellow" | "red";
  medications?: string[];
  allergies?: string[];
}

const localMemoryCache = new Map<string, ChatMemorySnapshot>();

function getSupabaseUrl(): string {
  return (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
}

function getSupabaseKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ""
  );
}

function hasSupabaseConfig() {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

async function fetchSupabase(path: string, init: RequestInit) {
  const url = `${getSupabaseUrl()}${path}`;
  const key = getSupabaseKey();

  return fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export function resolveChatContextKey(input: {
  userId?: string;
  role?: string;
  patientPhone?: string;
}) {
  const role = (input.role || "unknown").toLowerCase();

  if (input.userId?.trim()) {
    return `${role}:${input.userId.trim()}`;
  }

  if (input.patientPhone?.trim()) {
    return `${role}:phone:${input.patientPhone.trim()}`;
  }

  return `${role}:anonymous`;
}

export async function loadChatMemory(contextKey: string): Promise<ChatMemorySnapshot | null> {
  const cached = localMemoryCache.get(contextKey);
  if (cached) return cached;

  if (!hasSupabaseConfig()) return null;

  try {
    const response = await fetchSupabase(
      `/rest/v1/chat_context_memory?context_key=eq.${encodeURIComponent(contextKey)}&select=*`,
      { method: "GET" }
    );

    if (!response.ok) {
      return null;
    }

    const rows = (await response.json()) as any[];
    const row = rows?.[0];
    if (!row) return null;

    const snapshot: ChatMemorySnapshot = {
      contextKey: row.context_key,
      userId: row.user_id || undefined,
      role: row.role || "unknown",
      language: "en",
      summary: row.summary || "",
      triageLevel: row.triage_level || "routine",
      escalationBand: row.escalation_band || "green",
      lastEncounterAt: row.updated_at || row.created_at,
      medications: Array.isArray(row.medications) ? row.medications : [],
      allergies: Array.isArray(row.allergies) ? row.allergies : [],
    };

    localMemoryCache.set(contextKey, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

export async function upsertChatMemory(input: UpsertMemoryInput): Promise<void> {
  const snapshot: ChatMemorySnapshot = {
    contextKey: input.contextKey,
    userId: input.userId,
    role: input.role || "unknown",
    language: "en",
    summary: input.summary || "",
    triageLevel: input.triageLevel || "routine",
    escalationBand: input.escalationBand || "green",
    lastEncounterAt: new Date().toISOString(),
    medications: input.medications || [],
    allergies: input.allergies || [],
  };

  localMemoryCache.set(input.contextKey, snapshot);

  if (!hasSupabaseConfig()) return;

  try {
    await fetchSupabase("/rest/v1/chat_context_memory", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          context_key: input.contextKey,
          user_id: input.userId || null,
          role: input.role || "unknown",
          language: "en",
          summary: input.summary || "",
          triage_level: input.triageLevel || "routine",
          escalation_band: input.escalationBand || "green",
          medications: input.medications || [],
          allergies: input.allergies || [],
          updated_at: new Date().toISOString(),
        },
      ]),
    });
  } catch {
    // no-op (local cache remains source of truth for this runtime)
  }
}

export async function publishQueueRealtimeEvent(payload: {
  contextKey: string;
  eventType: "triage-updated" | "queue-updated" | "booking-created" | "fallback-triggered";
  escalationBand?: "green" | "yellow" | "red";
  triageLevel?: "routine" | "urgent" | "emergency";
  queueToken?: number;
  encounterId?: string;
  message: string;
}) {
  if (!hasSupabaseConfig()) return;

  try {
    await fetchSupabase("/rest/v1/chat_events", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify([
        {
          context_key: payload.contextKey,
          event_type: payload.eventType,
          escalation_band: payload.escalationBand || null,
          triage_level: payload.triageLevel || null,
          queue_token: payload.queueToken ?? null,
          encounter_id: payload.encounterId || null,
          message: payload.message,
          created_at: new Date().toISOString(),
        },
      ]),
    });
  } catch {
    // no-op
  }
}

async function postToFallbackWebhook(webhookUrl: string, payload: any): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function notifyFallbackChannels(input: {
  patientPhone?: string;
  contextKey: string;
  message: string;
  escalationBand: "green" | "yellow" | "red";
  triageLevel: "routine" | "urgent" | "emergency";
}): Promise<ChatFallbackChannels> {
  const shouldFallback = input.escalationBand === "red" || input.escalationBand === "yellow";
  if (!shouldFallback) {
    return { whatsapp: false, sms: false, reason: "No fallback required for green triage." };
  }

  const whatsappWebhook = process.env.WHATSAPP_WEBHOOK_URL || "";
  const smsWebhook = process.env.SMS_WEBHOOK_URL || "";

  const [whatsapp, sms] = await Promise.all([
    whatsappWebhook
      ? postToFallbackWebhook(whatsappWebhook, {
          to: input.patientPhone,
          contextKey: input.contextKey,
          triageLevel: input.triageLevel,
          escalationBand: input.escalationBand,
          message: input.message,
          channel: "whatsapp",
        })
      : Promise.resolve(false),
    smsWebhook
      ? postToFallbackWebhook(smsWebhook, {
          to: input.patientPhone,
          contextKey: input.contextKey,
          triageLevel: input.triageLevel,
          escalationBand: input.escalationBand,
          message: input.message,
          channel: "sms",
        })
      : Promise.resolve(false),
  ]);

  const reason =
    whatsapp || sms
      ? "Fallback notification dispatched via configured channels."
      : "Fallback required but webhook(s) not configured or unreachable.";

  return { whatsapp, sms, reason };
}
