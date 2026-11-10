# CodeAssist

CodeAssist is an authenticated coding workspace using Supabase for accounts and saved conversations, and Google Gemini for model responses. The original offline prototype is preserved in [`legacy-demo/`](legacy-demo/).

## What is implemented

- Email/password signup, sign-in, confirmation, password reset, and sign-out through Supabase Auth.
- A responsive chat UI with saved history, search, streaming Markdown/code responses, copy, and delete.
- User-owned conversations and messages in Supabase Postgres, protected by row-level security.
- Gemini API calls made server-side. The browser never receives the Gemini key.
- Chat history is stored in Supabase and sent as recent context with each Gemini request; CodeAssist does not create a separate provider-side conversation object.
- An Agents mode with Requirement, Coding, Testing, and Review roles. It asks the Testing Agent for up to five Python tests, runs them through a restricted local subprocess, and allows at most one repair attempt.
- Request size limits, 8,000-character task limit, 30 requests per user per day, 100 requests across the app per day, and basic same-origin protections.

The default model is `gemini-3-flash-preview`. Gemini API free-tier model access and request quotas vary and can change. Check the current [Gemini API pricing and free-tier details](https://ai.google.dev/gemini-api/docs/pricing). Google indicates free-tier content may be used to improve its products; do not send secrets or sensitive code unless that data handling is acceptable for your project.

Google Antigravity is a separate coding environment. It can authenticate with a Gemini API key, but it does not provide a separate Antigravity model key for this app. The Kuro products found during research focus on image, video, voice, and music generation rather than the text coding API this app needs. CodeAssist currently supports Gemini for chat and agents.

The Python runner is restricted and resource-limited, but shares the app container. It is not equivalent to a hardened per-run sandbox. Keep public signup limited until stronger isolation, abuse monitoring, privacy/terms pages, and a support path are in place. Team spaces and billing are not included.

## Run locally

Requires Node.js 20.9+, Python 3.11+, and npm.

1. Create a Supabase project. In its SQL Editor, run [`supabase/migrations/202611100001_codeassist.sql`](supabase/migrations/202611100001_codeassist.sql). If you already ran this migration for the earlier version, no additional schema migration is required for the Gemini switch.
2. Copy `.env.example` to `.env.local` if it does not already exist. Set the Supabase URL, publishable key, and server secret key. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY`. Keep that key server-side.
3. In Supabase Auth, enable email/password sign-in. Allow local redirects `http://localhost:3000/auth/confirm`, `http://localhost:3000/auth/reset`, `http://127.0.0.1:3000/auth/confirm`, and `http://127.0.0.1:3000/auth/reset`. Use a real SMTP provider before enabling production signup or reset emails.
4. To enable **Continue with Google**, create a Google OAuth client for a Web application in Google Cloud Console. Add the app origins (`http://127.0.0.1:3000` for this local server, plus your production origin) as Authorized JavaScript origins. Add the Supabase project's displayed Auth callback URL (usually `https://<project-ref>.supabase.co/auth/v1/callback`) as an Authorized redirect URI in Google. Copy the Google client ID and secret into Supabase Dashboard → Authentication → Sign In / Providers → Google, then enable the provider. In Supabase URL Configuration, allow `http://127.0.0.1:3000/auth/confirm` and the production equivalent. Google OAuth will not work until these dashboard settings are completed. See Supabase's [Google sign-in setup](https://supabase.com/docs/guides/auth/social-login/auth-google) and [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls).
5. Install and start the app:

   ```bash
   npm install
   npm run dev
   ```

6. Open <http://127.0.0.1:3000>.

The local environment file is ignored by Git. After changing it, restart the local server if the app does not pick up the changes.

### Environment variables

| Variable | Use | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project endpoint | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser/server Supabase client; RLS remains required | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database writes and private operations | **Yes** |
| `GEMINI_API_KEY` | Server-only Gemini API requests | **Yes** |
| `GEMINI_MODEL` | Gemini model name; defaults to `gemini-3-flash-preview` | No |

Do not commit `.env.local`, expose either secret in a `NEXT_PUBLIC_` variable, or send a key in chat. Gemini API billing and quotas are controlled in Google AI Studio/Google Cloud, not in ChatGPT.

## Database and access model

The SQL migration creates conversations, messages, private usage counters, and RLS policies. Conversation history remains in Supabase; authenticated users can only access their own rows. Server routes validate ownership before privileged writes. The earlier migration also creates a private `conversation_provider_refs` table; the Gemini implementation does not use it.

## Deploy to Render

The repository includes a Dockerfile and `render.yaml` Blueprint.

1. Push the project to a private GitHub repository and connect it to Render.
2. Create a Render Blueprint. Provide Supabase values and `GEMINI_API_KEY` when prompted.
3. Run the SQL migration in Supabase if it has not already been applied.
4. Set Supabase Auth's production Site URL and confirmation/reset redirect allowlist to your deployed domain.
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
