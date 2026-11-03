-- Comments share the DM contact cooldown and opt-out, but have their own switch.
alter table public.ig_dm_redirect_receipts add column source text not null default 'dm'
  check (source in ('dm','comment'));
create table public.ig_comment_redirect_settings (
  user_id uuid primary key references public.ig_dm_redirect_settings(user_id),
  mode text not null default 'off' check (mode in ('off','test','live')),
  activated_at timestamptz,
  last_received_at timestamptz
);
alter table public.ig_comment_redirect_settings enable row level security;
revoke all on public.ig_comment_redirect_settings from public,anon,authenticated;
grant all on public.ig_comment_redirect_settings to service_role;
create index ig_dm_redirect_source_recent on public.ig_dm_redirect_receipts(user_id,source,received_at desc);

create function public.ig_comment_redirect_reserve(
  p_receiver text,p_sender text,p_hash text,p_event_at timestamptz,p_username text,p_trigger boolean
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare cfg public.ig_dm_redirect_settings; comments public.ig_comment_redirect_settings;
  person public.ig_dm_redirect_contacts; chosen integer; outcome text;
begin
  -- Same first lock as ig_dm_redirect_reserve: serializes both entry points.
  select * into cfg from public.ig_dm_redirect_settings where receiver_id=p_receiver and mode<>'off' for update;
  if not found then return '{"ignored":true}'; end if;
  select * into comments from public.ig_comment_redirect_settings where user_id=cfg.user_id and mode<>'off' for update;
  if not found then return '{"ignored":true}'; end if;
  if not exists(select 1 from public.user_roles where user_id=cfg.user_id and role in ('owner','cofounder')) then return '{"ignored":true}'; end if;
  if p_trigger is distinct from true then return '{"ignored":true}'; end if;
  if p_sender is null or p_sender !~ '^[0-9]{1,40}$' or p_sender=p_receiver or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid event'; end if;
  -- Deliberately only fresh comments after activation; no historical backlog.
  if p_event_at is null or p_event_at < now()-interval '23 hours 59 minutes' or p_event_at > now()+interval '5 minutes'
    or comments.activated_at is null or p_event_at < comments.activated_at-interval '5 seconds' then return '{"ignored":true}'; end if;
  if (comments.mode='test' or cfg.mode='test') and lower(coalesce(p_username,''))<>cfg.test_username then return '{"ignored":true}'; end if;
  if exists(select 1 from public.ig_dm_redirect_receipts where user_id=cfg.user_id and message_hash=p_hash) then return '{"duplicate":true}'; end if;
  insert into public.ig_dm_redirect_contacts(user_id,sender_id) values(cfg.user_id,p_sender) on conflict do nothing;
  select * into person from public.ig_dm_redirect_contacts where user_id=cfg.user_id and sender_id=p_sender for update;
  if person.opted_out then outcome:='opted_out';
  elsif person.last_attempt_at > now()-interval '24 hours' then outcome:='cooldown';
  else
    outcome:='reserved';
    if person.previous_variant is null then chosen:=floor(random()*30)::integer;
    else
      chosen:=floor(random()*29)::integer;
      if chosen>=person.previous_variant then chosen:=chosen+1; end if;
    end if;
    update public.ig_dm_redirect_contacts set last_attempt_at=now(),previous_variant=chosen where user_id=cfg.user_id and sender_id=p_sender;
  end if;
  insert into public.ig_dm_redirect_receipts(user_id,message_hash,sender_id,event_at,variant,status,source)
    values(cfg.user_id,p_hash,p_sender,p_event_at,chosen,outcome,'comment');
  update public.ig_comment_redirect_settings set last_received_at=now() where user_id=cfg.user_id;
  return jsonb_build_object('send',outcome='reserved','variant',chosen,'user_id',cfg.user_id);
end $$;
revoke all on function public.ig_comment_redirect_reserve(text,text,text,timestamptz,text,boolean) from public,anon,authenticated;
grant execute on function public.ig_comment_redirect_reserve(text,text,text,timestamptz,text,boolean) to service_role;
