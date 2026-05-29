-- Bhavik AI cold-call: initial schema.
-- Run in Supabase SQL editor (or via supabase db push) once per project.

create extension if not exists "pgcrypto";

-- 1. Leads / contact metadata (one row per target URL).
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  url             text not null unique,
  company_name    text default '',
  summary         text default '',
  industry        text default '',
  services        text[] default '{}',
  status          text not null default 'new'
                    check (status in ('new','called','qualified','rejected','follow_up')),
  notes           text default '',
  first_called_at timestamptz,
  last_called_at  timestamptz,
  call_count      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists leads_status_idx       on public.leads (status);
create index if not exists leads_last_called_idx  on public.leads (last_called_at desc nulls last);

-- 2. Scrape cache — skip n8n + fetch + parse on repeat dials.
create table if not exists public.company_cache (
  url           text primary key,
  company_name  text default '',
  summary       text default '',
  industry      text default '',
  services      jsonb default '[]'::jsonb,
  source        text not null check (source in ('n8n','fallback','manual')),
  scraped_at    timestamptz not null default now(),
  ttl_at        timestamptz not null default (now() + interval '14 days')
);

create index if not exists company_cache_ttl_idx on public.company_cache (ttl_at);

-- 3. One row per call.
create table if not exists public.call_sessions (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references public.leads(id) on delete set null,
  url              text not null,
  language         text not null,
  persona          text not null,
  voice            text not null,
  provider         text not null check (provider in ('sarvam','ultravox')),
  company_name     text default '',
  summary          text default '',
  industry         text default '',
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds int,
  status           text not null default 'active'
                    check (status in ('active','ended','error')),
  error_message    text,
  created_at       timestamptz not null default now()
);

create index if not exists call_sessions_lead_idx    on public.call_sessions (lead_id);
create index if not exists call_sessions_started_idx on public.call_sessions (started_at desc);

-- 4. One row per turn (user or agent).
create table if not exists public.call_turns (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.call_sessions(id) on delete cascade,
  turn_index   int not null,
  speaker      text not null check (speaker in ('user','agent')),
  text         text default '',
  audio_path   text,
  audio_format text,
  duration_ms  int,
  created_at   timestamptz not null default now(),
  unique (session_id, turn_index)
);

create index if not exists call_turns_session_idx on public.call_turns (session_id, turn_index);

-- 5. Updated-at maintenance trigger.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- 6. Atomic lead-called counter (avoids read-modify-write races).
create or replace function public.mark_lead_called(p_lead_id uuid)
returns void as $$
begin
  update public.leads
     set call_count      = call_count + 1,
         first_called_at = coalesce(first_called_at, now()),
         last_called_at  = now(),
         status          = case when status = 'new' then 'called' else status end,
         updated_at      = now()
   where id = p_lead_id;
end;
$$ language plpgsql;

-- 7. Storage bucket for call audio (private, server-side writes only).
insert into storage.buckets (id, name, public)
values ('call-audio', 'call-audio', false)
on conflict (id) do nothing;
