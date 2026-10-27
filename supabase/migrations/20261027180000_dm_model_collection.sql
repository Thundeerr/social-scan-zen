-- Explicit model routing for signed, allowlisted DMs. Collection never creates paid jobs.
alter table public.reel_inbox_dm_receipts add column model text check (model in ('kiikii','tuuva'));
alter table public.reel_inbox_items add constraint reel_inbox_owner_id_unique unique(user_id,id);
create table public.reel_inbox_dm_candidates (
  user_id uuid not null references public.reel_inbox_dm_sources(user_id),
  inbox_id uuid not null,
  model text not null check(model in ('kiikii','tuuva')),
  created_at timestamptz not null default now(),
  primary key(user_id,model,inbox_id),
  foreign key(user_id,inbox_id) references public.reel_inbox_items(user_id,id)
);
create index reel_inbox_dm_candidates_recent on public.reel_inbox_dm_candidates(user_id,created_at desc);
alter table public.reel_inbox_dm_candidates enable row level security;
revoke all on public.reel_inbox_dm_candidates from public,anon,authenticated;
grant all on public.reel_inbox_dm_candidates to service_role;
comment on table public.reel_inbox_dm_candidates is 'Model-specific collected Reel links. No generation or publishing side effects; duplicates per model are ignored.';
comment on column public.reel_inbox_dm_receipts.model is 'Model selected by accompanying sender text; null for older receipts. Raw message text is not stored.';

create function public.reel_inbox_dm_ingest_v3(
  p_receiver text,p_sender text,p_username text,p_hash text,
  p_links jsonb,p_diagnostics jsonb,p_model text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare src public.reel_inbox_dm_sources; bound text; result jsonb; entry jsonb; safe jsonb;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service required'; end if;
  select * into src from public.reel_inbox_dm_sources where receiver_id=p_receiver and enabled for update;
  if not found then return '{"ignored":true}'; end if;
  if not exists(select 1 from public.user_roles where user_id=src.user_id and role in ('owner','cofounder')) then return '{"ignored":true}'; end if;
  if p_username is null or (p_username not in ('kiikii.bat','thundeerr999') and not exists(
    select 1 from public.model_pipeline_profiles where user_id=src.user_id and sender_username=p_username
  )) or p_sender is null or p_sender !~ '^[0-9]{1,40}$' then return '{"ignored":true}'; end if;
  select sender_id into bound from public.reel_inbox_dm_senders where user_id=src.user_id and username=p_username;
  if found and bound<>p_sender then return '{"ignored":true}'; end if;
  if exists(select 1 from public.reel_inbox_dm_senders where user_id=src.user_id and sender_id=p_sender and username<>p_username) then return '{"ignored":true}'; end if;
  if p_model is null or p_model not in ('kiikii','tuuva') then raise exception 'invalid model'; end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid receipt'; end if;
  if jsonb_typeof(p_links) is distinct from 'array' or jsonb_array_length(p_links)>50 then raise exception 'invalid links'; end if;
  if exists(select 1 from public.reel_inbox_dm_receipts where user_id=src.user_id and message_hash=p_hash) then return '{"duplicate":true}'; end if;
  if (select count(*) from public.reel_inbox_dm_receipts where user_id=src.user_id)>=50000 then raise exception 'receipt limit'; end if;
  if jsonb_typeof(p_diagnostics) is distinct from 'object'
    or coalesce(p_diagnostics->>'outcome','') not in ('link_found','unsupported','no_permalink','attachment_without_link','no_attachment')
    or coalesce((p_diagnostics->>'attachment_count')::integer,-1) not between 0 and 50
    or coalesce((p_diagnostics->>'share_count')::integer,-1) not between 0 and 50
    or coalesce((p_diagnostics->>'url_count')::integer,-1) not between 0 and 100
    or p_diagnostics->>'unsupported' is null then raise exception 'Invalid diagnostic'; end if;
  safe:=jsonb_build_object('outcome',p_diagnostics->>'outcome',
    'attachment_count',(p_diagnostics->>'attachment_count')::integer,
    'share_count',(p_diagnostics->>'share_count')::integer,
    'url_count',(p_diagnostics->>'url_count')::integer,
    'unsupported',(p_diagnostics->>'unsupported')::boolean);
  insert into public.reel_inbox_dm_senders values(src.user_id,p_username,p_sender) on conflict do nothing;
  result:=public.reel_inbox_command('submit',src.user_id,jsonb_build_object('links',p_links,'test',false));
  insert into public.reel_inbox_dm_receipts(user_id,message_hash,sender,status,link_count,diagnostics,model)
    values(src.user_id,p_hash,p_username,case when jsonb_array_length(p_links)>0 then 'queued' else 'no_reel_link' end,jsonb_array_length(p_links),safe,p_model);
  for entry in select * from jsonb_array_elements(result) loop
    insert into public.reel_inbox_dm_candidates(user_id,inbox_id,model)
      values(src.user_id,(entry->>'id')::uuid,p_model) on conflict do nothing;
  end loop;
  update public.reel_inbox_dm_sources set last_received_at=now() where user_id=src.user_id;
  return jsonb_build_object('results',result,'model',p_model,'collected',true);
end $$;
revoke all on function public.reel_inbox_dm_ingest_v3(text,text,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.reel_inbox_dm_ingest_v3(text,text,text,text,jsonb,jsonb,text) to service_role;
