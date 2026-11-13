import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | CodeAssist",
  description: "How CodeAssist handles account information, conversations, and AI requests.",
};

export default function PrivacyPolicyPage() {
  return <main className="legal-page"><article className="legal-card">
    <Link className="legal-brand" href="/">CodeAssist</Link>
    <p className="legal-eyebrow">POLICY · LAST UPDATED NOVEMBER 13, 2026</p>
    <h1>Privacy Policy</h1>
    <p className="legal-lead">This policy explains what CodeAssist processes when you use its coding workspace.</p>
    <h2>Information we process</h2>
    <p>When you create an account, Supabase Auth processes your email address and authentication information. CodeAssist stores your conversations and messages in its Supabase database so you can return to them later.</p>
    <h2>AI requests</h2>
    <p>When you submit a prompt, the prompt and relevant recent conversation context are sent to Google Gemini to generate a response. If Gemini reports an exhausted quota or rate limit and a fallback is configured, the request may be sent to Groq instead. The selected provider processes that content under its own privacy terms. Do not include passwords, API keys, or other secrets in prompts.</p>
    <h2>How information is used</h2>
    <p>We use account information to authenticate you and protect your account. Conversation data is used to provide the workspace, display saved chats, and provide context for responses. CodeAssist does not sell personal information.</p>
    <h2>Storage and security</h2>
    <p>Account and conversation data are hosted by Supabase. Access controls are intended to restrict saved conversations to their owner. No internet service can guarantee absolute security, so avoid storing sensitive credentials or confidential code in chats.</p>
    <h2>Retention and deletion</h2>
    <p>Conversations remain associated with your account until you delete them or the service removes them. To request account or data deletion, contact the service operator using the email below.</p>
    <h2>Third-party services and changes</h2>
    <p>CodeAssist relies on Supabase for authentication and storage, and Google Gemini or Groq for AI responses. Their processing is also governed by their respective policies. This policy may be updated as the service changes; the date above indicates the latest revision.</p>
    <h2>Contact</h2>
    <p>Questions or deletion requests: <a href="mailto:sagarmidha656@gmail.com">sagarmidha656@gmail.com</a>.</p>
    <p className="legal-footer"><Link href="/terms">Terms of Service</Link><span>·</span><Link href="/login">Sign in</Link></p>
  </article></main>;
}
