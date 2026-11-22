-- Scope & Contract Health blob for each brand.
-- The Scope tile (components/client-profile/scope-tile.tsx) and its server
-- action (scope-actions.ts) have been writing brands.scope since 2026-11-20,
-- but the column was never created — so every "Save scope" was failing. This
-- adds it. JSONB is schemaless, so the extended scope shape (services, term,
-- production, deliverables, post-production, guarantees) needs no further
-- migration.

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS scope jsonb;
