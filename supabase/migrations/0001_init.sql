-- COSMIC PREDICT initial schema: Supabase storage + observations table.
-- Run in the Supabase SQL editor (or `supabase db push` / `psql`).

-- ---------------------------------------------------------------------------
-- Observations table (metadata + provenance for each scraped SPHEREx image).
-- ---------------------------------------------------------------------------
create table if not exists public.observations (
    observation_id        text primary key,
    source_url            text,
    query_url             text,
    retrieved_at          timestamptz,
    epoch                 timestamptz,
    band                  text,
    ra                    double precision,
    dec                   double precision,
    header                jsonb,
    local_path            text,
    storage_path          text,
    preview_storage_path  text,
    asset_status          text not null default 'metadata_only',
    source                text not null default 'scraper',
    created_at            timestamptz not null default now()
);

create index if not exists observations_epoch_idx on public.observations (epoch);
create index if not exists observations_sky_idx on public.observations (ra, dec);

-- ---------------------------------------------------------------------------
-- Storage bucket for raw FITS files and parsed artifacts.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('spherex-images', 'spherex-images', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security. The backend uses the service-role key (bypasses RLS),
-- so no per-user policies are required for the MVP. Enable RLS on the table
-- so anonymous access is denied by default.
-- ---------------------------------------------------------------------------
alter table public.observations enable row level security;

create policy "observations are not public"
    on public.observations for all
    using (false) with check (false);
