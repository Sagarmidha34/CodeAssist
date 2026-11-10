"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Code2, LoaderCircle, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function PasswordReset({ code }: { code: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(code ? "" : "This reset link is incomplete or expired. Request a new one from the sign-in page.");
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    if (!code) return;
    createClient().auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setError("This reset link is no longer valid. Request a new one from the sign-in page.");
      else setReady(true);
    }).catch(() => setError("This reset link could not be verified."));
  }, [code]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) setError(error.message); else { setSuccess(true); setTimeout(() => { router.replace("/"); router.refresh(); }, 900); }
    setBusy(false);
  }
  return <main className="auth-page"><Link className="auth-brand" href="/"><span className="brand-mark"><Code2 size={20} /></span><span>codeassist</span></Link><section className="auth-card"><div className="auth-badge">SECURE ACCOUNT RECOVERY</div><h1>Choose a new password</h1><p className="auth-sub">Use at least 8 characters.</p>{ready && !success && <form className="auth-form" onSubmit={submit}><label>New password<div className="field-wrap"><LockKeyhole size={16} /><input type="password" autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></div></label><button className="auth-submit" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" /> Saving…</> : <>Update password <ArrowRight size={15} /></>}</button></form>}{error && <div className="form-alert error-alert">{error}</div>}{success && <div className="form-alert success-alert">Password updated. Taking you to your workspace…</div>}</section><div className="auth-bottom">CODEASSIST <span>·</span> A MULTI-AGENT AI CODING WORKSPACE</div></main>;
}
