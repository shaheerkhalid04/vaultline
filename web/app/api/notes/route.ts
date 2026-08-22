import { NextRequest, NextResponse } from "next/server";

import { admin, config, toErrorResponse } from "@/lib/supabase";
import type { Note } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { notesTable } = config();
    const search = request.nextUrl.searchParams.get("search");

    let query = admin().from(notesTable).select("*");
    if (search) query = query.ilike("title", `%${search}%`);

    const { data, error } = await query
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    return NextResponse.json({ notes: (data ?? []) as Note[] });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { notesTable } = config();
    const payload = await request.json();
    const title = String(payload.title ?? "").trim();

    if (!title) {
      return NextResponse.json({ error: "a title is required", code: "missing_title" }, { status: 400 });
    }

    const { data, error } = await admin()
      .from(notesTable)
      .insert({
        title,
        body: String(payload.body ?? ""),
        owner: String(payload.owner ?? "anonymous"),
        pinned: Boolean(payload.pinned),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ note: data as Note }, { status: 201 });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
