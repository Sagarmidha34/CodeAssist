type GeminiMessage = { role: "user" | "model"; text: string };
export type GeminiJsonSchema = Record<string, unknown>;

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
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(requestBody(messages, instructions, maxOutputTokens, model, responseSchema)),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json() as { error?: { message?: string } };
      detail = body.error?.message?.slice(0, 240) || "";
    } catch { /* keep the provider error generic if its body isn't JSON */ }
    throw new Error(detail ? `Gemini request failed (${response.status}): ${detail}` : `Gemini request failed (${response.status}). Check the API key, model and free-tier quota.`);
  }
  return response;
}

function textFromCandidate(payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> }) {
  return payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
}

export async function generateGeminiText(instructions: string, prompt: string, maxOutputTokens = 1800, responseSchema?: GeminiJsonSchema) {
  const response = await request([{ role: "user", text: prompt }], instructions, maxOutputTokens, false, responseSchema);
  const payload = await response.json() as Parameters<typeof textFromCandidate>[0];
  const text = textFromCandidate(payload).trim();
  if (!text) throw new Error("Gemini returned an empty response. Check model access or safety settings.");
  return text;
}

export async function streamGeminiText(messages: GeminiMessage[], instructions: string, maxOutputTokens: number, onText: (text: string) => void) {
  const response = await request(messages, instructions, maxOutputTokens, true);
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
      const text = textFromCandidate(JSON.parse(data) as Parameters<typeof textFromCandidate>[0]);
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
  if (!answer.trim()) throw new Error("Gemini returned an empty response. Check model access, free-tier quota or safety settings.");
  return answer;
}
