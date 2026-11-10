import { createClient } from "@/lib/supabase/server";
import { hasValidSameOrigin } from "@/lib/http";
import { NextResponse } from "next/server";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasValidSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data: conversation, error: findError } = await supabase.from("conversations").select("id").eq("id", id).single();
  if (findError || !conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not delete the conversation." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
