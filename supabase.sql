-- AdSure early access: run this once in Supabase > SQL Editor > New query > Run

create table if not exists public.early_access (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  name             text not null check (char_length(name) between 2 and 80),
  email            text not null check (char_length(email) <= 120 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  business_type    text check (char_length(business_type) <= 60),
  monthly_ad_spend text check (char_length(monthly_ad_spend) <= 60),
  platforms        text[] check (cardinality(platforms) <= 5),
  biggest_problem  text check (char_length(biggest_problem) <= 80),
  consent          boolean not null check (consent = true),
  source           text check (char_length(source) <= 200)
);

-- one sign-up per email
create unique index if not exists early_access_email_key on public.early_access (lower(email));

-- Row Level Security: the public website can ADD a sign-up but can never READ the list
alter table public.early_access enable row level security;

drop policy if exists "Website can add sign-ups" on public.early_access;
create policy "Website can add sign-ups"
  on public.early_access for insert
  to anon
  with check (true);

-- The live seat counter: returns only the number of sign-ups, no personal data
create or replace function public.seats_taken()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.early_access;
$$;

revoke all on function public.seats_taken() from public;
grant execute on function public.seats_taken() to anon, authenticated;
