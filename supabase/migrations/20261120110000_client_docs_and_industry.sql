-- Two columns for the ops-cockpit pass on the client profile:
--   • client_documents — plain text. Credentials / passwords / pre-docs
--     the client sent us. Edited from the brand form. Internal-only.
--   • industry_update — jsonb. Cached Claude-generated inspiration and
--     competitor notes for this client's vertical. Refreshed via
--     POST /api/brand/:id/industry-update.
alter table public.brands
  add column if not exists client_documents text,
  add column if not exists industry_update jsonb;

comment on column public.brands.client_documents is
  'Plain-text credentials / shared docs the client gave us. AM-editable from the brand form. Not for high-sensitivity secrets.';
comment on column public.brands.industry_update is
  'Cached Claude industry update for this client vertical: { generated_at, items: [{kind, headline, body}] }';
