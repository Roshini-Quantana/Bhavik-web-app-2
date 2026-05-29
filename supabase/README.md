# Supabase setup

Persistence backend for Bhavik cold calls: leads, scrape cache, sessions, turn transcripts, and audio recordings.

## 1. Environment variables

Add these to `.env.local`:

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key from Project Settings → API>
# Optional, defaults to "call-audio"
# SUPABASE_AUDIO_BUCKET=call-audio
```

The **service-role** key is server-only — never expose it to the browser. All Supabase writes happen inside Next.js API routes.

If these env vars are missing, the app continues to work but skips persistence (no DB writes, no audio uploads). This makes the integration safe to deploy incrementally.

## 2. Run the schema migration

Open `https://app.supabase.com/project/_/sql/new` and paste the contents of `supabase/migrations/0001_init.sql`. Run it once. It creates:

| Table            | Purpose                                              |
|------------------|------------------------------------------------------|
| `leads`          | One row per target URL. Tracks status, call count.   |
| `company_cache`  | Scrape results keyed by URL, 14-day TTL.             |
| `call_sessions`  | One row per call (sarvam or ultravox).               |
| `call_turns`     | One row per user/agent utterance with audio pointer. |

Plus a `mark_lead_called(uuid)` RPC and the private `call-audio` Storage bucket.

## 3. Verify

After running the migration:

1. Start a call from the UI (`npm run dev`).
2. In the Supabase dashboard:
   - **Table editor → leads** — should show one row for the target URL.
   - **Table editor → call_sessions** — should show one `active` row that flips to `ended` when you hang up, with `duration_seconds` populated.
   - **Table editor → call_turns** — one row per turn, ordered by `turn_index`.
   - **Storage → call-audio** — `<session-uuid>/0000-agent.wav`, `0001-user.webm`, `0002-agent.wav`, …

## 4. Querying

Recent calls with first turn:

```sql
select
  s.id,
  s.url,
  s.company_name,
  s.started_at,
  s.duration_seconds,
  s.status,
  (select text from call_turns where session_id = s.id order by turn_index limit 1) as opener
from call_sessions s
order by s.started_at desc
limit 20;
```

Full transcript of a session:

```sql
select turn_index, speaker, text, audio_path
from call_turns
where session_id = '<uuid>'
order by turn_index;
```

Signed download URL for an audio file (valid 1h):

```sql
select * from storage.create_signed_url('call-audio', '<session-uuid>/0000-agent.wav', 3600);
```

## 5. Schema notes

- `leads.url` is `UNIQUE` — the URL is the natural key. Repeat dials upsert.
- `company_cache.ttl_at` is 14 days from scrape. `getCachedCompany` filters expired rows automatically.
- `call_turns.turn_index` is monotonic per session — opener is 0, then alternating user/agent.
- `call_sessions.status` lifecycle: `active` → `ended` (or `error`).
- The `call-audio` bucket is **private**. Use `storage.create_signed_url` to share a clip.
