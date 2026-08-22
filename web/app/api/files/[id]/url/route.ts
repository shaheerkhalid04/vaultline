import { NextRequest, NextResponse } from "next/server";

import { admin, config, toErrorResponse } from "@/lib/supabase";
import type { FileRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hand the browser a short lived signed URL rather than proxying the bytes. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { bucket, filesTable } = config();
    const expires = Number(request.nextUrl.searchParams.get("expires") ?? 300);

    const { data: row, error: rowError } = await admin()
      .from(filesTable)
      .select("*")
      .eq("id", id)
      .single();

    if (rowError || !row) throw new Error("no file record matches that id");

    const record = row as FileRecord;
    const { data, error } = await admin()
      .storage.from(bucket)
      .createSignedUrl(record.object_path, expires, { download: record.file_name });

    if (error || !data) throw new Error(error?.message ?? "could not sign that object");

    return NextResponse.json({ url: data.signedUrl, expires_in: expires });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
