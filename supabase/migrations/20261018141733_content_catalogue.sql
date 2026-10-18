-- Additive catalogue. No imports, publishing, or generation side effects.
-- Existing character fields are checked text, not a PostgreSQL enum.
-- Composite keys make source links owner- and character-safe.
alter table public.content_review_items
  add constraint content_review_catalogue_identity unique (id, user_id, model);
alter table public.model_pipeline_jobs
  add constraint model_pipeline_catalogue_identity unique (id, user_id, model);

create table public.catalogue_clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  model text not null check (model in ('kiikii', 'tuuva')),
  clip_code text not null,
  assignment text not null default 'unassigned'
    check (assignment in ('unassigned', 'wall', 'ppv')),
  review_item_id uuid,
  pipeline_job_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, clip_code),
  unique (id, user_id, model),
  unique (id, user_id, model, assignment),
  check (
    (model = 'kiikii' and clip_code ~ '^KII-V[0-9]{3,}$') or
    (model = 'tuuva' and clip_code ~ '^TUU-V[0-9]{3,}$')
  ),
  foreign key (review_item_id, user_id, model)
    references public.content_review_items (id, user_id, model),
  foreign key (pipeline_job_id, user_id, model)
    references public.model_pipeline_jobs (id, user_id, model)
);
comment on table public.catalogue_clips is
  'Permanent clip identity. Optional source links allow manually imported clips.';
comment on column public.catalogue_clips.clip_code is
  'Immutable human-readable ID supplied at insertion; no automatic number allocator.';
comment on column public.catalogue_clips.assignment is
  'One current destination: unassigned, wall, or ppv. This is not publication history.';

-- Preserve identity even when a clip is not yet referenced by other tables.
create function public.guard_catalogue_clip_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.id, new.user_id, new.model, new.clip_code)
     is distinct from (old.id, old.user_id, old.model, old.clip_code) then
    raise exception 'Catalogue clip identity is immutable';
  end if;
  return new;
end $$;
revoke all on function public.guard_catalogue_clip_identity()
  from public, anon, authenticated;
create trigger catalogue_clip_identity
  before update on public.catalogue_clips
  for each row execute function public.guard_catalogue_clip_identity();

create table public.catalogue_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  model text not null check (model in ('kiikii', 'tuuva')),
  title text not null check (length(btrim(title)) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (id, user_id, model)
);
comment on table public.catalogue_offers is
  'Minimal PPV offer or bundle identity; no pricing, scheduling, or delivery logic.';

create table public.catalogue_offer_clips (
  offer_id uuid not null,
  clip_id uuid not null,
  user_id uuid not null,
  model text not null,
  assignment text not null default 'ppv' check (assignment = 'ppv'),
  primary key (offer_id, clip_id),
  foreign key (offer_id, user_id, model)
    references public.catalogue_offers (id, user_id, model),
  foreign key (clip_id, user_id, model, assignment)
    references public.catalogue_clips (id, user_id, model, assignment)
);
comment on table public.catalogue_offer_clips is
  'Bundle membership. Composite FKs prohibit mixed owners/characters and wall clips.';
comment on column public.catalogue_offer_clips.assignment is
  'Constant ppv FK discriminator. Also blocks reassigning a bundled clip to wall/unassigned.';

create table public.catalogue_clip_recipients (
  clip_id uuid not null,
  user_id uuid not null,
  model text not null,
  recipient_key text not null
    check (length(btrim(recipient_key)) between 1 and 200),
  receipt_kind text not null check (receipt_kind in ('paid', 'free')),
  received_at timestamptz,
  recorded_at timestamptz not null default now(),
  primary key (clip_id, recipient_key, receipt_kind),
  foreign key (clip_id, user_id, model)
    references public.catalogue_clips (id, user_id, model)
);
comment on table public.catalogue_clip_recipients is
  'Recorded recipients, independent of offers. Paid/free may coexist; not a sales ledger.';
comment on column public.catalogue_clip_recipients.recipient_key is
  'Stable namespaced recipient identity, e.g. fanvue:<id>; not a mutable display name.';
comment on column public.catalogue_clip_recipients.received_at is
  'Nullable when historical delivery time is unknown; recorded_at is not a sale time.';

create index catalogue_clips_assignment_idx
  on public.catalogue_clips (user_id, model, assignment);
create index catalogue_clips_review_idx
  on public.catalogue_clips (review_item_id) where review_item_id is not null;
create index catalogue_clips_job_idx
  on public.catalogue_clips (pipeline_job_id) where pipeline_job_id is not null;
create index catalogue_offers_owner_idx
  on public.catalogue_offers (user_id, model);
create index catalogue_offer_clips_owner_idx
  on public.catalogue_offer_clips (user_id, model);
create index catalogue_offer_clips_clip_idx
  on public.catalogue_offer_clips (clip_id);
create index catalogue_recipients_lookup_idx
  on public.catalogue_clip_recipients (user_id, model, recipient_key);

-- Match content_review_items: authenticated owner reads; trusted server writes.
-- No cascading deletes: linked catalogue and recipient records must not vanish silently.
alter table public.catalogue_clips enable row level security;
alter table public.catalogue_offers enable row level security;
alter table public.catalogue_offer_clips enable row level security;
alter table public.catalogue_clip_recipients enable row level security;

revoke all on public.catalogue_clips, public.catalogue_offers,
  public.catalogue_offer_clips, public.catalogue_clip_recipients
  from public, anon, authenticated;
grant select on public.catalogue_clips, public.catalogue_offers,
  public.catalogue_offer_clips, public.catalogue_clip_recipients to authenticated;
grant all on public.catalogue_clips, public.catalogue_offers,
  public.catalogue_offer_clips, public.catalogue_clip_recipients to service_role;

create policy catalogue_clips_own_read on public.catalogue_clips
  for select to authenticated using (user_id = (select auth.uid()));
create policy catalogue_offers_own_read on public.catalogue_offers
  for select to authenticated using (user_id = (select auth.uid()));
create policy catalogue_offer_clips_own_read on public.catalogue_offer_clips
  for select to authenticated using (user_id = (select auth.uid()));
create policy catalogue_recipients_own_read on public.catalogue_clip_recipients
  for select to authenticated using (user_id = (select auth.uid()));
