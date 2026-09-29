-- Anonymous skill ratings from autoskill clients that opted in.
-- Only the Vercel function writes and reads, with the service role; nothing is exposed to anon.

create table public.ratings (
  id bigint generated always as identity primary key,
  install_id uuid not null,
  ip_hash text not null check (char_length(ip_hash) = 64),
  skill_id text not null check (skill_id ~ '^[A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}:[A-Za-z0-9_./-]{0,150}$'),
  sha text not null check (sha ~ '^[0-9a-f]{40}$'),
  verdict text not null check (verdict in ('helped', 'no-difference', 'hurt')),
  reason text not null check (reason in ('followed-steps', 'saved-time', 'irrelevant', 'outdated-or-wrong', 'conflicted', 'too-long')),
  created_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  -- One rating per install, skill, commit and day: a replayed batch changes nothing.
  unique (install_id, skill_id, sha, created_on)
);

create index ratings_install_day on public.ratings (install_id, created_on);
create index ratings_ip_day on public.ratings (ip_hash, created_on);

-- RLS on and forced with no policies, and no grants to anon or authenticated: the grant is the lock.
alter table public.ratings enable row level security;
alter table public.ratings force row level security;
revoke all on public.ratings from anon, authenticated;
grant select, insert on public.ratings to service_role;

-- Counts of distinct installs, never raw rows: one install can move a count by at most one.
create view public.rating_counts with (security_invoker = true) as
  select skill_id, sha, verdict, reason, count(distinct install_id)::int as installs
  from public.ratings
  group by skill_id, sha, verdict, reason;

revoke all on public.rating_counts from anon, authenticated;
grant select on public.rating_counts to service_role;

-- The daily limits and the insert in one transaction, serialised per install and per IP hash,
-- so parallel requests cannot all read a count of zero and all insert.
create function public.submit_ratings(p_install uuid, p_ip_hash text, p_rows jsonb, p_per_install int, p_per_ip int)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  incoming int := jsonb_array_length(p_rows);
  inserted int;
begin
  perform pg_advisory_xact_lock(hashtext('install:' || p_install::text || today::text));
  perform pg_advisory_xact_lock(hashtext('ip:' || p_ip_hash || today::text));
  if (select count(*) from ratings where install_id = p_install and created_on = today) + incoming > p_per_install
     or (select count(*) from ratings where ip_hash = p_ip_hash and created_on = today) + incoming > p_per_ip then
    return -1;
  end if;
  insert into ratings (install_id, ip_hash, skill_id, sha, verdict, reason)
  select p_install, p_ip_hash, r->>'skillId', r->>'sha', r->>'verdict', r->>'reason'
  from jsonb_array_elements(p_rows) as r
  on conflict (install_id, skill_id, sha, created_on) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.submit_ratings(uuid, text, jsonb, int, int) from public, anon, authenticated;
grant execute on function public.submit_ratings(uuid, text, jsonb, int, int) to service_role;
