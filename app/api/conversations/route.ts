import { createClient } from "@/lib/supabase/server";
import { hasValidSameOrigin } from "@/lib/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data, error } = await supabase.from("conversations").select("id,title,updated_at").order("updated_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Could not load your conversations." }, { status: 500 });
  return NextResponse.json({ conversations: data }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data, error } = await supabase.from("conversations").insert({ user_id: user.id, title: "New conversation" }).select("id,title,updated_at").single();
  if (error) return NextResponse.json({ error: "Could not create a conversation." }, { status: 500 });
  return NextResponse.json({ conversation: data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
