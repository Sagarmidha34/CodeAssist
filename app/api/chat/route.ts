import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CODEASSIST_INSTRUCTIONS, streamGeminiText } from "@/lib/gemini";
import { hasValidSameOrigin } from "@/lib/http";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: "Add GEMINI_API_KEY to the server environment to enable Gemini responses." }, { status: 503 });

  let input: { conversationId?: unknown; message?: unknown };
  try {
    if (Number(request.headers.get("content-length") || 0) > 12_000) return NextResponse.json({ error: "Message is too large." }, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 12_000) { await reader.cancel(); return NextResponse.json({ error: "Message is too large." }, { status: 413 }); }
      chunks.push(value);
    }
    input = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8"));
  }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!conversationId || message.length < 1 || message.length > 8_000 || Number(request.headers.get("content-length") || 0) > 12_000) return NextResponse.json({ error: "Message must contain 1 to 8,000 characters." }, { status: 400 });

  const { data: conversation, error: conversationError } = await supabase.from("conversations").select("id,title").eq("id", conversationId).single();
  if (conversationError || !conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "The server database key is not configured." }, { status: 503 });
  const { data: quota, error: quotaError } = await supabase.rpc("consume_chat_quota", { p_daily_limit: 30 });
  if (quotaError) {
    const limited = quotaError.message.includes("daily_limit");
    const message = quotaError.message.includes("global_daily_limit") ? "CodeAssist has reached its daily service limit. Please try again tomorrow." : "You’ve reached today’s 30-message limit. Please come back tomorrow.";
    return NextResponse.json({ error: limited ? message : "Could not check your message allowance." }, { status: limited ? 429 : 500 });
  }

  const admin = createAdminClient();
  const { error: saveUserError } = await admin.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "user", content: message });
  if (saveUserError) return NextResponse.json({ error: "Could not save your message." }, { status: 500 });
  const title = conversation.title === "New conversation" ? message.replace(/\s+/g, " ").slice(0, 64) : conversation.title;
  const { error: updateError } = await supabase.from("conversations").update({ title, updated_at: new Date().toISOString() }).eq("id", conversationId);
  if (updateError) return NextResponse.json({ error: "Could not update the conversation." }, { status: 500 });

  const { data: history, error: historyError } = await admin.from("messages").select("role,content").eq("conversation_id", conversationId).eq("user_id", user.id).order("created_at", { ascending: false }).limit(24);
  if (historyError || !history) return NextResponse.json({ error: "Could not load the saved conversation history." }, { status: 500 });
  const contents = history.reverse().map(row => ({ role: row.role === "assistant" ? "model" as const : "user" as const, text: row.content.slice(0, 12_000) }));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder(); let answer = "";
      try {
        answer = await streamGeminiText(contents, CODEASSIST_INSTRUCTIONS, 2_000, delta => {
          controller.enqueue(encoder.encode(sse("delta", { text: delta })));
        });
        if (!answer.trim()) throw new Error("The AI provider returned an empty response.");
        const { error } = await admin.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", content: answer });
        if (error) throw new Error("The response was generated, but could not be saved to your conversation.");
        controller.enqueue(encoder.encode(sse("done", { remaining: Math.max(0, 30 - Number(quota ?? 0)) })));
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "The response failed unexpectedly.";
        controller.enqueue(encoder.encode(sse("error", { message })));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
