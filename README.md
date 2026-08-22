# vaultline

A terminal CRUD app for Supabase Storage and Supabase tables, where every upload
is checked by a Deno Edge Function before any metadata row is written.

The point of the design is that the client never decides whether a file is
acceptable. Python moves bytes into Storage and then asks the Edge Function to
judge them. The function downloads the object with the service role key, checks
the real size, sniffs the magic bytes, derives metadata the client cannot be
trusted to supply, and only then writes the row. If the file fails, the function
deletes the object again, so Storage never keeps anything that has no matching
row.

```
python  ->  storage.upload()          bytes land in the bucket
python  ->  POST /functions/v1/validate-upload
            edge  ->  storage.download()      re-read what actually arrived
            edge  ->  size, magic bytes, sha256, category
            edge  ->  insert into file_records          (accepted)
            edge  ->  storage.remove()                  (rejected)
python  <-  { ok, record } or { ok: false, code, error }
```

## What is included

- `vaultline/files.py` create, read, update, delete over Storage objects plus
  their metadata rows, signed URLs, and checksum verified downloads
- `vaultline/notes.py` the same four operations against a plain Postgres table
- `supabase/functions/validate-upload/index.ts` the Edge Function
- `supabase/migrations/0001_init.sql` bucket, tables, triggers, RLS
- `vaultline/cli.py` the terminal interface
- `ui/streamlit_app.py` an optional UI over the same functions

## Setup

### 1. Create the Supabase project

1. Sign in at <https://app.supabase.com> and create a new project.
2. Open **Project Settings -> API** and copy the **Project URL** and the
   **service_role** key.
3. Open the **SQL Editor**, paste the contents of
   `supabase/migrations/0001_init.sql`, and run it. That creates the
   `vaultline-files` bucket, the `file_records` and `notes` tables, the
   `updated_at` triggers, and enables RLS.

The terminal app is an administrative tool, so it uses the service role key,
which bypasses RLS. Keep that key on your machine. It is never sent to a
browser, and `.env` is gitignored.

### 2. Configure the Python app

```bash
python -m venv .venv
```

```bash
.venv\Scripts\activate
```

```bash
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_KEY`.

Confirm the project answers:

```bash
python main.py health
```

### 3. Deploy the Edge Function

The Supabase CLI runs through `npx`, so no global install is needed. Deno is
downloaded by the CLI on first use.

Log in and link the local folder to your project. The project ref is the
subdomain in your project URL.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref your-project-ref
```

```bash
npx supabase functions deploy validate-upload
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the function
runtime automatically. The size limit is read from an optional secret:

```bash
npx supabase secrets set VAULTLINE_MAX_MB=10
```

### 4. Test the Edge Function

Serve it locally against your linked project and watch the logs while the CLI
calls it:

```bash
npx supabase functions serve validate-upload
```

With the local server running, point `VAULTLINE_EDGE_FUNCTION` at it or just
call it directly:

```bash
curl -X POST http://localhost:54321/functions/v1/validate-upload -H "Authorization: Bearer $SUPABASE_KEY" -H "Content-Type: application/json" -d "{\"bucket\":\"vaultline-files\",\"object_path\":\"anonymous/test.txt\"}"
```

Deployed logs:

```bash
npx supabase functions logs validate-upload
```

The clearest end to end test is the rejection path. `samples/fake.pdf` is a text
file wearing a `.pdf` name, so the function refuses it and cleans up the object:

```bash
python main.py file upload samples/fake.pdf
```

Expected output is `edge function rejected this (content_rejected)`, and nothing
appears in `file_records` or in the bucket.

## Usage

### Files

```bash
python main.py file upload samples/hello.txt --owner shaheer --tags demo,notes
```

```bash
python main.py file list
```

```bash
python main.py file get hello
```

```bash
python main.py file download hello --out downloads
```

```bash
python main.py file url hello --expires 600
```

Replace the stored object in place. The object path stays the same, the row is
updated rather than duplicated, and the function revalidates the new bytes:

```bash
python main.py file update hello --file samples/config.json
```

Metadata only edits skip the function, because no bytes changed:

```bash
python main.py file update hello --tags archive --owner rameen
```

```bash
python main.py file delete hello
```

Any command that takes a `reference` accepts a full id, the exact object path,
or a fragment of the file name, as long as the fragment matches one record.

### Notes, the plain table CRUD

```bash
python main.py note create "Reading list" --body "supabase storage docs" --pinned
```

```bash
python main.py note list
```

```bash
python main.py note get "Reading list"
```

```bash
python main.py note update "Reading list" --body "updated body" --unpin
```

```bash
python main.py note delete "Reading list"
```

### Optional UI

```bash
pip install -r requirements-ui.txt
```

```bash
streamlit run ui/streamlit_app.py
```

The UI calls the same `vaultline.files` and `vaultline.notes` functions, so
rejected uploads surface the same error codes from the Edge Function.

## What the Edge Function checks

| Check | Rejection code |
| --- | --- |
| Extension is on the allow list | `extension_not_allowed` |
| Object exists in the bucket | `object_missing` |
| File is not empty | `empty_file` |
| Real size is within the limit | `too_large` |
| Magic bytes agree with the extension | `content_rejected` |
| `.json` actually parses, text files decode as UTF-8 | `content_rejected` |
| Metadata row was written | `db_write_failed` |

Allowed extensions: `pdf`, `png`, `jpg`, `jpeg`, `gif`, `txt`, `md`, `csv`,
`json`, `log`, `docx`, `xlsx`, `pptx`, `zip`.

Metadata the function derives rather than trusting from the client: real
`size_bytes`, sniffed `mime_type`, a `category` bucket, and the `sha256`
checksum that `file download` verifies against.

## Notes on the free tier

Supabase pauses free projects after a week of inactivity, and paused projects
return errors on every call. If `python main.py health` starts failing, resume
the project from the dashboard. Data survives the pause.

## Web app

`web/` is a Next.js front end over the same flow, deployed on Vercel. The
browser never sees the service role key: the page calls route handlers under
`/api`, those run in the Node runtime, and only they talk to Supabase and to the
Edge Function.

| Route | Method | Does |
| --- | --- | --- |
| `/api/files` | GET | list metadata rows |
| `/api/files` | POST | upload to storage, then call the edge function |
| `/api/files/[id]` | GET | one record |
| `/api/files/[id]` | PATCH | JSON edits metadata, multipart replaces the object and revalidates |
| `/api/files/[id]` | DELETE | remove the object, then the row |
| `/api/files/[id]/url` | GET | short lived signed download URL |
| `/api/notes` | GET, POST | table CRUD |
| `/api/notes/[id]` | PATCH, DELETE | table CRUD |

Run it locally:

```bash
cd web && npm install
```

Copy `web/.env.example` to `web/.env.local`, fill in the same two values the CLI
uses, then:

```bash
cd web && npm run dev
```

### Deploying to Vercel

The Next.js app lives in a subdirectory, so the Vercel project needs its **Root
Directory** set to `web`. Environment variables to set on the project, all
without a `NEXT_PUBLIC_` prefix so they stay server side:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | the project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key |
| `VAULTLINE_BUCKET` | `vaultline-files` |
| `VAULTLINE_MAX_MB` | `10` |

Vercel request bodies are capped at 4.5 MB on the serverless runtime, so uploads
larger than that need a direct to storage signed upload rather than a POST
through the route handler. The 10 MB limit in the Edge Function still applies to
the CLI, which uploads straight to Supabase.

## GitHub integration

The repo is connected to the Supabase project, but connecting it does not by
itself deploy anything. Unless branching is enabled and configured, a push does
not run `supabase/migrations/` or deploy `supabase/functions/`. Treat the CLI as
the real deploy path:

```bash
npx supabase functions deploy validate-upload --project-ref your-project-ref
```

That command needs only `npx supabase login` first. It does not need `link`, and
it does not need Docker, since the CLI uploads the source and builds it server
side. The migration is the one piece the CLI cannot do without the database
password, so run it in the SQL editor, or link with the password and use
`npx supabase db push`.
