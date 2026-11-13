type GeminiMessage = { role: "user" | "model"; text: string };
export type GeminiJsonSchema = Record<string, unknown>;

class GeminiQuotaError extends Error {
  constructor(message: string) { super(message); this.name = "GeminiQuotaError"; }
}

export const CODEASSIST_INSTRUCTIONS = `You are CodeAssist, a careful programming assistant. Explain your reasoning clearly, provide correct and runnable code, mention important assumptions, and call out risks. Prefer concise answers. Never claim code was executed unless the restricted test runner actually ran it.`;

function config() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Add GEMINI_API_KEY to the server environment to enable Gemini responses.");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3-flash-preview";
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("GEMINI_MODEL contains invalid characters.");
  return { apiKey, model };
}

function requestBody(messages: GeminiMessage[], instructions: string, maxOutputTokens: number, model: string, responseSchema?: GeminiJsonSchema) {
  const supportsThinkingLevel = model.startsWith("gemini-3") || model.startsWith("gemini-4");
  return {
    systemInstruction: { parts: [{ text: instructions }] },
    contents: messages.map(message => ({ role: message.role, parts: [{ text: message.text }] })),
    generationConfig: {
      maxOutputTokens,
      temperature: responseSchema ? 0.1 : 0.3,
      ...(supportsThinkingLevel ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
      ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
    },
  };
}

async function request(messages: GeminiMessage[], instructions: string, maxOutputTokens: number, streaming: boolean, responseSchema?: GeminiJsonSchema) {
  const { apiKey, model } = config();
  const method = streaming ? "streamGenerateContent?alt=sse" : "generateContent";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;
  const body = JSON.stringify(requestBody(messages, instructions, maxOutputTokens, model, responseSchema));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body,
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
    if (response.ok) return response;

    let payload: { error?: { message?: string; details?: Array<{ "@type"?: string; retryDelay?: string; violations?: Array<{ quotaId?: string; quotaMetric?: string }> }> } } = {};
    try { payload = await response.json(); } catch { /* keep provider details optional */ }
    const detail = payload.error?.message?.slice(0, 240) || "";
    const quotaText = [detail, ...(payload.error?.details || []).flatMap(item => (item.violations || []).flatMap(v => [v.quotaId, v.quotaMetric]))].filter(Boolean).join(" ");
    const dailyQuota = /per[\s_-]*day|daily|day[\s_-]*limit|requests[\s_-]*per[\s_-]*day/i.test(quotaText);
    const transientRateLimit = response.status === 429 && /rate[\s_-]*limit|per[\s_-]*minute|per[\s_-]*second|tokens[\s_-]*per/i.test(quotaText);

    if (dailyQuota) throw new GeminiQuotaError("Gemini's daily quota for this project is exhausted.");

    if (attempt < 2 && (response.status === 503 || transientRateLimit)) {
      const retryInfo = payload.error?.details?.find(item => item["@type"]?.endsWith("RetryInfo"))?.retryDelay;
      const retryHeader = response.headers.get("retry-after");
      const retryMs = retryHeader && Number.isFinite(Number(retryHeader))
        ? Number(retryHeader) * 1_000
        : retryInfo?.match(/^(\d+(?:\.\d+)?)s$/)
          ? Number(retryInfo.match(/^(\d+(?:\.\d+)?)s$/)![1]) * 1_000
          : response.status === 503 ? 750 * (attempt + 1) : 1_000 * (attempt + 1);
      // Only retry short, temporary limits. A long wait should be shown to the user
      // instead of holding a serverless request open or repeatedly spending quota.
      if (retryMs <= 5_000) {
        await new Promise(resolve => setTimeout(resolve, retryMs));
        continue;
      }
    }

    if (response.status === 429) {
      throw new GeminiQuotaError("Gemini quota or rate limit reached for this project.");
    }
    throw new Error(detail ? `Gemini request failed (${response.status}): ${detail}` : `Gemini request failed (${response.status}). Check the API key, model and quota.`);
  }
  throw new Error("Gemini is temporarily rate-limited. Please wait a moment and try again.");
}

function groqConfig() {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("Gemini quota is exhausted and no fallback is configured. Add GROQ_API_KEY to enable the optional Groq fallback.");
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
  if (!/^[a-zA-Z0-9._/-]+$/.test(model)) throw new Error("GROQ_MODEL contains invalid characters.");
  return { apiKey, model };
}

function groqMessages(messages: GeminiMessage[], instructions: string, responseSchema?: GeminiJsonSchema) {
  const normalizeSchema = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalizeSchema);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === "type" && typeof item === "string" ? item.toLowerCase() : normalizeSchema(item),
    ]));
  };
  const schemaHint = responseSchema ? `\nReturn a JSON object matching this JSON Schema exactly:\n${JSON.stringify(normalizeSchema(responseSchema))}` : "";
  return [
    { role: "system", content: `${instructions}${schemaHint}` },
    ...messages.map(message => ({ role: message.role === "model" ? "assistant" : "user", content: message.text })),
  ];
}

async function requestGroq(messages: GeminiMessage[], instructions: string, maxOutputTokens: number, streaming: boolean, responseSchema?: GeminiJsonSchema) {
  const { apiKey, model } = groqConfig();
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: groqMessages(messages, instructions, responseSchema),
      max_completion_tokens: maxOutputTokens,
      temperature: responseSchema ? 0.1 : 0.3,
      ...(responseSchema ? { response_format: { type: "json_object" } } : {}),
      ...(streaming ? { stream: true } : {}),
    }),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (response.ok) return response;
  let detail = "";
  try {
    const payload = await response.json() as { error?: { message?: string } };
    detail = payload.error?.message?.slice(0, 240) || "";
  } catch { /* provider error body is optional */ }
  throw new Error(detail ? `Groq fallback failed (${response.status}): ${detail}` : `Groq fallback failed (${response.status}). Check GROQ_API_KEY, GROQ_MODEL and Groq limits.`);
}

function textFromCandidate(payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> }) {
  return payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
}

export async function generateGeminiText(instructions: string, prompt: string, maxOutputTokens = 1800, responseSchema?: GeminiJsonSchema) {
  let response: Response;
  try {
    response = await request([{ role: "user", text: prompt }], instructions, maxOutputTokens, false, responseSchema);
  } catch (error) {
    if (!(error instanceof GeminiQuotaError)) throw error;
    response = await requestGroq([{ role: "user", text: prompt }], instructions, maxOutputTokens, false, responseSchema);
  }
  const payload = await response.json() as Parameters<typeof textFromCandidate>[0];
  const text = ("candidates" in payload
    ? textFromCandidate(payload)
    : (payload as unknown as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("The AI provider returned an empty response. Check model access or safety settings.");
  return text;
}

export async function streamGeminiText(messages: GeminiMessage[], instructions: string, maxOutputTokens: number, onText: (text: string) => void) {
  let response: Response;
  let provider: "gemini" | "groq" = "gemini";
  try {
    response = await request(messages, instructions, maxOutputTokens, true);
  } catch (error) {
    if (!(error instanceof GeminiQuotaError)) throw error;
    response = await requestGroq(messages, instructions, maxOutputTokens, true);
    provider = "groq";
  }
  if (!response.body) throw new Error("Gemini did not return a response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  const processFrame = (frame: string) => {
    for (const line of frame.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const payload = JSON.parse(data) as Parameters<typeof textFromCandidate>[0] & { choices?: Array<{ delta?: { content?: string } }> };
      const text = provider === "gemini" ? textFromCandidate(payload) : payload.choices?.[0]?.delta?.content || "";
      if (text) { answer += text; onText(text); }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) processFrame(frame);
    if (done) break;
  }
  if (buffer.trim()) processFrame(buffer);
  if (!answer.trim()) throw new Error("The AI provider returned an empty response. Check model access, quota or safety settings.");
  return answer;
}
