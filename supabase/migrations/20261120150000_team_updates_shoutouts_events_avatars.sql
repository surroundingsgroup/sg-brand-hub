-- Team Hub expansion: updates feed, shoutouts, team events + meetings,
-- and the storage bucket for profile avatars.
--
-- Everything is team-wide-visible and team-wide-writable (any signed
-- in Surroundings Group email). We don't need per-row ownership RLS —
-- the full team is trusted, and deletes still log in the activity
-- table.

-- 1. Updates feed — pinable announcements.
create table if not exists public.team_updates (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'announcement'
    check (kind in ('announcement', 'policy', 'signature', 'new_hire', 'process', 'other')),
  title text not null,
  body text,
  pinned boolean not null default false,
  created_by_email text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_updates_pinned_at_idx
  on public.team_updates(pinned desc, created_at desc);

alter table public.team_updates enable row level security;
drop policy if exists "team_updates_all" on public.team_updates;
create policy "team_updates_all" on public.team_updates for all
  to authenticated using (true) with check (true);

-- 2. Shoutouts — short public kudos.
create table if not exists public.team_shoutouts (
  id uuid primary key default gen_random_uuid(),
  from_email text,
  from_name text,
  -- Nullable if it's a "team-wide" shoutout; otherwise names a teammate.
  to_name text,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists team_shoutouts_at_idx
  on public.team_shoutouts(created_at desc);

alter table public.team_shoutouts enable row level security;
drop policy if exists "team_shoutouts_all" on public.team_shoutouts;
create policy "team_shoutouts_all" on public.team_shoutouts for all
  to authenticated using (true) with check (true);

-- 3. Team events + meetings — one table with a kind column so both
--    "off-site in March" and "weekly AM standup Tues 10am" live
--    together and render in one chronological feed.
create table if not exists public.team_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'meeting'
    check (kind in ('meeting', 'all_hands', 'event', 'offsite', 'holiday', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  created_by_email text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_events_starts_idx
  on public.team_events(starts_at);

alter table public.team_events enable row level security;
drop policy if exists "team_events_all" on public.team_events;
create policy "team_events_all" on public.team_events for all
  to authenticated using (true) with check (true);

-- 4. updated_at triggers for the two editable-after-create tables.
create or replace function public.touch_team_rows_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists team_updates_touch on public.team_updates;
create trigger team_updates_touch before update on public.team_updates
  for each row execute function public.touch_team_rows_updated_at();

drop trigger if exists team_events_touch on public.team_events;
create trigger team_events_touch before update on public.team_events
  for each row execute function public.touch_team_rows_updated_at();

-- 5. Avatar storage bucket for team profiles. Public read so avatars
--    render everywhere without signed URLs; write is restricted to
--    the owner via a path convention: every file lives at
--    "<lowercase-email>/<something>". Policy checks the first path
--    segment against the JWT email.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-avatars',
  'team-avatars',
  true,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "team_avatars_public_read" on storage.objects;
create policy "team_avatars_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'team-avatars');

drop policy if exists "team_avatars_own_write" on storage.objects;
create policy "team_avatars_own_write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'team-avatars'
    and lower(split_part(name, '/', 1)) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "team_avatars_own_update" on storage.objects;
create policy "team_avatars_own_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'team-avatars'
    and lower(split_part(name, '/', 1)) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "team_avatars_own_delete" on storage.objects;
create policy "team_avatars_own_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'team-avatars'
    and lower(split_part(name, '/', 1)) = lower(auth.jwt() ->> 'email')
  );
