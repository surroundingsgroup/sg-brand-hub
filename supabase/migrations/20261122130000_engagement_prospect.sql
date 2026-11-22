-- Client lifecycle gains a pre-close state. Brands created by the public intake
-- form (no won deal behind them) are born 'prospect'; a Won deal promotes them
-- to 'retainer' / 'project' (Brief tool deal-mirror).
ALTER TYPE public.engagement_type ADD VALUE IF NOT EXISTS 'prospect';
