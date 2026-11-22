-- Scope & contract health, per brand.
--
-- The AM fills out the Scope tile on each client profile:
--   • Shoot cadence (how often SG shoots for this client)
--   • Per-channel post quotas (same shape SocialDesk uses, so the Hub
--     can reuse the quota meter rendering)
--   • Contract start / end / renewal dates
--
-- Stored as a single JSONB blob so we can iterate on sub-shape without
-- a migration every time. The Hub reads it server-side and compares
-- against Monday (shoots delivered) + SocialDesk (posts published) to
-- show a delivered-vs-owed health readout.

alter table public.brands
  add column if not exists scope jsonb;

comment on column public.brands.scope is
  'Contract scope: {shoot_cadence, channels:[{name,inFeed,stories}], start_date, end_date, renewal_date, retainer_amount}. Filled on the Hub client profile Scope tile.';
