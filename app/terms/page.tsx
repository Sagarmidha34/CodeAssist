import Link from "next/link";

export const metadata = {
  title: "Terms of Service | CodeAssist",
  description: "Terms for using the CodeAssist coding workspace.",
};

export default function TermsPage() {
  return <main className="legal-page"><article className="legal-card">
    <Link className="legal-brand" href="/">CodeAssist</Link>
    <p className="legal-eyebrow">SERVICE TERMS · LAST UPDATED NOVEMBER 13, 2026</p>
    <h1>Terms of Service</h1>
    <p className="legal-lead">By using CodeAssist, you agree to these terms. If you do not agree, do not use the service.</p>
    <h2>Using CodeAssist</h2>
    <p>You must provide accurate account information, keep your sign-in credentials secure, and use the service lawfully. You are responsible for activity carried out through your account.</p>
    <h2>Your content</h2>
    <p>You retain your rights to prompts and code you submit. You authorize CodeAssist and its AI service providers to process that content only as needed to operate the workspace and generate requested responses.</p>
    <h2>AI-generated content</h2>
    <p>Responses and code may be incomplete, incorrect, insecure, or unsuitable for your situation. Review, test, and secure generated code before using it. You are responsible for deciding whether a response is appropriate for your use.</p>
    <h2>Acceptable use</h2>
    <p>Do not use CodeAssist to break the law, violate others’ rights, attempt unauthorized access, disrupt the service, or submit malicious code or content. Do not use generated output as a substitute for professional advice where qualified review is needed.</p>
    <h2>Availability and changes</h2>
    <p>CodeAssist is provided as an evolving service. Features, model availability, quotas, and limits may change, and the service may be unavailable at times. Third-party providers apply their own terms, policies, and usage limits.</p>
    <h2>Termination</h2>
    <p>You may stop using the service at any time. The service operator may suspend access for misuse or security reasons. You can request account deletion using the contact below.</p>
    <h2>Contact</h2>
    <p>Questions: <a href="mailto:sagarmidha656@gmail.com">sagarmidha656@gmail.com</a>.</p>
    <p className="legal-footer"><Link href="/privacy">Privacy Policy</Link><span>·</span><Link href="/login">Sign in</Link></p>
  </article></main>;
}
