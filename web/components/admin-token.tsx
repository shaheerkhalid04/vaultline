"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";

import { getAdminToken, setAdminToken } from "@/lib/admin-token";

/** Owner-only field: uploads, edits and deletes need ADMIN_TOKEN. Reads do not. */
export function AdminToken() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <details
      className="mb-5 rounded-xl border border-border bg-surface px-4 py-3 text-sm"
      // Read the stored token only when opened, so server and client render the same markup.
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open && !value) setValue(getAdminToken());
      }}
    >
      <summary className="flex cursor-pointer items-center gap-2 text-muted">
        <KeyRound className="size-4" aria-hidden="true" />
        Admin token, needed to upload, edit or delete
      </summary>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setAdminToken(value.trim());
          setSaved(true);
        }}
      >
        <input
          type="password"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          placeholder="Paste ADMIN_TOKEN"
          autoComplete="off"
          aria-label="Admin token"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-lg border border-border bg-surface px-3 py-2 hover:border-border-strong"
        >
          Save
        </button>
        {saved ? <span className="text-faint">Saved in this browser only.</span> : null}
      </form>
    </details>
  );
}
