// vaultline: validate-upload
//
// Called by the Python client immediately after an object lands in Storage.
// Everything here is deliberately server side: the client never decides whether
// a file is acceptable, and the client never writes the metadata row.
//
//   1. downloads the freshly uploaded object with the service role key
//   2. checks real size against the configured limit
//   3. sniffs magic bytes and compares them with the declared extension
//   4. derives metadata the client does not have: sha256, category, mime type
//   5. inserts or updates the file_records row
//   6. deletes the object again if it failed validation, so Storage never keeps
//      anything that has no matching row
//
// Deploy:  npx supabase functions deploy validate-upload
// Logs:    npx supabase functions logs validate-upload

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const MAX_MB = Number(Deno.env.get("VAULTLINE_MAX_MB") ?? "10");
const MAX_BYTES = MAX_MB * 1024 * 1024;
const FILES_TABLE = Deno.env.get("VAULTLINE_FILES_TABLE") ?? "file_records";

type Signature = { mime: string; category: string; bytes: number[]; offset?: number };

const SIGNATURES: Signature[] = [
  { mime: "application/pdf", category: "document", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: "image/png", category: "image", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", category: "image", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", category: "image", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "application/zip", category: "archive", bytes: [0x50, 0x4b, 0x03, 0x04] },
];

// Extensions with no useful magic bytes. Validated by decoding as UTF-8 instead.
const TEXT_TYPES: Record<string, { mime: string; category: string }> = {
  txt: { mime: "text/plain", category: "text" },
  md: { mime: "text/markdown", category: "text" },
  csv: { mime: "text/csv", category: "data" },
  json: { mime: "application/json", category: "data" },
  log: { mime: "text/plain", category: "text" },
};

// zip containers that are really office documents
const ZIP_ALIASES: Record<string, { mime: string; category: string }> = {
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    category: "document",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "document",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    category: "document",
  },
  zip: { mime: "application/zip", category: "archive" },
};

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  ...Object.keys(TEXT_TYPES),
  ...Object.keys(ZIP_ALIASES),
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reject(code: string, message: string, status = 400): Response {
  return json({ ok: false, code, error: message }, status);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function matches(head: Uint8Array, sig: Signature): boolean {
  const offset = sig.offset ?? 0;
  if (head.length < offset + sig.bytes.length) return false;
  return sig.bytes.every((b, i) => head[offset + i] === b);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function looksLikeText(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 4096));
    return true;
  } catch {
    return false;
  }
}

/** Decide the real type of the payload, or explain why it is not acceptable. */
function inspect(
  bytes: Uint8Array,
  extension: string,
): { mime: string; category: string } | { error: string } {
  const signature = SIGNATURES.find((sig) => matches(bytes, sig));

  if (signature) {
    if (signature.mime === "application/zip") {
      const alias = ZIP_ALIASES[extension];
      if (!alias) {
        return { error: "zip container uploaded with extension ." + extension };
      }
      return alias;
    }

    const jpegAlias = signature.mime === "image/jpeg" &&
      (extension === "jpg" || extension === "jpeg");
    const extensionAgrees = signature.mime.endsWith(extension) || jpegAlias;

    if (!extensionAgrees) {
      return {
        error: "content is " + signature.mime + " but the name claims ." + extension,
      };
    }
    return { mime: signature.mime, category: signature.category };
  }

  const asText = TEXT_TYPES[extension];
  if (asText) {
    if (!looksLikeText(bytes)) {
      return { error: "." + extension + " must be valid UTF-8 text" };
    }
    if (extension === "json") {
      try {
        JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return { error: "file is not parseable JSON" };
      }
    }
    return asText;
  }

  return { error: "unrecognised file contents" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return reject("method_not_allowed", "use POST", 405);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return reject("bad_json", "request body must be JSON");
  }

  const bucket = String(payload.bucket ?? "");
  const objectPath = String(payload.object_path ?? "");
  const owner = String(payload.owner ?? "anonymous");
  const action = String(payload.action ?? "register");
  const tags = Array.isArray(payload.tags) ? payload.tags.map(String) : [];
  const deleteOnReject = payload.delete_on_reject !== false;

  if (!bucket || !objectPath) {
    return reject("missing_fields", "bucket and object_path are required");
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const fileName = String(
    payload.file_name ?? objectPath.split("/").pop() ?? objectPath,
  );
  const extension = extensionOf(fileName);

  const discard = async () => {
    if (deleteOnReject) await admin.storage.from(bucket).remove([objectPath]);
  };

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    await discard();
    const allowed = [...ALLOWED_EXTENSIONS].sort().join(", ");
    return reject(
      "extension_not_allowed",
      "." + (extension || "(none)") + " is not on the allow list: " + allowed,
    );
  }

  const { data: blob, error: downloadError } = await admin.storage
    .from(bucket)
    .download(objectPath);

  if (downloadError || !blob) {
    return reject(
      "object_missing",
      downloadError?.message ?? "object not found in storage",
      404,
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (bytes.byteLength === 0) {
    await discard();
    return reject("empty_file", "uploaded object is empty");
  }

  if (bytes.byteLength > MAX_BYTES) {
    await discard();
    const actual = (bytes.byteLength / 1024 / 1024).toFixed(2);
    return reject(
      "too_large",
      actual + " MB exceeds the " + MAX_MB + " MB limit",
      413,
    );
  }

  const verdict = inspect(bytes, extension);
  if ("error" in verdict) {
    await discard();
    return reject("content_rejected", verdict.error);
  }

  const record = {
    bucket,
    object_path: objectPath,
    file_name: fileName,
    mime_type: verdict.mime,
    size_bytes: bytes.byteLength,
    checksum: await sha256(bytes),
    category: verdict.category,
    owner,
    tags,
    validated: true,
  };

  const query = action === "revalidate"
    ? admin.from(FILES_TABLE).update(record).eq("object_path", objectPath).select().single()
    : admin.from(FILES_TABLE).upsert(record, { onConflict: "object_path" }).select().single();

  const { data, error } = await query;

  if (error) {
    await discard();
    return reject("db_write_failed", error.message, 500);
  }

  return json({ ok: true, action, record: data });
});
