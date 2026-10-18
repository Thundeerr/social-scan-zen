-- Read-only, paginated catalogue view; no media URLs or storage keys exposed.
create function public.catalogue_snapshot(
  p_user uuid, p_clip_page integer default 0, p_review_page integer default 0
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if current_user not in ('postgres','service_role') or p_user is null
     or not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
  then raise exception 'Catalogue owner required'; end if;
  if p_clip_page is null or p_review_page is null
     or p_clip_page not between 0 and 100000 or p_review_page not between 0 and 100000
  then raise exception 'Invalid catalogue page'; end if;
  select jsonb_build_object(
    'clips', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.created_at desc, rows.id)
      from (
        select c.*, r.revision as review_revision,
          (r.sha256 is not null and r.status <> 'uploading') is true as has_media,
          exists(select 1 from public.catalogue_offer_clips oc where oc.clip_id=c.id) as in_offer
        from public.catalogue_clips c
        left join public.content_review_items r
          on r.id=c.review_item_id and r.user_id=c.user_id and r.model=c.model
        where c.user_id=p_user
        order by c.created_at desc,c.id limit 50 offset p_clip_page*50
      ) rows
    ), '[]'::jsonb),
    'clip_count', (select count(*) from public.catalogue_clips where user_id=p_user),
    'reviews', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.created_at desc, rows.id)
      from (
        select r.id,r.model,r.title,r.created_at
        from public.content_review_items r
        where r.user_id=p_user and r.status='approved'
          and not exists(select 1 from public.catalogue_clips c where c.review_item_id=r.id)
        order by r.created_at desc,r.id limit 50 offset p_review_page*50
      ) rows
    ), '[]'::jsonb),
    'review_count', (
      select count(*) from public.content_review_items r
      where r.user_id=p_user and r.status='approved'
        and not exists(select 1 from public.catalogue_clips c where c.review_item_id=r.id)
    )
  ) into result;
  return result;
end $$;

create function public.set_catalogue_clip_assignment(
  p_user uuid, p_clip_id uuid, p_assignment text, p_expected_assignment text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare clip public.catalogue_clips;
begin
  if current_user not in ('postgres','service_role') or p_user is null
     or not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
  then raise exception 'Catalogue owner required'; end if;
  if p_assignment is null or p_assignment not in ('unassigned','wall','ppv')
  then raise exception 'Invalid assignment'; end if;
  -- Lock the FK parent before checking membership. Concurrent bundle inserts
  -- cannot slip between this check and an assignment change.
  select * into clip from public.catalogue_clips
    where id=p_clip_id and user_id=p_user for update;
  if not found then raise exception 'Clip not found'; end if;
  if exists(select 1 from public.catalogue_offer_clips where clip_id=clip.id)
  then raise exception 'Clip is inside an offer'; end if;
  if clip.assignment is distinct from p_expected_assignment
  then raise exception 'Assignment changed; refresh catalogue'; end if;
  update public.catalogue_clips set assignment=p_assignment
    where id=clip.id returning * into clip;
  return to_jsonb(clip);
end $$;

revoke all on function public.catalogue_snapshot(uuid,integer,integer)
  from public,anon,authenticated;
revoke all on function public.set_catalogue_clip_assignment(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.catalogue_snapshot(uuid,integer,integer) to service_role;
grant execute on function public.set_catalogue_clip_assignment(uuid,uuid,text,text) to service_role;
comment on function public.set_catalogue_clip_assignment(uuid,uuid,text,text) is
  'Owner-only assignment change. Any offer membership blocks edits; expected value rejects stale UI updates.';
