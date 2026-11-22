-- Fix the anon logo upload policy — the May 2026 "tighten" migration
-- added an `exists (select ... from public.brands)` guard, but anon has
-- no SELECT policy on brands, so the subquery silently returns zero
-- rows and the policy denies every anon insert. Result: every public
-- intake form submission since the tighten was applied in production
-- has been unable to upload logos / reference files.
--
-- Fix: wrap the eligibility check in a SECURITY DEFINER function. The
-- function runs with the policy owner's privileges and sees the brands
-- row regardless of anon's SELECT rights, keeping the 15-minute window
-- and status filter intact while letting the public form upload.

create or replace function public.is_brand_eligible_for_anon_upload(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.brands b
    where b.id = bid
      and b.status in ('submitted', 'draft')
      and b.created_at > now() - interval '15 minutes'
  );
$$;

revoke all on function public.is_brand_eligible_for_anon_upload(uuid) from public;
grant execute on function public.is_brand_eligible_for_anon_upload(uuid) to anon, authenticated;

-- Re-apply the policies to use the SECURITY DEFINER function.
drop policy if exists "logos_insert_anon_recent" on public.brand_logos;
create policy "logos_insert_anon_recent" on public.brand_logos
  for insert to anon with check (
    public.is_brand_eligible_for_anon_upload(brand_id)
  );

drop policy if exists "logos_anon_intake_upload_recent" on storage.objects;
create policy "logos_anon_intake_upload_recent" on storage.objects
  for insert to anon with check (
    bucket_id = 'brand-logos'
    and public.is_brand_eligible_for_anon_upload(
      split_part(name, '/', 1)::uuid
    )
  );
