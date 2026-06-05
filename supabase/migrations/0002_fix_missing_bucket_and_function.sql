-- 0002_fix_missing_bucket_and_function.sql
-- Safe to run on top of any existing schema (all statements are idempotent).
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor.

-- 1. Storage bucket for call audio (private, server-side writes only).
--    The INSERT in 0001 can silently fail when run without superuser storage
--    access. This ensures the bucket exists.
insert into storage.buckets (id, name, public)
values ('call-audio', 'call-audio', false)
on conflict (id) do nothing;

-- 2. Atomic lead-called counter.
--    CREATE OR REPLACE is safe to run multiple times.
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
