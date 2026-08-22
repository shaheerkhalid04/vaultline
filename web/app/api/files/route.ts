import { NextRequest, NextResponse } from "next/server";

import { admin, config, invokeEdge, toErrorResponse } from "@/lib/supabase";
import type { FileRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

function objectPath(owner: string, fileName: string): string {
  const stamp = Math.random().toString(16).slice(2, 10);
  return `${slugify(owner)}/${stamp}-${slugify(fileName)}`;
}

export async function GET(request: NextRequest) {
  try {
    const { filesTable } = config();
    const params = request.nextUrl.searchParams;

    let query = admin().from(filesTable).select("*");

    const search = params.get("search");
    const owner = params.get("owner");
    const category = params.get("category");

    if (search) query = query.ilike("file_name", `%${search}%`);
    if (owner) query = query.eq("owner", owner);
    if (category) query = query.eq("category", category);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(Number(params.get("limit") ?? 200));

    if (error) throw new Error(error.message);

    return NextResponse.json({ files: (data ?? []) as FileRecord[] });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/**
 * Create. The bytes go to storage first, then the Edge Function decides whether
 * they are allowed to stay and writes the metadata row itself.
 */
export async function POST(request: NextRequest) {
  try {
    const { bucket, maxMb } = config();
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "no file supplied", code: "missing_file" },
        { status: 400 },
      );
    }

    // Cheap client side guard. The real check still happens in the function.
    if (file.size > maxMb * 1024 * 1024) {
      return NextResponse.json(
        {
          error: `${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the ${maxMb} MB limit`,
          code: "too_large",
        },
        { status: 413 },
      );
    }

    const owner = String(form.get("owner") || "anonymous");
    const tags = String(form.get("tags") || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const target = objectPath(owner, file.name);
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin()
      .storage.from(bucket)
      .upload(target, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) throw new Error(uploadError.message);

    const { record } = await invokeEdge<FileRecord>({
      action: "register",
      bucket,
      object_path: target,
      file_name: file.name,
      owner,
      tags,
    });

    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
