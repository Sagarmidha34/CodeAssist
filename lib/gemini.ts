type GeminiMessage = { role: "user" | "model"; text: string };
export type GeminiJsonSchema = Record<string, unknown>;

class GeminiQuotaError extends Error {
  constructor(message: string) { super(message); this.name = "GeminiQuotaError"; }
}
class GeminiUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "GeminiUnavailableError"; }
}

function canUseAlternateProvider(error: unknown) {
  return error instanceof GeminiQuotaError || error instanceof GeminiUnavailableError;
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
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(90_000),
        cache: "no-store",
      });
    } catch {
      if (attempt < 2) { await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1))); continue; }
      throw new GeminiUnavailableError("Gemini could not be reached. Trying the alternate model.");
    }
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
    if ([500, 502, 503, 504].includes(response.status)) {
      throw new GeminiUnavailableError("Gemini is temporarily unavailable. Trying the alternate model.");
    }
    throw new Error(detail ? `Gemini request failed (${response.status}): ${detail}` : `Gemini request failed (${response.status}). Check the API key, model and quota.`);
  }
  throw new Error("Gemini is temporarily rate-limited. Please wait a moment and try again.");
}

type AlternateProvider = { label: string; apiKey: string; model: string; baseUrl: string; maxTokensField: "max_tokens" | "max_completion_tokens" };

function alternateProviders(): AlternateProvider[] {
  const providers: AlternateProvider[] = [];
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    providers.push({
      label: "Groq",
      apiKey: groqKey,
      model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
      baseUrl: "https://api.groq.com/openai/v1",
      maxTokensField: "max_completion_tokens",
    });
  }

  for (let slot = 1; slot <= 4; slot += 1) {
    const prefix = `AI_FALLBACK_${slot}`;
    const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
    const model = process.env[`${prefix}_MODEL`]?.trim();
    const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim();
    if (!apiKey && !model && !baseUrl) continue;
    if (!apiKey || !model || !baseUrl) {
      throw new Error(`${prefix} needs all three settings: API_KEY, MODEL and BASE_URL.`);
    }
    let parsedBaseUrl: URL;
    try { parsedBaseUrl = new URL(baseUrl); }
    catch { throw new Error(`${prefix}_BASE_URL must be a valid HTTPS API URL.`); }
    if (parsedBaseUrl.protocol !== "https:") throw new Error(`${prefix}_BASE_URL must use HTTPS.`);
    if (!/^[a-zA-Z0-9._/-]+$/.test(model)) throw new Error(`${prefix}_MODEL contains invalid characters.`);
    providers.push({ label: `Alternate model ${slot}`, apiKey, model, baseUrl: baseUrl.replace(/\/+$/, ""), maxTokensField: "max_tokens" });
  }

  const uniqueHosts = new Set<string>();
  for (const provider of providers) {
    const host = new URL(provider.baseUrl).host.toLowerCase();
    if (uniqueHosts.has(host)) throw new Error("Configure each fallback slot for a different AI provider endpoint.");
    uniqueHosts.add(host);
  }
  return providers;
}

function groqSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(groqSchema);
  if (!value || typeof value !== "object") return value;
  const normalized = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === "type" && typeof item === "string" ? item.toLowerCase() : groqSchema(item),
  ])) as Record<string, unknown>;
  if (normalized.type === "object") {
    const properties = normalized.properties && typeof normalized.properties === "object"
      ? normalized.properties as Record<string, unknown>
      : {};
    normalized.required = Array.isArray(normalized.required)
      ? Array.from(new Set([...normalized.required, ...Object.keys(properties)]))
      : Object.keys(properties);
    normalized.additionalProperties = false;
  }
  return normalized;
}

function groqMessages(messages: GeminiMessage[], instructions: string, responseSchema?: GeminiJsonSchema, jsonObjectMode = false) {
  const schemaHint = responseSchema
    ? ` Return only a valid JSON object matching this schema${jsonObjectMode ? "" : " exactly"}, with no Markdown or extra text: ${JSON.stringify(groqSchema(responseSchema))}`
    : "";
  return [
    { role: "system", content: `${instructions}${schemaHint}` },
    ...messages.map(message => ({ role: message.role === "model" ? "assistant" : "user", content: message.text })),
  ];
}

async function requestAlternate(provider: AlternateProvider, messages: GeminiMessage[], instructions: string, maxOutputTokens: number, streaming: boolean, responseSchema?: GeminiJsonSchema) {
  const send = (jsonObjectMode = false) => fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({
      model: provider.model,
      messages: groqMessages(messages, instructions, responseSchema, jsonObjectMode),
      [provider.maxTokensField]: maxOutputTokens,
      temperature: responseSchema ? 0.1 : 0.3,
      ...(responseSchema ? {
        response_format: jsonObjectMode
          ? { type: "json_object" }
          : {
              type: "json_schema",
              json_schema: {
                name: "codeassist_response",
                strict: true,
                schema: groqSchema(responseSchema),
              },
            },
      } : {}),
      ...(streaming ? { stream: true } : {}),
    }),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  let response = await send();
  if (!response.ok && responseSchema && !streaming && response.status === 400) {
    // Some OpenAI-compatible providers/models reject strict JSON Schema mode.
    // Retry once using JSON Object Mode; the schema is also included in the
    // system prompt and the caller still validates the parsed result.
    try { await response.clone().body?.cancel(); } catch { /* release response if possible */ }
    response = await send(true);
  }
  if (response.ok) return response;
  let detail = "";
  let failedGeneration = false;
  try {
    const payload = await response.json() as { error?: { message?: string; failed_generation?: unknown } };
    detail = payload.error?.message?.slice(0, 240) || "";
    failedGeneration = payload.error?.failed_generation !== undefined;
  } catch { /* provider error body is optional */ }
  if (failedGeneration) throw new Error(`${provider.label} rejected both strict-schema and JSON-object response modes. Check that this model supports JSON output.`);
  throw new Error(detail ? `${provider.label} request failed (${response.status}): ${detail}` : `${provider.label} request failed (${response.status}). Check its key, model and usage limits.`);
}

async function requestAlternateChain(messages: GeminiMessage[], instructions: string, maxOutputTokens: number, streaming: boolean, responseSchema?: GeminiJsonSchema) {
  const providers = alternateProviders();
  if (!providers.length) throw new Error("Gemini is unavailable and no alternate AI provider is configured. Add a fallback API key, model and base URL in the server environment.");

  const failures: string[] = [];
  for (const provider of providers) {
    try { return await requestAlternate(provider, messages, instructions, maxOutputTokens, streaming, responseSchema); }
    catch (error) { failures.push(error instanceof Error ? error.message : `${provider.label} request failed.`); }
  }
  throw new Error(`Gemini is unavailable, and all configured alternate models failed. ${failures.join(" | ")}`);
}

function textFromCandidate(payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> }) {
  return payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
}

export async function generateGeminiText(instructions: string, prompt: string, maxOutputTokens = 1800, responseSchema?: GeminiJsonSchema) {
  let response: Response;
  try {
    response = await request([{ role: "user", text: prompt }], instructions, maxOutputTokens, false, responseSchema);
  } catch (error) {
    if (!canUseAlternateProvider(error)) throw error;
    response = await requestAlternateChain([{ role: "user", text: prompt }], instructions, maxOutputTokens, false, responseSchema);
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
  let provider: "gemini" | "alternate" = "gemini";
  try {
    response = await request(messages, instructions, maxOutputTokens, true);
  } catch (error) {
    if (!canUseAlternateProvider(error)) throw error;
    response = await requestAlternateChain(messages, instructions, maxOutputTokens, true);
    provider = "alternate";
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
