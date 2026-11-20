import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Every write (upload, replace, edit, delete, notes) runs with the service role
 * key, so it must not be open to whoever finds the URL. Writes need the owner's
 * ADMIN_TOKEN, sent as `x-admin-token` or `Authorization: Bearer`. With no
 * ADMIN_TOKEN set, writes are refused outright. Reads stay public.
 *
 * Returns the response to send when the caller is refused, or null to proceed.
 */
export function refuseUnlessAdmin(request: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "writes are disabled until ADMIN_TOKEN is set", code: "writes_disabled" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const given =
    request.headers.get("x-admin-token")?.trim() ||
    (header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "");

  if (given && sameToken(given, expected)) return null;

  return NextResponse.json(
    { error: "this action needs the admin token", code: "unauthorised" },
    { status: 401 },
  );
}

function sameToken(given: string, expected: string): boolean {
  // Hash both sides so the comparison is constant time whatever the lengths.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
