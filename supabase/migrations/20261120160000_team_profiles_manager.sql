-- Accountability chart support. Each team profile can point to its
-- manager (by email). Nullable — the CEO has no manager.
--
-- From Billy's call: Ariel is the Account Management leader (replacing
-- the outdated Justin reference on the Monday board). Phallon is the
-- Sales leader with no reports yet.

alter table public.team_profiles
  add column if not exists manager_email text;

create index if not exists team_profiles_manager_idx
  on public.team_profiles(manager_email);
