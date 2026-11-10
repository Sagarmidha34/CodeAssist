import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data, error } = await supabase.from("messages").select("id,role,content,created_at").eq("conversation_id", id).order("created_at", { ascending: true }).limit(500);
  if (error) return NextResponse.json({ error: "Could not load this conversation." }, { status: 404 });
  return NextResponse.json({ messages: data }, { headers: { "Cache-Control": "private, no-store" } });
}
