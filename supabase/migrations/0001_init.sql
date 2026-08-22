-- vaultline schema
-- Run this in the Supabase SQL editor, or with: npx supabase db push

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('vaultline-files', 'vaultline-files', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- File metadata, written only by the Edge Function
-- ---------------------------------------------------------------------------
create table if not exists public.file_records (
    id           uuid primary key default gen_random_uuid(),
    bucket       text        not null,
    object_path  text        not null unique,
    file_name    text        not null,
    mime_type    text        not null,
    size_bytes   bigint      not null check (size_bytes >= 0),
    checksum     text        not null,
    category     text        not null,
    owner        text        not null default 'anonymous',
    tags         text[]      not null default '{}',
    validated    boolean     not null default false,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists file_records_owner_idx      on public.file_records (owner);
create index if not exists file_records_created_at_idx on public.file_records (created_at desc);
create index if not exists file_records_category_idx   on public.file_records (category);

-- ---------------------------------------------------------------------------
-- Plain table CRUD target, no storage involved
-- ---------------------------------------------------------------------------
create table if not exists public.notes (
    id         uuid primary key default gen_random_uuid(),
    title      text        not null check (char_length(title) between 1 and 200),
    body       text        not null default '',
    pinned     boolean     not null default false,
    owner      text        not null default 'anonymous',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists notes_owner_idx      on public.notes (owner);
create index if not exists notes_created_at_idx on public.notes (created_at desc);

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists file_records_touch on public.file_records;
create trigger file_records_touch
    before update on public.file_records
    for each row execute function public.touch_updated_at();

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch
    before update on public.notes
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- The terminal app and the Edge Function both use the service role key, which
-- bypasses RLS. These tables stay locked to everyone else until real auth is
-- wired up, so an anon key cannot read or write them.
-- ---------------------------------------------------------------------------
alter table public.file_records enable row level security;
alter table public.notes        enable row level security;
