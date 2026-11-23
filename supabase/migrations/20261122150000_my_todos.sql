-- Personal to-dos for the To-dos card on My Surroundings. One row per item.
-- Private to the person: the policy lets someone signed in see and change
-- only the rows under their own email.

create table if not exists public.my_todos (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  text text not null check (char_length(text) between 1 and 300),
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists my_todos_owner_idx
  on public.my_todos (owner_email, done, created_at desc);

alter table public.my_todos enable row level security;

drop policy if exists "my_todos_own" on public.my_todos;
create policy "my_todos_own"
  on public.my_todos for all
  to authenticated
  using (lower(owner_email) = lower(auth.jwt() ->> 'email'))
  with check (lower(owner_email) = lower(auth.jwt() ->> 'email'));
