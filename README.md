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

## GitHub integration

This repo is connected to the Supabase project, so the layout under `supabase/`
is what the integration expects. Pushing to the connected branch runs any new
file in `supabase/migrations/` against the database and deploys every function
in `supabase/functions/`, which means `npx supabase functions deploy` is only
needed when you want to push a change without a commit.
