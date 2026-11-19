import { NextRequest, NextResponse } from "next/server";

import { refuseUnlessAdmin } from "@/lib/admin";
import { admin, config, toErrorResponse } from "@/lib/supabase";
import type { Note } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const refused = refuseUnlessAdmin(request);
  if (refused) return refused;

  try {
    const { id } = await context.params;
    const { notesTable } = config();
    const payload = await request.json();

    const patch: Record<string, unknown> = {};
    if (typeof payload.title === "string") patch.title = payload.title.trim();
    if (typeof payload.body === "string") patch.body = payload.body;
    if (typeof payload.owner === "string") patch.owner = payload.owner;
    if (typeof payload.pinned === "boolean") patch.pinned = payload.pinned;

    if (patch.title === "") {
      return NextResponse.json({ error: "a title is required", code: "missing_title" }, { status: 400 });
    }

    const { data, error } = await admin()
      .from(notesTable)
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ note: data as Note });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const refused = refuseUnlessAdmin(request);
  if (refused) return refused;

  try {
    const { id } = await context.params;
    const { notesTable } = config();

    const { error } = await admin().from(notesTable).delete().eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ deleted: id });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
