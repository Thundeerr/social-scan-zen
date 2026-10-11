-- Review is deliberately separate from content_posts and publishing.
create table public.content_review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  model text not null check (model in ('kiikii','tuuva')),
  title text not null check (length(title) between 1 and 160),
  caption text not null default '' check (length(caption) <= 2200),
  status text not null default 'uploading' check (status in ('uploading','pending','approved','rejected','changes')),
  revision integer not null default 1,
  media_path text not null unique,
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint check (bytes between 12 and 41943040),
  note text not null default '' check (length(note) <= 2000),
  notification text not null default 'none' check (notification in ('none','sending','sent','uncertain')),
  telegram_message_id bigint,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status='uploading' or (sha256 is not null and bytes is not null))
);
create index content_review_owner_date on public.content_review_items(user_id,created_at desc);
create table public.content_review_events (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.content_review_items(id),
  user_id uuid not null references auth.users(id),
  revision integer not null,
  action text not null,
  created_at timestamptz not null default now()
);
alter table public.content_review_items enable row level security;
alter table public.content_review_events enable row level security;
revoke all on public.content_review_items, public.content_review_events from public, anon, authenticated;
grant all on public.content_review_items, public.content_review_events to service_role;
grant usage on sequence public.content_review_events_id_seq to service_role;
grant select on public.content_review_items, public.content_review_events to authenticated;
create policy content_review_own_read on public.content_review_items for select to authenticated using (user_id=(select auth.uid()));
create policy content_review_events_own_read on public.content_review_events for select to authenticated using (user_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('content-review','content-review',false,41943040,array['video/mp4']);
-- No client write/delete policy. Signed uploads are insert-only; media is immutable.

create function public.content_review_command(p_user uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  item public.content_review_items; new_id uuid := gen_random_uuid(); decision text;
begin
  if current_user not in ('service_role','postgres') or p_user is null or
    not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
    then raise exception 'owner required'; end if;
  if p_action='list' then
    return coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc)
      from (select * from public.content_review_items where user_id=p_user order by created_at desc limit 100) i),'[]');
  elsif p_action='create' then
    insert into public.content_review_items(id,user_id,model,title,caption,media_path)
      values(new_id,p_user,p_payload->>'model',btrim(p_payload->>'title'),coalesce(p_payload->>'caption',''),
        p_user::text || '/' || new_id::text || '/video.mp4') returning * into item;
  else
    select * into item from public.content_review_items where id=(p_payload->>'id')::uuid and user_id=p_user for update;
    if not found then raise exception 'not found'; end if;
    if p_action='get' then return to_jsonb(item); end if;
    if p_payload->>'revision' is null or item.revision<>(p_payload->>'revision')::integer then raise exception 'stale revision'; end if;
    if p_action='finalize' then
      if item.status<>'uploading' then raise exception 'already finalized'; end if;
      update public.content_review_items set sha256=p_payload->>'sha256',bytes=(p_payload->>'bytes')::bigint,status='pending'
        where id=item.id returning * into item;
    elsif p_action='edit' then
      if item.notification='sending' then raise exception 'notification in flight'; end if;
      if item.status='uploading' then raise exception 'upload incomplete'; end if;
      update public.content_review_items set caption=p_payload->>'caption',revision=revision+1,status='pending',
        note='',reviewed_at=null,notification='none',telegram_message_id=null where id=item.id returning * into item;
    elsif p_action='decide' then
      decision:=p_payload->>'decision';
      if item.status<>'pending' or decision is null or decision not in ('approved','rejected','changes') then raise exception 'invalid decision'; end if;
      if decision='changes' and length(btrim(coalesce(p_payload->>'note','')))=0 then raise exception 'note required'; end if;
      if decision='approved' and length(btrim(item.caption))=0 then raise exception 'caption required'; end if;
      update public.content_review_items set status=decision,note=coalesce(p_payload->>'note',''),reviewed_at=now()
        where id=item.id returning * into item;
    elsif p_action='reserve_notification' then
      if item.status<>'pending' or item.notification<>'none' then raise exception 'notification already attempted'; end if;
      update public.content_review_items set notification='sending' where id=item.id returning * into item;
    elsif p_action='finish_notification' then
      if item.notification<>'sending' then raise exception 'not reserved'; end if;
      update public.content_review_items set notification=case when p_payload->>'message_id' is null then 'uncertain' else 'sent' end,
        telegram_message_id=(p_payload->>'message_id')::bigint where id=item.id returning * into item;
    else raise exception 'unknown action';
    end if;
  end if;
  insert into public.content_review_events(item_id,user_id,revision,action) values(item.id,p_user,item.revision,p_action);
  return to_jsonb(item);
end $$;
revoke all on function public.content_review_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.content_review_command(uuid,text,jsonb) to service_role;
