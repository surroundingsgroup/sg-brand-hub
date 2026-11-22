-- Team Directory — one row per SG team member, keyed by email.
-- Monday is the canonical roster (names + emails flow from there), but
-- everything an individual wants to tell their teammates lives here
-- and is editable by them. No Monday mirror needed.

create table if not exists public.team_profiles (
  id uuid primary key default gen_random_uuid(),
  -- Lowercase email. Unique. We don't FK to auth.users because the
  -- team includes people who haven't signed in yet; the join is done
  -- by email on display.
  email text not null unique,

  -- Display name — seeded from Monday on first write. Editable (people
  -- may want "Billy" vs. their legal name).
  name text,

  -- Everything below is self-serve profile metadata.
  title text,           -- "Founder & CEO", "Social Media Manager", etc.
  department text,      -- "Account Management", "Creative", "Operations", ...
  employment_type text  -- 'full_time' | 'contractor' | 'part_time' | 'other'
    check (
      employment_type is null or employment_type in
        ('full_time', 'contractor', 'part_time', 'other')
    ),

  phone text,
  pronouns text,
  slack_handle text,
  time_zone text,       -- "ET", "CT", "America/Chicago", whatever they type
  location text,        -- "Tampa, FL" etc.

  -- Dates — YYYY-MM-DD. Birthday has no year (people can leave the
  -- year as any value; we display month/day only). Start date carries
  -- the year so we can calculate work anniversaries.
  birthday date,
  start_date date,

  bio text,             -- short 1–2 sentence intro
  fun_fact text,        -- optional lighter line
  skills text[],        -- "video editing", "Monday automation", ...

  avatar_url text,      -- optional photo

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_profiles_name_idx on public.team_profiles(name);
-- Note: we used to index to_char(date, 'MM-DD') for birthday/anniversary
-- lookups, but to_char(date, text) isn't marked IMMUTABLE in stock
-- Postgres so it can't live in an index expression. Table is tiny
-- (<50 rows for the foreseeable future), so a full scan on the
-- upcoming-birthdays query is fine.

alter table public.team_profiles enable row level security;

-- Any signed-in team member can read every profile.
drop policy if exists "team_profiles_read_all" on public.team_profiles;
create policy "team_profiles_read_all"
  on public.team_profiles for select
  to authenticated
  using (true);

-- You can edit YOUR row. Match on lower(email) = jwt email.
drop policy if exists "team_profiles_own_insert" on public.team_profiles;
create policy "team_profiles_own_insert"
  on public.team_profiles for insert
  to authenticated
  with check (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "team_profiles_own_update" on public.team_profiles;
create policy "team_profiles_own_update"
  on public.team_profiles for update
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));

-- Touch updated_at on write.
create or replace function public.touch_team_profiles_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists team_profiles_touch on public.team_profiles;
create trigger team_profiles_touch
  before update on public.team_profiles
  for each row execute function public.touch_team_profiles_updated_at();
