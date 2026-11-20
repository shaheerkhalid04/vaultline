"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, HardDrive, Moon, ShieldCheck, StickyNote, Sun, TriangleAlert } from "lucide-react";

import { AdminToken } from "./admin-token";
import { FilesView } from "./files-view";
import { NotesView } from "./notes-view";
import { ToastProvider } from "./toast";
import { Card, cn } from "./ui";
import { humanSize } from "@/lib/format";
import type { FileRecord, Note } from "@/lib/types";

type Tab = "files" | "notes";

export function Dashboard() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [filesResponse, notesResponse] = await Promise.all([
        fetch("/api/files", { cache: "no-store" }),
        fetch("/api/notes", { cache: "no-store" }),
      ]);

      const filesBody = await filesResponse.json();
      const notesBody = await notesResponse.json();

      if (!filesResponse.ok) {
        setSetupError(filesBody.error ?? "could not reach Supabase");
        return;
      }

      setSetupError(null);
      setFiles(filesBody.files ?? []);
      setNotes(notesResponse.ok ? (notesBody.notes ?? []) : []);
    } catch (error) {
      setSetupError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const storageUsed = files.reduce((total, file) => total + file.size_bytes, 0);

  return (
    <div className="page-grain min-h-screen">
      <Header />

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <section className="grid grid-cols-2 gap-3 py-6 sm:grid-cols-4">
          <Stat icon={<FileText className="size-4" />} label="Files" value={String(files.length)} />
          <Stat
            icon={<HardDrive className="size-4" />}
            label="Stored"
            value={humanSize(storageUsed)}
          />
          <Stat icon={<StickyNote className="size-4" />} label="Notes" value={String(notes.length)} />
          <Stat
            icon={<ShieldCheck className="size-4" />}
            label="Validated"
            value={`${files.filter((file) => file.validated).length}/${files.length || 0}`}
          />
        </section>

        {setupError ? <SetupNotice message={setupError} /> : null}

        <AdminToken />

        <nav className="mb-5 inline-flex rounded-xl border border-border bg-surface p-1">
          <TabButton active={tab === "files"} onClick={() => setTab("files")}>
            Files
          </TabButton>
          <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>
            Notes
          </TabButton>
        </nav>

        {tab === "files" ? (
          <FilesView files={files} loading={loading} onChanged={refresh} />
        ) : (
          <NotesView notes={notes} loading={loading} onChanged={refresh} />
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-faint sm:px-6">
          <p>
            Uploads are checked by the{" "}
            <code className="font-mono text-muted">validate-upload</code> edge function before any
            metadata row is written.
          </p>
          <p>Supabase Storage plus Postgres. The same operations are available in the Python CLI.</p>
        </div>
      </footer>
    </div>
  );
}

function Header() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("vaultline-theme", next ? "dark" : "light");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Mark />
          <div className="leading-tight">
            <p className="font-mono text-[15px] font-semibold tracking-tight">vaultline</p>
            <p className="hidden text-[11px] text-faint sm:block">
              storage and table CRUD, validated at the edge
            </p>
          </div>
        </div>

        <button
          onClick={toggle}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-surface hover:text-foreground sm:size-9"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface">
      <svg viewBox="0 0 24 24" className="size-4.5 text-accent" aria-hidden="true" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 9h8M8 12.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="16" cy="15.5" r="1.4" fill="currentColor" />
      </svg>
    </span>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-2 text-faint">
        {icon}
        <span className="text-[11px] font-medium tracking-wide uppercase">{label}</span>
      </div>
      <p className="mt-1.5 font-mono text-xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200",
        active
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-background hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SetupNotice({ message }: { message: string }) {
  return (
    <Card className="mb-6 border-warning/40 p-5">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="space-y-2 text-sm">
          <p className="font-medium">Supabase is not answering yet</p>
          <p className="text-muted">{message}</p>
          <p className="text-muted">
            Set <code className="font-mono text-foreground">SUPABASE_URL</code> and{" "}
            <code className="font-mono text-foreground">SUPABASE_SERVICE_ROLE_KEY</code> in the
            project environment, run the migration, and reload. A paused free tier project causes
            the same symptom.
          </p>
        </div>
      </div>
    </Card>
  );
}
