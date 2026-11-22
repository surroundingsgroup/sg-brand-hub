-- Hub-native monthly allocation. Replaces the standalone Monday
-- "Allocation" board as the primary surface for AMs — they submit
-- here, and we mirror to Monday (follow-up pass) so Operations keeps
-- their current workflow.
--
-- Two tables:
--   • monthly_allocations      — one row per (brand, year, month)
--   • monthly_allocation_lines — one row per task/role line within
--
-- Lines are seeded from the client board's "Allocation Setup" group
-- (read-only template) when the AM opens the editor for a month with
-- no existing row; they can then edit, add, remove, and submit.

create table if not exists public.monthly_allocations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  year int not null check (year between 2020 and 2100),
  month int not null check (month between 1 and 12),

  -- 'draft' | 'submitted'
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  submitted_by uuid references auth.users(id),

  -- Snapshot of the line-sum at save time, so the tile can show the
  -- headline number without joining to lines.
  total_hours numeric(10, 2) not null default 0,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  unique (brand_id, year, month)
);

create index if not exists monthly_allocations_brand_period_idx
  on public.monthly_allocations(brand_id, year desc, month desc);

create table if not exists public.monthly_allocation_lines (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.monthly_allocations(id) on delete cascade,

  task text not null,
  role text,
  owner text,
  hours numeric(10, 2) not null default 0,
  notes text,

  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists monthly_allocation_lines_allocation_idx
  on public.monthly_allocation_lines(allocation_id, sort_order);

-- RLS: team-wide read/write (matches internal_notes + meeting_notes).
alter table public.monthly_allocations enable row level security;
alter table public.monthly_allocation_lines enable row level security;

drop policy if exists "monthly_allocations_team_all" on public.monthly_allocations;
create policy "monthly_allocations_team_all"
  on public.monthly_allocations for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "monthly_allocation_lines_team_all" on public.monthly_allocation_lines;
create policy "monthly_allocation_lines_team_all"
  on public.monthly_allocation_lines for all
  to authenticated
  using (true)
  with check (true);

-- Touch updated_at on write.
create or replace function public.touch_monthly_allocations_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists monthly_allocations_touch on public.monthly_allocations;
create trigger monthly_allocations_touch
  before update on public.monthly_allocations
  for each row execute function public.touch_monthly_allocations_updated_at();
