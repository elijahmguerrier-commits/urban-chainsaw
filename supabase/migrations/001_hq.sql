create table if not exists public.hq_jobs (
 id uuid primary key default gen_random_uuid(),
 owner uuid not null references auth.users(id) on delete cascade,
 agent int not null check (agent between 0 and 9),
 objective text not null check (char_length(objective) between 5 and 10000),
 status text not null default 'queued' check (status in ('queued','running','pending_approval','completed','error','cancelled')),
 result text, error text,
 parent uuid references public.hq_jobs(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.hq_schedules (
 id uuid primary key default gen_random_uuid(),
 owner uuid not null references auth.users(id) on delete cascade,
 agent int not null check (agent between 0 and 9),
 objective text not null check (char_length(objective) between 5 and 10000),
 every_hours int not null check (every_hours between 1 and 720),
 next_run timestamptz not null default now(),
 enabled boolean not null default true
);
create index if not exists hq_jobs_owner_created on public.hq_jobs(owner,created_at desc);
create index if not exists hq_schedules_due on public.hq_schedules(next_run) where enabled;
alter table public.hq_jobs enable row level security;
alter table public.hq_schedules enable row level security;
drop policy if exists "owner read jobs" on public.hq_jobs;
create policy "owner read jobs" on public.hq_jobs for select to authenticated using (owner=auth.uid());
drop policy if exists "owner read schedules" on public.hq_schedules;
create policy "owner read schedules" on public.hq_schedules for select to authenticated using (owner=auth.uid());
-- Writes occur only through the authenticated Edge Function, which validates ownership.
