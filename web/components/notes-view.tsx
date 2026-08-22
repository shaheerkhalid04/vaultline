"use client";

import { useState } from "react";
import { Pin, PinOff, Plus, StickyNote, Trash2, X } from "lucide-react";

import { useToast } from "./toast";
import { Button, Card, EmptyState, Field, IconButton, Input, Textarea, cn } from "./ui";
import { relativeTime } from "@/lib/format";
import type { Note } from "@/lib/types";

export function NotesView({
  notes,
  loading,
  onChanged,
}: {
  notes: Note[];
  loading: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState<Note | "new" | null>(null);
  const current = editing && editing !== "new" ? (notes.find((n) => n.id === editing.id) ?? null) : null;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          The same four operations against a plain Postgres table, no storage involved.
        </p>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          New note
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Card key={key} className="h-36 animate-pulse" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<StickyNote className="size-5" />}
            title="No notes yet"
            description="Notes exercise table CRUD on its own, separate from the storage flow."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onOpen={() => setEditing(note)} onChanged={onChanged} />
          ))}
        </div>
      )}

      {editing ? (
        <NoteEditor
          note={editing === "new" ? null : current}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      ) : null}
    </>
  );
}

function NoteCard({
  note,
  onOpen,
  onChanged,
}: {
  note: Note;
  onOpen: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const togglePin = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setBusy(true);
    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !note.pinned }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      await onChanged();
    } catch (error) {
      toast.error("Could not update", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm(`Delete the note "${note.title}"?`)) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error);
      toast.success("Note deleted");
      await onChanged();
    } catch (error) {
      toast.error("Delete failed", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className={cn(
        "group flex cursor-pointer flex-col p-4 transition-colors duration-200 hover:border-border-strong",
        note.pinned && "border-accent/40",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter") onOpen();
        }}
        className="flex-1"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-semibold">{note.title}</h3>
          {note.pinned ? <Pin className="mt-0.5 size-3.5 shrink-0 text-accent" /> : null}
        </div>
        <p className="mt-2 line-clamp-4 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
          {note.body || "No body yet."}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="text-[11px] text-faint">
          {note.owner} · {relativeTime(note.updated_at)}
        </span>
        <div className="flex items-center gap-0.5 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
          <IconButton
            label={note.pinned ? "Unpin note" : "Pin note"}
            onClick={togglePin}
            disabled={busy}
            className="size-8"
          >
            {note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </IconButton>
          <IconButton
            label="Delete note"
            onClick={remove}
            disabled={busy}
            className="size-8 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </Card>
  );
}

function NoteEditor({
  note,
  onClose,
  onChanged,
}: {
  note: Note | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [owner, setOwner] = useState(note?.owner ?? "anonymous");
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) {
      toast.error("A title is required");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(note ? `/api/notes/${note.id}` : "/api/notes", {
        method: note ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, owner, pinned }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);

      toast.success(note ? "Note saved" : "Note created");
      onClose();
      await onChanged();
    } catch (error) {
      toast.error("Could not save", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={note ? "Edit note" : "New note"}
        className="animate-rise relative w-full max-w-lg rounded-t-2xl border border-border bg-surface p-5 shadow-[var(--shadow-lift)] sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{note ? "Edit note" : "New note"}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="space-y-3">
          <Field label="Title">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Reading list" autoFocus />
          </Field>
          <Field label="Body">
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              placeholder="supabase storage docs, edge function logs"
            />
          </Field>
          <Field label="Owner">
            <Input value={owner} onChange={(event) => setOwner(event.target.value)} />
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
              className="size-4 cursor-pointer accent-[var(--accent)]"
            />
            Pin to the top
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save} loading={busy}>
            {note ? "Save changes" : "Create note"}
          </Button>
        </div>
      </div>
    </div>
  );
}
