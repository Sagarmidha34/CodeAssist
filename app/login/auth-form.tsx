"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Code2, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function getAuthRedirectBase() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured || window.location.origin).replace(/\/+$/, "");
}

export function AuthForm({ configured, confirmationError = false, initialMode = "signin" }: { configured: boolean; confirmationError?: boolean; initialMode?: "signin" | "signup" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(confirmationError ? "That confirmation link is no longer valid. Please sign in or create a new account." : "");

  useEffect(() => {
    if (!awaitingConfirmation) return;
    let checking = false;
    const checkForConfirmedSession = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const body = await response.json();
        if (body.authenticated) {
          setAwaitingConfirmation(false);
          router.replace("/");
          router.refresh();
        }
      } catch { /* retry until the email link establishes a session */ }
      finally { checking = false; }
    };
    void checkForConfirmedSession();
    const timer = window.setInterval(checkForConfirmedSession, 2500);
    return () => window.clearInterval(timer);
  }, [awaitingConfirmation, router]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Enter a valid email address.");
      if (mode === "signup") {
        if (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password)) throw new Error("Use at least 8 characters, including a letter and a number.");
        if (password !== confirmPassword) throw new Error("The passwords don’t match.");
      }
      const supabase = createClient();
      const redirectBase = getAuthRedirectBase();
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${redirectBase}/auth/reset` });
        if (error) throw error;
        setNotice("If an account exists for that email, a password reset link is on its way.");
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password, options: { emailRedirectTo: `${redirectBase}/auth/confirm` } });
        if (error) throw error;
        if (!data.session) {
          setAwaitingConfirmation(true);
          setNotice("Check your email and open the confirmation link. This tab will continue to CodeAssist after your email is verified.");
          setPassword(""); setConfirmPassword("");
        }
        else { router.replace("/"); router.refresh(); }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) throw error;
        router.replace("/"); router.refresh();
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not complete sign in."); }
    finally { setBusy(false); }
  }

  async function signInWithGoogle() {
    setBusy(true); setError(""); setNotice("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${getAuthRedirectBase()}/auth/confirm` },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <div className="auth-glow" />
    <Link className="auth-brand" href="/"><span className="brand-mark"><Code2 size={20} /></span><span>codeassist</span></Link>
    <section className="auth-card">
      <div className="auth-badge"><span className="status-dot" /> YOUR AI CODING WORKSPACE</div>
      <h1>{mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}</h1>
      <p className="auth-sub">{mode === "signin" ? "Pick up where your ideas left off." : mode === "signup" ? "A calmer place to think through code." : "We’ll send a secure reset link to your email."}</p>
      {!configured ? <div className="setup-warning"><strong>Connect your app services</strong><p>Add the Supabase URL and publishable key in <code>.env.local</code>, then restart the app. Setup instructions are in the README.</p></div> : <>
        {mode !== "reset" && <>
          <button className="google-signin" type="button" onClick={signInWithGoogle} disabled={busy}>
            <svg aria-hidden="true" viewBox="0 0 48 48" width="16" height="16"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.38 37.98 46.98 31.88 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.2C6.51 42.62 14.62 48 24 48Z"/></svg>
            Continue with Google
          </button>
          <div className="oauth-divider"><span /> <span>OR CONTINUE WITH EMAIL</span> <span /></div>
        </>}
        <form className="auth-form" onSubmit={submit}>
          <label>Email address<div className="field-wrap"><Mail size={16} /><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" maxLength={254} required /></div></label>
          {mode !== "reset" && <>
            <label>Password<div className="field-wrap"><LockKeyhole size={16} /><input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signup" ? 8 : undefined} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} required /></div></label>
            {mode === "signup" && <>
              <p className="password-hint">Use 8+ characters with at least one letter and one number.</p>
              <label>Confirm password<div className="field-wrap"><LockKeyhole size={16} /><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Enter your password again" required /></div></label>
            </>}
          </>}
          {mode === "signin" && <button type="button" className="forgot-link" onClick={() => { setMode("reset"); setError(""); setNotice(""); }}>Forgot password?</button>}
          {error && <div className="form-alert error-alert" role="alert">{error}</div>}
          {notice && <div className="form-alert success-alert" role="status">{notice}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={17} className="spin" /> Working…</> : <>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}<ArrowRight size={16} /></>}</button>
        </form>
        {mode !== "reset" ? <p className="auth-switch">{mode === "signin" ? "New to CodeAssist?" : "Already have an account?"} <Link href={mode === "signin" ? "/signup" : "/login"}>{mode === "signin" ? "Create an account" : "Sign in"}</Link></p> : <p className="auth-switch"><button onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Back to sign in</button></p>}
      </>}
      <div className="auth-divider"><span /> <span>BUILT FOR THE WAY YOU THINK</span> <span /></div>
      <p className="auth-footnote">Your conversations are saved to your account. AI responses use the configured server-side provider.</p>
    </section>
    <div className="auth-bottom">CODEASSIST <span>·</span> A MULTI-AGENT AI CODING WORKSPACE</div>
  </main>;
}
