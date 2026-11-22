-- Hub-native meeting notes. Replaces the Meeting Cadence subitem
-- history that used to live on the per-client Monday board — Billy
-- wants the team off that board. Each row is one meeting (sync, QBR,
-- strategy call, etc.) with a raw-notes dump plus AI-generated
-- structured output (summary, action items, follow-up email draft).

create table if not exists public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,

  -- One of: 'monthly_external_sync' | 'internal_strategy_collab' |
  -- 'quarterly_business_review' | 'annual_audit' | 'other'
  -- Stored as free text so we can add types without a migration.
  meeting_type text not null,
  meeting_title text,
  meeting_date date not null default current_date,

  -- What the AM typed or spoke into the notes textarea before AI parse.
  raw_notes text,

  -- AI-structured output. All nullable until the analyzer has run at
  -- least once; after that, re-runs overwrite these fields. Users can
  -- also hand-edit them — the latest write wins.
  summary text,
  action_items_us jsonb default '[]'::jsonb,
  action_items_them jsonb default '[]'::jsonb,
  followup_email_subject text,
  followup_email_body text,
  next_meeting_focus text,
  analyzed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists meeting_notes_brand_date_idx
  on public.meeting_notes(brand_id, meeting_date desc);

alter table public.meeting_notes enable row level security;

-- Team-wide: anyone signed in with an @surroundingsgroup.com email can
-- read and write any meeting's notes. Matches how internal_notes +
-- brand_activity_log work today.
drop policy if exists "meeting_notes_team_read" on public.meeting_notes;
create policy "meeting_notes_team_read"
  on public.meeting_notes for select
  to authenticated
  using (true);

drop policy if exists "meeting_notes_team_insert" on public.meeting_notes;
create policy "meeting_notes_team_insert"
  on public.meeting_notes for insert
  to authenticated
  with check (true);

drop policy if exists "meeting_notes_team_update" on public.meeting_notes;
create policy "meeting_notes_team_update"
  on public.meeting_notes for update
  to authenticated
  using (true);

drop policy if exists "meeting_notes_team_delete" on public.meeting_notes;
create policy "meeting_notes_team_delete"
  on public.meeting_notes for delete
  to authenticated
  using (true);

-- Touch updated_at on every write.
create or replace function public.touch_meeting_notes_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists meeting_notes_touch on public.meeting_notes;
create trigger meeting_notes_touch
  before update on public.meeting_notes
  for each row execute function public.touch_meeting_notes_updated_at();
