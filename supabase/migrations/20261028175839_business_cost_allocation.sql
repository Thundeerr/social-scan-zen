-- Fixed-cost planning is separate from historic cash payments; currencies are never mixed.
create table public.business_cost_allocations (
 user_id uuid not null references auth.users(id) on delete cascade,
 reference text not null,
 label text not null,
 model text not null check(model in ('kiikii','tuuva')),
 currency text not null check(currency in ('EUR','USD')),
 monthly_cents integer not null check(monthly_cents>=0),
 effective_from date not null,
 planned boolean not null default false,
 note text not null,
 primary key(user_id,reference,effective_from)
);
alter table public.business_cost_allocations enable row level security;
revoke all on public.business_cost_allocations from public,anon,authenticated;
grant all on public.business_cost_allocations to service_role;
comment on table public.business_cost_allocations is 'Owner-scoped server-only monthly allocation plan. Does not overwrite actual bank expenses or historic topups. Most recent effective version per reference wins.';
create table public.wavespeed_task_attributions (
 user_id uuid not null references auth.users(id) on delete cascade,
 provider_id text not null check(provider_id ~ '^[a-f0-9]{32}$'),
 model text not null check(model in ('kiikii','tuuva')),
 evidence text not null check(length(evidence)>10),
 verified_at timestamptz not null default now(),
 primary key(user_id,provider_id,model)
);
alter table public.wavespeed_task_attributions enable row level security;
revoke all on public.wavespeed_task_attributions from public,anon,authenticated;
grant all on public.wavespeed_task_attributions to service_role;
comment on table public.wavespeed_task_attributions is 'Verified external task manifests, with evidence path/hash. Combined with pipeline jobs; conflicting character attribution remains unknown. No generation or billing mutation.';
