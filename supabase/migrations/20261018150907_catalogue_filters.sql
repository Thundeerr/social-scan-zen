-- Filtering happens before pagination; counts use exactly the same predicate.
-- Keep the three-argument RPC as a compatibility wrapper.
create function public.catalogue_snapshot(
  p_user uuid, p_clip_page integer, p_review_page integer, p_filters jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  f_model text := coalesce(p_filters->>'model','all');
  f_assignment text := coalesce(p_filters->>'assignment','all');
  f_membership text := coalesce(p_filters->>'membership','all');
  f_search text := btrim(coalesce(p_filters->>'search',''));
  f_sort text := coalesce(p_filters->>'sort','newest');
  result jsonb;
begin
  if current_user not in ('postgres','service_role') or p_user is null
     or not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
  then raise exception 'Catalogue owner required'; end if;
  if p_clip_page is null or p_review_page is null
     or p_clip_page not between 0 and 100000 or p_review_page not between 0 and 100000
  then raise exception 'Invalid catalogue page'; end if;
  if p_filters is null or jsonb_typeof(p_filters)<>'object'
     or f_model not in ('all','kiikii','tuuva')
     or f_assignment not in ('all','unassigned','wall','ppv')
     or f_membership not in ('all','in_offer','no_offer')
     or f_sort not in ('newest','clip_code','assignment') or length(f_search)>200
  then raise exception 'Invalid catalogue filters'; end if;

  with enriched as (
    select c.*, r.revision as review_revision,
      (r.sha256 is not null and r.status<>'uploading') is true as has_media,
      coalesce((
        select jsonb_agg(jsonb_build_object('id',o.id,'title',o.title) order by o.title,o.id)
        from public.catalogue_offer_clips oc
        join public.catalogue_offers o on o.id=oc.offer_id and o.user_id=oc.user_id and o.model=oc.model
        where oc.clip_id=c.id and oc.user_id=p_user and oc.model=c.model
      ),'[]'::jsonb) as offers
    from public.catalogue_clips c
    left join public.content_review_items r on r.id=c.review_item_id and r.user_id=c.user_id and r.model=c.model
    where c.user_id=p_user
      and (f_model='all' or c.model=f_model)
      and (f_assignment='all' or c.assignment=f_assignment)
      -- Literal case-insensitive substring, not LIKE wildcards.
      and (f_search='' or strpos(lower(c.clip_code),lower(f_search))>0)
  ), filtered as (
    select *, jsonb_array_length(offers)>0 as in_offer from enriched
    where f_membership='all'
      or (f_membership='in_offer' and jsonb_array_length(offers)>0)
      or (f_membership='no_offer' and jsonb_array_length(offers)=0)
  ), ranked as (
    select *, row_number() over(order by
      case when f_sort='newest' then created_at end desc,
      case when f_sort='assignment' then
        case assignment when 'unassigned' then 0 when 'wall' then 1 else 2 end end,
      clip_code asc,id
    ) as sort_order from filtered
  )
  select jsonb_build_object(
    'clips',coalesce((
      select jsonb_agg(to_jsonb(rows)-'sort_order' order by rows.sort_order)
      from (select * from ranked order by sort_order limit 50 offset p_clip_page*50) rows
    ),'[]'::jsonb),
    'clip_count',(select count(*) from filtered),
    'reviews',coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id)
      from (
        select r.id,r.model,r.title,r.created_at from public.content_review_items r
        where r.user_id=p_user and r.status='approved'
          and not exists(select 1 from public.catalogue_clips c where c.review_item_id=r.id)
        order by r.created_at desc,r.id limit 50 offset p_review_page*50
      ) rows
    ),'[]'::jsonb),
    'review_count',(
      select count(*) from public.content_review_items r
      where r.user_id=p_user and r.status='approved'
        and not exists(select 1 from public.catalogue_clips c where c.review_item_id=r.id)
    )
  ) into result;
  return result;
end $$;

create or replace function public.catalogue_snapshot(
  p_user uuid, p_clip_page integer default 0, p_review_page integer default 0
) returns jsonb
language sql security invoker set search_path = '' as $$
  select public.catalogue_snapshot(p_user,p_clip_page,p_review_page,'{}'::jsonb);
$$;
revoke all on function public.catalogue_snapshot(uuid,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.catalogue_snapshot(uuid,integer,integer,jsonb) to service_role;
revoke all on function public.catalogue_snapshot(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.catalogue_snapshot(uuid,integer,integer) to service_role;
comment on function public.catalogue_snapshot(uuid,integer,integer,jsonb) is
  'Owner-isolated catalogue search and filters. Assignment order: unassigned, wall, ppv. Reviews are intentionally unfiltered.';
