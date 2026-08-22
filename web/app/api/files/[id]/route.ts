import { NextRequest, NextResponse } from "next/server";

import { admin, config, invokeEdge, toErrorResponse } from "@/lib/supabase";
import type { FileRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadRecord(id: string): Promise<FileRecord> {
  const { filesTable } = config();
  const { data, error } = await admin().from(filesTable).select("*").eq("id", id).single();

  if (error || !data) throw new Error("no file record matches that id");
  return data as FileRecord;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ record: await loadRecord(id) });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/**
 * Update. A JSON body edits metadata only, because no bytes changed. A
 * multipart body replaces the object in place and sends it back through the
 * Edge Function, so the checksum, size and mime type are re-derived.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { bucket, filesTable } = config();
    const record = await loadRecord(id);
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");

      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "no replacement file supplied", code: "missing_file" },
          { status: 400 },
        );
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await admin()
        .storage.from(bucket)
        .upload(record.object_path, bytes, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        });

      if (uploadError) throw new Error(uploadError.message);

      const { record: updated } = await invokeEdge<FileRecord>({
        action: "revalidate",
        bucket,
        object_path: record.object_path,
        file_name: file.name,
        owner: record.owner,
        tags: record.tags ?? [],
      });

      return NextResponse.json({ record: updated });
    }

    const payload = (await request.json()) as Partial<FileRecord>;
    const patch: Record<string, unknown> = {};

    if (typeof payload.owner === "string") patch.owner = payload.owner;
    if (typeof payload.file_name === "string") patch.file_name = payload.file_name;
    if (Array.isArray(payload.tags)) patch.tags = payload.tags.map(String);

    if (!Object.keys(patch).length) {
      return NextResponse.json({ record });
    }

    const { data, error } = await admin()
      .from(filesTable)
      .update(patch)
      .eq("id", record.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ record: data as FileRecord });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** Delete the object before the row, so no row can outlive its bytes. */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { bucket, filesTable } = config();
    const record = await loadRecord(id);

    const { error: removeError } = await admin()
      .storage.from(bucket)
      .remove([record.object_path]);

    if (removeError) throw new Error(removeError.message);

    const { error } = await admin().from(filesTable).delete().eq("id", record.id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ deleted: record.id });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
