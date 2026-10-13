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

-- Row Level Security: the public key can never READ the list.
alter table public.early_access enable row level security;

-- Sign-ups are saved by /api/signup on the server (secret key) after Cloudflare Turnstile confirms a real person.
-- So the public key can't add rows either; bots can't fill the form by calling Supabase directly.
-- (Only run this part after TURNSTILE_SECRET_KEY and SUPABASE_SECRET_KEY are set in Vercel, see README.)
drop policy if exists "Website can add sign-ups" on public.early_access;
revoke insert, update, delete, select on public.early_access from anon, authenticated;
grant select, insert on public.early_access to service_role;

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
