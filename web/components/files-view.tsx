"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  Braces,
  Copy,
  Download,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Inbox,
  Repeat2,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { useToast } from "./toast";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, SkeletonRow, cn } from "./ui";
import { REJECTION_HINTS, absoluteTime, humanSize, parseTags, relativeTime } from "@/lib/format";
import type { FileRecord } from "@/lib/types";

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  image: ImageIcon,
  document: FileText,
  data: Braces,
  text: AlignLeft,
  archive: FileArchive,
};

function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICONS[category] ?? FileText;
  return <Icon className={className} aria-hidden="true" />;
}

export function FilesView({
  files,
  loading,
  onChanged,
}: {
  files: FileRecord[];
  loading: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FileRecord | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter(
      (file) =>
        file.file_name.toLowerCase().includes(needle) ||
        file.owner.toLowerCase().includes(needle) ||
        (file.tags ?? []).some((tag) => tag.toLowerCase().includes(needle)),
    );
  }, [files, query]);

  // Keep the open drawer in step with refreshed data.
  const current = selected ? (files.find((file) => file.id === selected.id) ?? null) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="order-2 min-w-0 lg:order-1">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, owner, or tag"
            className="pl-9"
            aria-label="Filter files"
          />
        </div>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="divide-y divide-border">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-5" />}
              title={files.length ? "Nothing matches that filter" : "No files stored yet"}
              description={
                files.length
                  ? "Try a different name, owner, or tag."
                  : "Drop a file into the panel to send it through the edge function."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  onOpen={() => setSelected(file)}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <aside className="order-1 lg:order-2">
        <div className="lg:sticky lg:top-22">
          <UploadPanel onUploaded={onChanged} />
        </div>
      </aside>

      {current ? (
        <FileDrawer file={current} onClose={() => setSelected(null)} onChanged={onChanged} />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */
function FileRow({
  file,
  onOpen,
  onChanged,
}: {
  file: FileRecord;
  onOpen: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const download = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setBusy(true);
    try {
      const response = await fetch(`/api/files/${file.id}/url`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      window.location.href = body.url;
    } catch (error) {
      toast.error("Download failed", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm(`Delete ${file.file_name} and its metadata row?`)) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      toast.success("Deleted", `${file.file_name} and its row are gone.`);
      await onChanged();
    } catch (error) {
      toast.error("Delete failed", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className="group flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors duration-200 hover:bg-background"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted group-hover:border-border-strong">
          <CategoryIcon category={file.category} className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-medium">{file.file_name}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {humanSize(file.size_bytes)} · {file.owner} · {relativeTime(file.created_at)}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          {(file.tags ?? []).slice(0, 2).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
          {(file.tags ?? []).length > 2 ? <Badge>+{(file.tags ?? []).length - 2}</Badge> : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
          <IconButton label={`Download ${file.file_name}`} onClick={download} disabled={busy}>
            <Download className="size-4" />
          </IconButton>
          <IconButton
            label={`Delete ${file.file_name}`}
            onClick={remove}
            disabled={busy}
            className="hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Upload                                                                     */
/* -------------------------------------------------------------------------- */
function UploadPanel({ onUploaded }: { onUploaded: () => Promise<void> | void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [owner, setOwner] = useState("anonymous");
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const submit = async () => {
    if (!file) return;

    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("owner", owner || "anonymous");
    form.append("tags", tags);

    try {
      const response = await fetch("/api/files", { method: "POST", body: form });
      const body = await response.json();

      if (!response.ok) {
        toast.error(
          REJECTION_HINTS[body.code] ?? "The edge function rejected this file",
          `${body.code}: ${body.error}`,
        );
        return;
      }

      toast.success(
        "Accepted and registered",
        `${body.record.file_name} stored as ${body.record.mime_type}.`,
      );
      setFile(null);
      setTags("");
      if (inputRef.current) inputRef.current.value = "";
      await onUploaded();
    } catch (error) {
      toast.error("Upload failed", (error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="size-4 text-accent" />
        <h2 className="text-sm font-semibold">Upload</h2>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files?.[0];
          if (dropped) setFile(dropped);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors duration-200",
          dragging
            ? "border-accent bg-accent-soft"
            : "border-border-strong bg-background hover:border-accent",
        )}
      >
        <UploadCloud className={cn("size-5", dragging ? "text-accent" : "text-faint")} />
        {file ? (
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-medium">{file.name}</p>
            <p className="text-xs text-muted">{humanSize(file.size)}</p>
          </div>
        ) : (
          <div>
            <p className="text-[13px] font-medium">Drop a file, or click to browse</p>
            <p className="mt-0.5 text-xs text-faint">pdf, png, jpg, txt, md, csv, json, docx, zip</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>

      <div className="mt-4 space-y-3">
        <Field label="Owner">
          <Input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="anonymous" />
        </Field>
        <Field label="Tags" hint="Comma separated">
          <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="reports, q3" />
        </Field>

        <Button
          variant="primary"
          className="w-full"
          onClick={submit}
          disabled={!file}
          loading={uploading}
        >
          {uploading ? "Validating" : "Upload and validate"}
        </Button>
      </div>

      <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted">
        {[
          "Size and emptiness checked server side",
          "Magic bytes matched against the extension",
          "sha256, mime type and category derived",
          "Rejected files are removed from the bucket",
        ].map((line) => (
          <li key={line} className="flex gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
            {line}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail drawer                                                              */
/* -------------------------------------------------------------------------- */
function FileDrawer({
  file,
  onClose,
  onChanged,
}: {
  file: FileRecord;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const replaceRef = useRef<HTMLInputElement>(null);
  const [owner, setOwner] = useState(file.owner);
  const [tags, setTags] = useState((file.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);

  const saveMetadata = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, tags: parseTags(tags) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      toast.success("Metadata saved", "No bytes changed, so the function was not called.");
      await onChanged();
    } catch (error) {
      toast.error("Could not save", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const replace = async (replacement: File) => {
    setBusy(true);
    const form = new FormData();
    form.append("file", replacement);

    try {
      const response = await fetch(`/api/files/${file.id}`, { method: "PATCH", body: form });
      const body = await response.json();

      if (!response.ok) {
        toast.error(
          REJECTION_HINTS[body.code] ?? "The replacement was rejected",
          `${body.code}: ${body.error}`,
        );
        return;
      }

      toast.success("Replaced and revalidated", "Same object path, new checksum.");
      await onChanged();
    } catch (error) {
      toast.error("Replace failed", (error as Error).message);
    } finally {
      setBusy(false);
      if (replaceRef.current) replaceRef.current.value = "";
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${file.file_name} and its metadata row?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      toast.success("Deleted", `${file.file_name} and its row are gone.`);
      onClose();
      await onChanged();
    } catch (error) {
      toast.error("Delete failed", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${file.file_name}`}
        className="animate-slide-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface"
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted">
              <CategoryIcon category={file.category} className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-medium">{file.file_name}</p>
              <p className="text-xs text-muted">{file.mime_type}</p>
            </div>
          </div>
          <IconButton label="Close details" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap gap-1.5">
            {file.validated ? (
              <Badge tone="accent">
                <ShieldCheck className="size-3" />
                validated
              </Badge>
            ) : (
              <Badge tone="warning">unvalidated</Badge>
            )}
            <Badge>{file.category}</Badge>
            <Badge>{humanSize(file.size_bytes)}</Badge>
          </div>

          <dl className="space-y-2.5 text-[13px]">
            <Detail label="Record id" value={file.id} mono copyable />
            <Detail label="Object path" value={file.object_path} mono copyable />
            <Detail label="sha256" value={file.checksum} mono copyable truncate />
            <Detail label="Bucket" value={file.bucket} mono />
            <Detail label="Created" value={absoluteTime(file.created_at)} />
            <Detail label="Updated" value={absoluteTime(file.updated_at)} />
          </dl>

          <div className="space-y-3 border-t border-border pt-4">
            <Field label="Owner">
              <Input value={owner} onChange={(event) => setOwner(event.target.value)} />
            </Field>
            <Field label="Tags" hint="Comma separated">
              <Input value={tags} onChange={(event) => setTags(event.target.value)} />
            </Field>
            <Button variant="primary" size="sm" onClick={saveMetadata} loading={busy} className="w-full">
              Save metadata
            </Button>
          </div>

          <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
            <Button
              size="sm"
              onClick={async () => {
                const response = await fetch(`/api/files/${file.id}/url`);
                const body = await response.json();
                if (response.ok) window.location.href = body.url;
                else toast.error("Download failed", body.error);
              }}
            >
              <Download className="size-4" />
              Download
            </Button>

            <Button size="sm" onClick={() => replaceRef.current?.click()} disabled={busy}>
              <Repeat2 className="size-4" />
              Replace
            </Button>
            <input
              ref={replaceRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const replacement = event.target.files?.[0];
                if (replacement) void replace(replacement);
              }}
            />

            <Button variant="danger" size="sm" onClick={remove} disabled={busy} className="sm:col-span-2">
              <Trash2 className="size-4" />
              Delete file and row
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
  copyable = false,
  truncate = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  truncate?: boolean;
}) {
  const toast = useToast();

  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-xs text-faint">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        <span className={cn("min-w-0 text-right", mono && "font-mono text-xs", truncate && "truncate")}>
          {value}
        </span>
        {copyable ? (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(value);
              toast.info("Copied", label);
            }}
            aria-label={`Copy ${label}`}
            className="cursor-pointer rounded p-1 text-faint transition-colors hover:text-foreground"
          >
            <Copy className="size-3" />
          </button>
        ) : null}
      </dd>
    </div>
  );
}
