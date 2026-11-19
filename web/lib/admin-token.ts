"use client";

/** The owner's admin token, kept in this browser only and sent on every write. */
const KEY = "vaultline-admin-token";

export function getAdminToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the token simply is not remembered.
  }
}

/** fetch for write routes: adds the admin token header when one is saved. */
export function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAdminToken();
  if (token) headers.set("x-admin-token", token);
  return fetch(input, { ...init, headers });
}
