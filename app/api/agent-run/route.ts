import { spawn } from "node:child_process";
import { join } from "node:path";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateGeminiText, type GeminiJsonSchema } from "@/lib/gemini";
import { hasValidSameOrigin } from "@/lib/http";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type TestCase = { name: string; stdin: string; expected: string };
type TestResult = TestCase & { received: string; passed: boolean; error: string };
let activePythonRuns = 0;
const MAX_CONCURRENT_PYTHON_RUNS = 4;

function sse(event: string, data: unknown) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function jsonFrom(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf("{");
    if (start >= 0) {
      let depth = 0; let inString = false; let escaped = false;
      for (let i = start; i < cleaned.length; i++) {
        const char = cleaned[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') inString = true;
        else if (char === "{") depth += 1;
        else if (char === "}" && --depth === 0) {
          try { return JSON.parse(cleaned.slice(start, i + 1)); }
          catch { break; }
        }
      }
    }
    throw new Error("Gemini returned invalid structured data. Please retry the agent task.");
  }
}
function python(source: string, input: string): Promise<{ ok: boolean; stdout: string; error: string }> {
  return new Promise(resolve => {
    if (activePythonRuns >= MAX_CONCURRENT_PYTHON_RUNS) {
      resolve({ ok: false, stdout: "", error: "The code runner is busy. Please try again in a moment." });
      return;
    }
    activePythonRuns += 1;
    const child = spawn(/* turbopackIgnore: true */ "python3", ["-I", "-S", join(process.cwd(), "lib", "python_runner.py")], {
      cwd: process.cwd(), env: { NODE_ENV: process.env.NODE_ENV || "production", PATH: process.env.PATH || "/usr/bin:/bin", PYTHONIOENCODING: "utf-8" }, stdio: ["pipe", "pipe", "ignore"] as const,
    });
    let stdout = ""; let settled = false;
    const finish = (result: { ok: boolean; stdout: string; error: string }) => { if (!settled) { settled = true; activePythonRuns -= 1; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, stdout: "", error: "Execution exceeded the 3.5 second limit." }); }, 3500);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; if (stdout.length > 8_000) { child.kill("SIGKILL"); finish({ ok: false, stdout: "", error: "Runner response exceeded its output limit." }); } });
    child.on("error", () => finish({ ok: false, stdout: "", error: "Python is not installed in this deployment. Add Python 3.11+ to the app container." }));
    child.on("close", code => {
      if (settled) return;
      try {
        const result = JSON.parse(stdout) as { ok: boolean; stdout: string; error: string };
        finish(result);
      } catch { finish({ ok: false, stdout: "", error: code === null ? "Python execution stopped unexpectedly." : "Python runner returned an invalid result." }); }
    });
    child.stdin.end(JSON.stringify({ code: source, input }));
  });
}

async function callAgent(instructions: string, input: string, tokens = 1800, responseSchema?: GeminiJsonSchema) {
  return generateGeminiText(instructions, input, tokens, responseSchema);
}

const requirementSchema: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    requirements: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary", "requirements"],
};

const testSchema: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    tests: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          stdin: { type: "STRING" },
          expected: { type: "STRING" },
        },
        required: ["name", "stdin", "expected"],
      },
    },
  },
  required: ["tests"],
};

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: "Add GEMINI_API_KEY to the server environment to enable the agent workflow." }, { status: 503 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "The server database key is not configured." }, { status: 503 });

  let body: { conversationId?: unknown; message?: unknown };
  try {
    if (Number(request.headers.get("content-length") || 0) > 12_000) return NextResponse.json({ error: "Message is too large." }, { status: 413 });
    const reader = request.body?.getReader(); if (!reader) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 12_000) { await reader.cancel(); return NextResponse.json({ error: "Message is too large." }, { status: 413 }); } chunks.push(value); }
    body = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8"));
  } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const requirement = typeof body.message === "string" ? body.message.trim() : "";
  if (!conversationId || requirement.length < 1 || requirement.length > 8_000) return NextResponse.json({ error: "Task description must contain 1 to 8,000 characters." }, { status: 400 });
  const { data: conversation, error: conversationError } = await supabase.from("conversations").select("id,title").eq("id", conversationId).single();
  if (conversationError || !conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const { data: quota, error: quotaError } = await supabase.rpc("consume_chat_quota", { p_daily_limit: 30 });
  if (quotaError) {
    const limited = quotaError.message.includes("daily_limit");
    const message = quotaError.message.includes("global_daily_limit") ? "CodeAssist has reached its daily service limit. Please try again tomorrow." : "You’ve reached today’s 30-message limit. Please come back tomorrow.";
    return NextResponse.json({ error: limited ? message : "Could not check your task allowance." }, { status: limited ? 429 : 500 });
  }

  const admin = createAdminClient();
  const { error: saveUserError } = await admin.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "user", content: requirement });
  if (saveUserError) return NextResponse.json({ error: "Could not save your task." }, { status: 500 });
  const title = conversation.title === "New conversation" ? requirement.replace(/\s+/g, " ").slice(0, 64) : conversation.title;
  const { error: updateError } = await supabase.from("conversations").update({ title, updated_at: new Date().toISOString() }).eq("id", conversationId);
  if (updateError) return NextResponse.json({ error: "Could not update the conversation." }, { status: 500 });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));
      const stage = (agent: string, status: "running" | "complete" | "failed", detail: string) => emit("agent", { agent, status, detail });
      let finalText = "";
      try {
        stage("Requirement Agent", "running", "Structuring the task and identifying acceptance requirements.");
        const requirementJson = await callAgent(
          "You are the Requirement Agent. Convert the user's programming task into a concise, unambiguous specification. Return only valid JSON with keys: summary (string), requirements (array of strings). Do not invent requirements that are not implied; state assumptions in requirements. Do not write code or tests.",
          requirement, 1600, requirementSchema);
        const spec = jsonFrom(requirementJson) as { summary?: string; requirements?: string[] };
        if (!Array.isArray(spec.requirements) || spec.requirements.length === 0) throw new Error("Requirement Agent did not provide a usable specification.");
        stage("Requirement Agent", "complete", `${spec.requirements.length} requirement points prepared.`);

        stage("Coding Agent", "running", "Generating a Python solution from the structured requirement.");
        const codePrompt = `Programming task:\n${requirement}\n\nStructured requirement:\n${(spec.requirements || []).map(item => `- ${item}`).join("\n")}\n\nWrite a complete Python 3 program that reads input from standard input and writes the answer to standard output. Do not import modules. Avoid attributes and file access. Return code only, without Markdown fences.`;
        let code = await callAgent("You are the Coding Agent. Write correct, readable Python code that follows the task exactly. The code runs in a small restricted interpreter: no imports, file access, network, attributes, or third-party packages. Use only basic built-ins, loops, conditionals, and functions. Return only Python code.", codePrompt, 2000);
        code = code.replace(/^```(?:python)?\s*/i, "").replace(/\s*```$/, "").trim();
        stage("Coding Agent", "complete", "Initial Python solution is ready for test execution.");

        stage("Testing Agent", "running", "Creating edge-case checks, then running them in the restricted Python runner.");
        const testsJson = await callAgent(
          "You are the Testing Agent. Based on the task, structured requirements, and candidate Python code, create a small black-box test suite. Return only valid JSON with key tests: an array of up to 5 objects with name, stdin, expected. stdin is exact standard input text; expected is exact standard output after trimming. Include normal and edge cases when the requirements justify them. Do not modify or execute the code.",
          `Task: ${requirement}\nRequirements:\n${spec.requirements.map(item => `- ${item}`).join("\n")}\nCandidate code:\n${code}`, 1500, testSchema);
        const testPlan = jsonFrom(testsJson) as { tests?: TestCase[] };
        if (!Array.isArray(testPlan.tests) || testPlan.tests.length === 0) throw new Error("Testing Agent did not provide any usable tests.");
        const tests: TestCase[] = testPlan.tests.slice(0, 5).map((test, index) => ({
          name: typeof test.name === "string" ? test.name.slice(0, 80) : `Case ${index + 1}`,
          stdin: typeof test.stdin === "string" ? test.stdin.slice(0, 2_000) : "",
          expected: typeof test.expected === "string" ? test.expected.slice(0, 1_000).trim() : "",
        }));
        let results = await runTests(code, tests);
        stage("Testing Agent", results.every(result => result.passed) ? "complete" : "failed", `${results.filter(result => result.passed).length} of ${results.length} generated checks passed.`);
        let repairUsed = false;
        if (results.some(result => !result.passed)) {
          repairUsed = true;
          stage("Review Agent", "running", "Analyzing test failures and preparing one bounded repair.");
          const failureText = results.filter(result => !result.passed).map(result => `Test ${result.name}\nstdin: ${JSON.stringify(result.stdin)}\nexpected: ${JSON.stringify(result.expected)}\nreceived: ${JSON.stringify(result.received)}\nerror: ${result.error || "none"}`).join("\n\n");
          const repairPrompt = `The first code failed these tests. Return a corrected complete Python 3 program only. Preserve the requirement and do not add imports or attributes.\n\nRequirement: ${requirement}\n\nCurrent code:\n${code}\n\nFailures:\n${failureText}`;
          stage("Coding Agent", "running", "Applying the single allowed repair attempt.");
          code = await callAgent("You are the Coding Agent repairing code after concrete test feedback. Fix the reported problems while preserving the task. The restricted runner blocks imports, attributes, file access, and network. Return Python code only.", repairPrompt, 2000);
          code = code.replace(/^```(?:python)?\s*/i, "").replace(/\s*```$/, "").trim();
          stage("Coding Agent", "complete", "The bounded repair is ready; no additional repair will be attempted.");
          stage("Testing Agent", "running", "Re-running the same tests against the repaired code.");
          results = await runTests(code, tests);
          stage("Testing Agent", results.every(result => result.passed) ? "complete" : "failed", `Repair run: ${results.filter(result => result.passed).length} of ${results.length} checks passed.`);
        }

        stage("Review Agent", "running", "Reviewing the final code and observed test outcomes.");
        const testSummary = results.map(result => `${result.passed ? "PASS" : "FAIL"} ${result.name}: expected ${JSON.stringify(result.expected)}, received ${JSON.stringify(result.received)}${result.error ? ` (${result.error})` : ""}`).join("\n");
        const review = await callAgent("You are the Review Agent. Review the task, code, and actual test outcomes. Explain correctness confidence and any remaining limitations in 2-4 concise sentences. Never claim full correctness from a small sample.", `Task: ${requirement}\nRequirements: ${(spec.requirements || []).join("; ")}\nFinal test outcomes:\n${testSummary}\nRepair attempt used: ${repairUsed}`, 450);
        stage("Review Agent", "complete", "Final review is ready.");

        const passed = results.filter(result => result.passed).length;
        const testTable = results.map(result => `| ${result.passed ? "Pass" : "Fail"} | ${result.name.replaceAll("|", "\\|")} | ${result.expected.replaceAll("|", "\\|")} | ${result.received.replaceAll("|", "\\|")} |`).join("\n");
        finalText = `### Requirement analysis\n${(spec.requirements || []).map(item => `- ${item}`).join("\n")}\n\n### Test results (${passed}/${results.length} passed)\n| Status | Test | Expected | Actual |\n|---|---|---|---|\n${testTable}\n\n### Review\n${review}\n\n${repairUsed ? "One repair attempt was used." : "No repair was needed."}\n\n### Python solution\n\`\`\`python\n${code}\n\`\`\``;
        const { error: saveError } = await admin.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", content: finalText });
        if (saveError) throw new Error("The workflow completed, but its result could not be saved.");
        emit("delta", { text: finalText });
        emit("done", { remaining: Math.max(0, 30 - Number(quota ?? 0)), status: passed === results.length ? "passed" : "needs-review" });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "The agent workflow could not finish.";
        emit("error", { message }); controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}

async function runTests(code: string, tests: TestCase[]): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const test of tests) {
    const execution = await python(code, test.stdin);
    results.push({ ...test, received: execution.stdout, error: execution.error, passed: execution.ok && execution.stdout === test.expected.trim() });
  }
  return results;
}
