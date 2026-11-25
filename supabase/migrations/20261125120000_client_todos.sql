-- Client to-dos: each To-do can belong to a client, carry a due date and say
-- where it came from (typed in, a meeting, or a monthly recurring one). The
-- client page's To-dos tile lists a client's; My Surroundings still lists
-- each person's own. Plus each client's recurring schedule.

alter table public.my_todos
  add column if not exists brand_id uuid references public.brands(id) on delete cascade,
  add column if not exists due_date date,
  add column if not exists source text,       -- manual | meeting | recurring
  add column if not exists source_ref text;   -- meeting id, or e.g. "calendar:2027-01"

create index if not exists my_todos_brand_idx on public.my_todos (brand_id, done, due_date);

-- The recurring schedule per client, e.g.
-- {"calendar_day": 20, "report": "first_monday", "owner_email": null}
alter table public.brands add column if not exists todo_schedule jsonb;

-- Meeting to-dos made before this: tie them to their client by name.
update public.my_todos t
   set brand_id = b.id, source = coalesce(t.source, 'meeting')
  from public.brands b
 where t.brand_id is null
   and t.text like b.business_name || ': %';

-- Their "(2026-12-04)" endings become real due dates.
update public.my_todos
   set due_date = (substring(text from '\((\d{4}-\d{2}-\d{2})\)\s*$'))::date,
       text = regexp_replace(text, '\s*\(\d{4}-\d{2}-\d{2}\)\s*$', '')
 where due_date is null
   and text ~ '\(\d{4}-\d{2}-\d{2}\)\s*$';

-- And each one points back to the meeting it came from.
update public.my_todos t
   set source_ref = m.id::text
  from public.meeting_notes m
  join public.brands b on b.id = m.brand_id
  cross join lateral jsonb_array_elements(coalesce(to_jsonb(m.action_items_us), '[]'::jsonb)) as item
 where t.brand_id = m.brand_id
   and t.source = 'meeting'
   and t.source_ref is null
   and t.text like b.business_name || ': ' || (item ->> 'task') || '%';
