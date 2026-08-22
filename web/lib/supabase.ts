import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server side only. The service role key never leaves the Node runtime, so the
 * browser talks to our route handlers and the route handlers talk to Supabase.
 */

export type VaultConfig = {
  url: string;
  key: string;
  bucket: string;
  filesTable: string;
  notesTable: string;
  edgeFunction: string;
  maxMb: number;
};

export class ConfigError extends Error {}

export class EdgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let cachedConfig: VaultConfig | null = null;
let cachedClient: SupabaseClient | null = null;

export function config(): VaultConfig {
  if (cachedConfig) return cachedConfig;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";

  const missing = [
    !url && "SUPABASE_URL",
    !key && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);

  if (missing.length) {
    throw new ConfigError(
      `Missing ${missing.join(", ")}. Set them in .env.local locally, or in the Vercel project settings.`,
    );
  }

  cachedConfig = {
    url: url.replace(/\/$/, ""),
    key,
    bucket: process.env.VAULTLINE_BUCKET ?? "vaultline-files",
    filesTable: process.env.VAULTLINE_FILES_TABLE ?? "file_records",
    notesTable: process.env.VAULTLINE_NOTES_TABLE ?? "notes",
    edgeFunction: process.env.VAULTLINE_EDGE_FUNCTION ?? "validate-upload",
    maxMb: Number(process.env.VAULTLINE_MAX_MB ?? "10"),
  };

  return cachedConfig;
}

export function admin(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const { url, key } = config();
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

/**
 * Call the deployed Edge Function and unwrap its envelope, so a rejection
 * arrives as a reason we can show rather than a bare status code.
 */
export async function invokeEdge<T = unknown>(
  payload: Record<string, unknown>,
): Promise<{ ok: true; record: T }> {
  const { url, key, edgeFunction } = config();

  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/${edgeFunction}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (error) {
    throw new EdgeError("network_error", (error as Error).message, 0);
  }

  const text = await response.text();
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(text);
  } catch {
    throw new EdgeError(
      "bad_response",
      `function returned a non-JSON body: ${text.slice(0, 200)}`,
      response.status,
    );
  }

  if (!body.ok) {
    throw new EdgeError(
      String(body.code ?? "unknown"),
      String(body.error ?? "edge function rejected the request"),
      response.status,
    );
  }

  return body as { ok: true; record: T };
}

/** Turn any thrown value into the shape every route handler answers with. */
export function toErrorResponse(error: unknown): { body: { error: string; code: string }; status: number } {
  if (error instanceof EdgeError) {
    return {
      body: { error: error.message, code: error.code },
      status: error.status && error.status >= 400 ? error.status : 400,
    };
  }
  if (error instanceof ConfigError) {
    return { body: { error: error.message, code: "config_error" }, status: 500 };
  }
  return {
    body: { error: (error as Error)?.message ?? "unexpected error", code: "server_error" },
    status: 500,
  };
}
