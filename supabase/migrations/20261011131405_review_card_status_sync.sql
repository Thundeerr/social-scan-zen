-- Caption edits keep the confirmed message identity, so updates never require
-- sending a second video card. Approval still resets via content_review_command.
create function public.preserve_review_card_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.telegram_message_id is not null and new.telegram_message_id is null and new.revision>old.revision then
  new.telegram_message_id:=old.telegram_message_id;
  new.notification:=old.notification;
 end if;
 return new;
end $$;
revoke all on function public.preserve_review_card_identity() from public,anon,authenticated;
create trigger preserve_review_card_identity before update on public.content_review_items
for each row execute function public.preserve_review_card_identity();

create table public.review_card_sync (
 item_id uuid primary key references public.content_review_items(id) on delete cascade,
 wanted bigint not null default 1, applied bigint not null default 0,
 claimed_version bigint, lease uuid, lease_until timestamptz,
 retry_at timestamptz not null default now()
);
alter table public.review_card_sync enable row level security;
revoke all on public.review_card_sync from public,anon,authenticated;
grant all on public.review_card_sync to service_role;

create function public.queue_review_card_sync() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
 if TG_TABLE_NAME='content_posts' then
  select id into target from public.content_review_items where publish_post_id=new.id and telegram_message_id is not null;
 else
  if new.telegram_message_id is not null then target:=new.id; end if;
 end if;
 if target is not null then
  insert into public.review_card_sync(item_id) values(target)
  on conflict(item_id) do update set wanted=public.review_card_sync.wanted+1,retry_at=now();
 end if;
 return new;
end $$;
revoke all on function public.queue_review_card_sync() from public,anon,authenticated;
create trigger review_card_post_changed after update of status,scheduled_for on public.content_posts
for each row when (old.status is distinct from new.status or old.scheduled_for is distinct from new.scheduled_for) execute function public.queue_review_card_sync();
create trigger review_card_review_changed after update of status,revision,publish_post_id,telegram_message_id on public.content_review_items
for each row when (old.status is distinct from new.status or old.revision is distinct from new.revision or old.publish_post_id is distinct from new.publish_post_id or old.telegram_message_id is distinct from new.telegram_message_id) execute function public.queue_review_card_sync();

create function public.review_card_sync_command(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.review_card_sync; item public.content_review_items; post public.content_posts;
begin
 if current_user not in ('postgres','service_role') or not exists(select 1 from public.user_roles where user_id=p_user and role='owner') then raise exception 'owner service required'; end if;
 if p_action='claim' then
  select q.* into job from public.review_card_sync q join public.content_review_items r on r.id=q.item_id
  where r.user_id=p_user and r.telegram_message_id is not null and q.wanted>q.applied and q.retry_at<=now()
   and (q.lease_until is null or q.lease_until<now()) and (p_data->>'id' is null or q.item_id=(p_data->>'id')::uuid)
  order by q.retry_at for update of q skip locked limit 1;
  if not found then return null; end if;
  update public.review_card_sync set lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',claimed_version=wanted where item_id=job.item_id returning * into job;
  select * into item from public.content_review_items where id=job.item_id;
  select * into post from public.content_posts where id=item.publish_post_id;
  return jsonb_build_object('id',job.item_id,'lease',job.lease,'item',to_jsonb(item)-'user_id'-'media_path'-'sha256',
   'post',jsonb_build_object('status',post.status,'scheduled_for',post.scheduled_for,'publish_mode',post.publish_mode));
 elsif p_action in ('done','retry') then
  update public.review_card_sync q set applied=case when p_action='done' then claimed_version else applied end,
   lease=null,lease_until=null,claimed_version=null,retry_at=case when p_action='retry' then now()+interval '2 minutes' else now() end
  where q.item_id=(p_data->>'id')::uuid and q.lease=(p_data->>'lease')::uuid and exists(select 1 from public.content_review_items r where r.id=q.item_id and r.user_id=p_user);
  if not found then raise exception 'stale lease'; end if;
  return '{"ok":true}';
 end if;
 raise exception 'unknown action';
end $$;
revoke all on function public.review_card_sync_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.review_card_sync_command(uuid,text,jsonb) to service_role;
insert into public.review_card_sync(item_id) select id from public.content_review_items where telegram_message_id is not null;
