# CodeAssist

CodeAssist is an authenticated coding workspace using Supabase for accounts and saved conversations, and Google Gemini for model responses. The original offline prototype is preserved in [`legacy-demo/`](legacy-demo/).

## What is implemented

- Email/password signup, sign-in, confirmation, password reset, and sign-out through Supabase Auth.
- A responsive chat UI with saved history, search, streaming Markdown/code responses, copy, and delete.
- User-owned conversations and messages in Supabase Postgres, protected by row-level security.
- Gemini API calls made server-side. The browser never receives provider keys.
- Optional Groq fallback for chat and agent requests when Gemini returns an exhausted quota or rate-limit response. This is a separate provider with its own account, pricing, and usage limits; it does not bypass either provider's limits.
- Chat history is stored in Supabase and sent as recent context with each model request; CodeAssist does not create a separate provider-side conversation object.
- An Agents mode with Requirement, Coding, Testing, and Review roles. It asks the Testing Agent for up to five Python tests, runs them through a restricted subprocess, and allows at most one repair attempt. On Vercel, execution uses a private Python Function; locally, it uses the installed Python 3 interpreter.
- Request size limits, 8,000-character task limit, 30 requests per user per day, 100 requests across the app per day, and basic same-origin protections.

The default model is `gemini-3-flash-preview`. Gemini API free-tier model access and request quotas vary and can change. Check the current [Gemini API pricing and free-tier details](https://ai.google.dev/gemini-api/docs/pricing). Google indicates free-tier content may be used to improve its products; do not send secrets or sensitive code unless that data handling is acceptable for your project.

Google Antigravity is a separate coding environment. It can authenticate with a Gemini API key, but it does not provide a separate Antigravity model key for this app. The Kuro products found during research focus on image, video, voice, and music generation rather than the text coding API this app needs.

CodeAssist uses Gemini for chat and agents by default. If Gemini returns HTTP 429 for a quota or rate limit and a Groq key is configured, that request is retried through Groq. Groq's Chat Completions endpoint supports the OpenAI-compatible message format used for this fallback, and its structured output support is documented for selected models such as the default `openai/gpt-oss-20b` ([API compatibility](https://console.groq.com/docs/openai), [structured outputs](https://console.groq.com/docs/structured-outputs)). The fallback supports streamed chat and structured agent responses. Provider limits still apply independently; check Groq's current [rate limits](https://console.groq.com/docs/rate-limits) before enabling it.

The Python runner is restricted and resource-limited, but shares the app container. It is not equivalent to a hardened per-run sandbox. Keep public signup limited until stronger isolation, abuse monitoring, privacy/terms pages, and a support path are in place. Team spaces and billing are not included.

## Run locally

Requires Node.js 20.9+, Python 3.11+, and npm.

1. Create a Supabase project. In its SQL Editor, run [`supabase/migrations/202611100001_codeassist.sql`](supabase/migrations/202611100001_codeassist.sql). If you already ran this migration for the earlier version, no additional schema migration is required for the Gemini switch.
2. Copy `.env.example` to `.env.local` if it does not already exist. Set the Supabase URL, publishable key, and server secret key. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY`. To enable provider fallback, create a Groq API key in [Groq Console](https://console.groq.com/keys) and set `GROQ_API_KEY`. Keep both keys server-side.
3. In Supabase Auth, enable email/password sign-in. For local development, set `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000` and allow local redirects `http://localhost:3000/auth/confirm`, `http://localhost:3000/auth/reset`, `http://127.0.0.1:3000/auth/confirm`, and `http://127.0.0.1:3000/auth/reset`. Use a real SMTP provider before enabling production signup or reset emails.
4. To enable **Continue with Google**, create a Google OAuth client for a Web application in Google Cloud Console. Add the app origins (`http://127.0.0.1:3000` for this local server, plus your production origin) as Authorized JavaScript origins. Add the Supabase project's displayed Auth callback URL (usually `https://<project-ref>.supabase.co/auth/v1/callback`) as an Authorized redirect URI in Google. Copy the Google client ID and secret into Supabase Dashboard → Authentication → Sign In / Providers → Google, then enable the provider. In Supabase URL Configuration, allow `http://127.0.0.1:3000/auth/confirm` and the production equivalent. Google OAuth will not work until these dashboard settings are completed. See Supabase's [Google sign-in setup](https://supabase.com/docs/guides/auth/social-login/auth-google) and [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls).
5. Install and start the app:

   ```bash
   npm install
   npm run dev
   ```

6. Open <http://127.0.0.1:3000>.

The local environment file is ignored by Git. After changing it, restart the local server if the app does not pick up the changes.

### Deploy to Vercel

1. Push the repository to GitHub and import it into Vercel as a Next.js project with the repository root as the Root Directory.
2. Add the required Supabase and Gemini environment variables listed above to Vercel. `SUPABASE_SERVICE_ROLE_KEY` is used only server-side and also authenticates the private Python runner request; do not expose it with a `NEXT_PUBLIC_` name.
3. Vercel detects `api/python_runner.py` as a Python Function and uses Python 3.12 from `.python-version`. The Next.js agent route calls this function server-to-server; the Python function rejects requests without the server secret. No Python binary install step or extra API key is needed in Vercel.
4. Deploy, then run an Agents task and confirm the Test results table contains actual outputs rather than “Python is not installed.” Check the Vercel function logs if the runner reports a configuration or invocation error.

### Environment variables

| Variable | Use | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project endpoint | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser/server Supabase client; RLS remains required | No |
| `NEXT_PUBLIC_SITE_URL` | Canonical app origin used for auth callbacks (for example `https://your-production-domain.vercel.app`) | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database writes and private operations | **Yes** |
| `GEMINI_API_KEY` | Server-only Gemini API requests | **Yes** |
| `GEMINI_MODEL` | Gemini model name; defaults to `gemini-3-flash-preview` | No |
| `GROQ_API_KEY` | Optional server-only fallback used only when Gemini returns HTTP 429 | **Yes** |
| `GROQ_MODEL` | Optional Groq chat model; defaults to `openai/gpt-oss-20b` | No |

Do not commit `.env.local`, expose either secret in a `NEXT_PUBLIC_` variable, or send a key in chat. Gemini API billing and quotas are controlled in Google AI Studio/Google Cloud, not in ChatGPT.

## Database and access model

The SQL migration creates conversations, messages, private usage counters, and RLS policies. Conversation history remains in Supabase; authenticated users can only access their own rows. Server routes validate ownership before privileged writes. The earlier migration also creates a private `conversation_provider_refs` table; the Gemini implementation does not use it.

## Deploy to Render

The repository includes a Dockerfile and `render.yaml` Blueprint.

1. Push the project to a private GitHub repository and connect it to Render.
2. Create a Render Blueprint. Provide Supabase values and `GEMINI_API_KEY` when prompted. Add `GROQ_API_KEY` as an optional server environment variable if you want the fallback enabled.
3. Run the SQL migration in Supabase if it has not already been applied.
4. Set `NEXT_PUBLIC_SITE_URL` in Vercel's Production environment to the stable production domain (not a per-deployment URL), then redeploy. In Supabase Auth → URL Configuration, set Site URL to that same domain and add its `/auth/confirm` and `/auth/reset` URLs to Redirect URLs. If your confirmation email template has a custom link built from `{{ .SiteURL }}`, change it to use `{{ .RedirectTo }}` so it honors the callback requested by the app. Keep local and preview URLs in the allowlist only if you intend to use them.
5. Configure production SMTP. Review Google Gemini free-tier data handling and quotas, and keep public signup limited until the runner is isolated and abuse controls are added.
6. Deploy and verify signup, confirmation, password reset, streamed chat, agent workflow, test execution, one-repair limit, deletion, per-user isolation, and quota behavior.

This local workspace is not connected to GitHub or Render, so deployment still requires those accounts and a repository. Keep all API keys in the hosting provider's secret settings.

## Architecture

```text
Browser UI (Next.js / React)
    │ Supabase cookie session
    ▼
Next.js route handlers ─────── Google Gemini API
    │                           (server-only key)
    ├── Agent controller
    │     Requirement → Coding → Testing → Review
    │                              │ at most one repair
    └── Restricted Python subprocess
    ▼
Supabase Auth + Postgres (RLS by authenticated owner)
    └── conversations, messages, and usage quotas
```

The synopsis uses the **CodeAssist** name; an older abstract also says **CodeCrew**. This implementation consistently uses CodeAssist.
