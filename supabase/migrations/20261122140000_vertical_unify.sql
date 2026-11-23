-- One vertical list everywhere (2026-11-22), matching the "Vertical" column on
-- the Monday Deals board:
--   Marine / Real Estate & Development / Multifamily / Private Aviation /
--   Resorts & Travel / Hospitality & Experiences / Automotive / Luxury Goods / Other
--
-- Two of those are new to this table. Run once in the Supabase SQL editor.
ALTER TYPE public.brand_vertical ADD VALUE IF NOT EXISTS 'hospitality';
ALTER TYPE public.brand_vertical ADD VALUE IF NOT EXISTS 'luxury_goods';
