import { redirect } from "next/navigation";
import { AuthForm } from "@/app/login/auth-form";
import { ChatWorkspace } from "@/app/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!configured) return <AuthForm configured={false} />;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  return <ChatWorkspace email={String(data.claims.email ?? "")} />;
}
