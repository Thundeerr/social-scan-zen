-- Offer editing is server-only, matching catalogue/review commands.
create function public.catalogue_offer_command(
  p_user uuid, p_action text, p_data jsonb default '{}'
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  offer public.catalogue_offers;
  clip public.catalogue_clips;
  page integer;
begin
  if current_user not in ('postgres','service_role') or p_user is null
    or not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
  then raise exception 'Catalogue owner required'; end if;

  if p_action='list' then
    page := coalesce((p_data->>'page')::integer,0);
    if page not between 0 and 100000 then raise exception 'Invalid page'; end if;
    return jsonb_build_object(
      'total', (select count(*) from public.catalogue_offers where user_id=p_user),
      'offers', coalesce((
        select jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id) from (
          select o.*, coalesce((
            select jsonb_agg(jsonb_build_object('id',c.id,'clip_code',c.clip_code) order by c.clip_code)
            from public.catalogue_offer_clips oc
            join public.catalogue_clips c on c.id=oc.clip_id and c.user_id=oc.user_id and c.model=oc.model
            where oc.offer_id=o.id and oc.user_id=p_user and oc.model=o.model
          ),'[]'::jsonb) as clips
          from public.catalogue_offers o where o.user_id=p_user
          order by o.created_at desc,o.id limit 50 offset page*50
        ) rows
      ),'[]'::jsonb)
    );
  elsif p_action='create' then
    if coalesce(p_data->>'model','') not in ('kiikii','tuuva')
      or coalesce(length(btrim(p_data->>'title')),0) not between 1 and 160
    then raise exception 'Invalid offer title or character'; end if;
    insert into public.catalogue_offers(user_id,model,title)
      values(p_user,p_data->>'model',btrim(p_data->>'title')) returning * into offer;
    return to_jsonb(offer);
  elsif p_action not in ('add','remove') or p_action is null then
    raise exception 'Unknown offer action';
  end if;

  -- Same parent-row lock as assignment changes; no check/update race.
  if p_action='add' then
    select * into clip from public.catalogue_clips
      where user_id=p_user and clip_code=p_data->>'clip_code' for update;
  else
    select * into clip from public.catalogue_clips
      where user_id=p_user and id=(p_data->>'clip_id')::uuid for update;
  end if;
  if not found then raise exception 'Clip not found'; end if;
  select * into offer from public.catalogue_offers
    where id=(p_data->>'offer_id')::uuid and user_id=p_user for share;
  if not found then raise exception 'Offer not found'; end if;
  if clip.model<>offer.model then raise exception 'Clip and offer characters differ'; end if;

  if p_action='add' then
    if clip.assignment='wall' then raise exception 'Wall clips cannot enter offers'; end if;
    if clip.assignment='unassigned' then
      update public.catalogue_clips set assignment='ppv' where id=clip.id;
    end if;
    insert into public.catalogue_offer_clips(offer_id,clip_id,user_id,model)
      values(offer.id,clip.id,p_user,offer.model)
      on conflict (offer_id,clip_id) do nothing;
  else
    delete from public.catalogue_offer_clips
      where offer_id=offer.id and clip_id=clip.id and user_id=p_user;
    -- Keep PPV assignment and recipient records; removal does not undo delivery.
  end if;
  return jsonb_build_object('offer_id',offer.id,'clip_id',clip.id);
end $$;
revoke all on function public.catalogue_offer_command(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.catalogue_offer_command(uuid,text,jsonb) to service_role;
comment on function public.catalogue_offer_command(uuid,text,jsonb) is
  'List/create offers and add/remove clips. Add atomically promotes unassigned to ppv; wall is rejected.';
