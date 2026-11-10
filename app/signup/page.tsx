import { AuthForm } from "@/app/login/auth-form";

export default function SignupPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return <AuthForm configured={configured} initialMode="signup" />;
}
