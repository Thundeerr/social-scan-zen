-- Preserve historical evidence without interpreting display names as stable fan IDs.
alter table public.catalogue_clips add column desktop_source jsonb;
alter table public.catalogue_offers add column desktop_key text;
alter table public.catalogue_offers add column desktop_source jsonb;
create unique index catalogue_offer_desktop_key on public.catalogue_offers(user_id,desktop_key)
  where desktop_key is not null;
comment on column public.catalogue_clips.desktop_source is
  'Original desktop register row; retains filenames, media IDs, incomplete coverage and unresolved buyer names.';
comment on column public.catalogue_offers.desktop_key is 'Stable imported template code, scoped to owner.';

create function public.import_catalogue_desktop(p_user uuid, p_videos jsonb, p_offers jsonb, p_preview boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  item jsonb; offer jsonb; recipient jsonb; entry jsonb;
  code text; model_name text; destination text; template_key text; kind text; handle text;
  clip public.catalogue_clips; bundle public.catalogue_offers;
  n integer; added integer:=0; existing integer:=0; skipped integer:=0;
  issues jsonb:='[]'; accepted text[]:='{}'; before_added integer; before_existing integer;
begin
  if current_user not in ('postgres','service_role') or p_user is null
    or not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
  then raise exception 'Catalogue owner required'; end if;
  if p_preview is null or jsonb_typeof(p_videos->'clips') is distinct from 'array'
    or jsonb_typeof(p_offers->'offers') is distinct from 'array'
    or jsonb_array_length(p_videos->'clips')>1000 or jsonb_array_length(p_offers->'offers')>1000
    or octet_length(p_videos::text)+octet_length(p_offers::text)>2000000
  then raise exception 'Invalid desktop registers'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalogue-import:'||p_user::text,0));
  -- Preview exercises the exact constraints, then rolls back this entire subtransaction.
  begin
    for item in select value from jsonb_array_elements(p_videos->'clips') loop
      code:=item->>'clipId';
      begin
        if code is null or code !~ '^(KII|TUU)-V[0-9]{3,}$' then raise exception 'Invalid clip code'; end if;
        if code=any(accepted) then raise exception 'Duplicate clip code in file'; end if;
        model_name:=case when code like 'KII-%' then 'kiikii' else 'tuuva' end;
        destination:=case item->>'channel' when 'PPV' then 'ppv' when 'WALL ONLY' then 'wall'
          when 'UNASSIGNED / REVIEW' then 'unassigned' end;
        if destination is null then raise exception 'Unknown channel; assignment not guessed'; end if;
        if jsonb_typeof(item->'paidOwners') is distinct from 'array'
          or jsonb_typeof(item->'freeRecipients') is distinct from 'array'
          then raise exception 'Missing recipient arrays'; end if;
        select * into clip from public.catalogue_clips where user_id=p_user and clip_code=code for update;
        if found then
          if clip.desktop_source is distinct from item or clip.assignment<>destination
            then raise exception 'Existing clip differs; no overwrite'; end if;
          existing:=existing+1;
        else
          insert into public.catalogue_clips(user_id,model,clip_code,assignment,desktop_source)
            values(p_user,model_name,code,destination,item) returning * into clip;
          added:=added+1;
        end if;
        accepted:=array_append(accepted,code);
      exception when others then
        skipped:=skipped+1; issues:=issues||jsonb_build_array(jsonb_build_object('item',coalesce(code,'clip'),'reason',sqlerrm));
        continue;
      end;
      foreach kind in array array['paid','free'] loop
        for recipient in select value from jsonb_array_elements(item->case kind when 'paid' then 'paidOwners' else 'freeRecipients' end) loop
          begin
            handle:=recipient#>>'{}';
            if jsonb_typeof(recipient)<>'string' or handle !~ '^@[A-Za-z0-9_.-]{1,150}$'
              then raise exception 'Recipient is not a historical handle'; end if;
            insert into public.catalogue_clip_recipients(clip_id,user_id,model,recipient_key,receipt_kind)
              values(clip.id,p_user,model_name,'historical-fanvue-handle:'||lower(handle),kind)
              on conflict do nothing;
            get diagnostics n=row_count;
            added:=added+n; existing:=existing+1-n;
          exception when others then
            skipped:=skipped+1; issues:=issues||jsonb_build_array(jsonb_build_object('item',code||' / '||kind,'reason',sqlerrm));
          end;
        end loop;
      end loop;
      if item ? 'confirmedWallBuyers' and item->'confirmedWallBuyers'<>'[]'::jsonb then
        issues:=issues||jsonb_build_array(jsonb_build_object('item',code,'reason','Wall buyer display names preserved in source only; no identity inferred'));
      end if;
    end loop;
    for offer in select value from jsonb_array_elements(p_offers->'offers') loop
      before_added:=added; before_existing:=existing;
      template_key:=substring(offer->>'template' from '^((KII|TUU)-[0-9]{3,})( |$)');
      begin
        if template_key is null or length(offer->>'template')>160
          or jsonb_typeof(offer->'clipIds') is distinct from 'array'
          then raise exception 'Invalid offer structure'; end if;
        if coalesce(p_offers->'deleted','[]') ? template_key or offer->>'status' is distinct from 'active'
          then raise exception 'Deleted or inactive offer not imported'; end if;
        model_name:=case when template_key like 'KII-%' then 'kiikii' else 'tuuva' end;
        -- Validate the whole bundle first; never silently import a partial bundle.
        for entry in select value from jsonb_array_elements(offer->'clipIds') loop
          code:=entry#>>'{}';
          if not(code=any(accepted)) then raise exception 'Unknown or conflicting bundle clip: %',code; end if;
          select * into clip from public.catalogue_clips where user_id=p_user and clip_code=code;
          if clip.assignment<>'ppv' or clip.model<>model_name then raise exception 'Bundle clip must be PPV and same character: %',code; end if;
          if not coalesce(clip.desktop_source->'currentTemplates','[]') ? template_key
            then raise exception 'Registers disagree about membership: %',code; end if;
        end loop;
        select * into bundle from public.catalogue_offers where user_id=p_user and desktop_key=template_key for update;
        if found then
          if bundle.desktop_source is distinct from offer or bundle.title is distinct from offer->>'template'
            or (select coalesce(jsonb_agg(c.clip_code order by c.clip_code),'[]') from public.catalogue_offer_clips oc
              join public.catalogue_clips c on c.id=oc.clip_id where oc.offer_id=bundle.id)
              is distinct from (select coalesce(jsonb_agg(v order by v),'[]') from
                (select distinct value as v from jsonb_array_elements_text(offer->'clipIds')) s)
            then raise exception 'Existing bundle differs; no overwrite'; end if;
          existing:=existing+1;
        else
          if exists(select 1 from public.catalogue_offers where user_id=p_user and title=offer->>'template')
            then raise exception 'Unmapped existing offer title; manual review required'; end if;
          insert into public.catalogue_offers(user_id,model,title,desktop_key,desktop_source)
            values(p_user,model_name,offer->>'template',template_key,offer) returning * into bundle;
          added:=added+1;
        end if;
        for entry in select value from jsonb_array_elements(offer->'clipIds') loop
          select * into clip from public.catalogue_clips where user_id=p_user and clip_code=entry#>>'{}';
          insert into public.catalogue_offer_clips(offer_id,clip_id,user_id,model)
            values(bundle.id,clip.id,p_user,model_name) on conflict do nothing;
          get diagnostics n=row_count; added:=added+n; existing:=existing+1-n;
        end loop;
      exception when others then
        added:=before_added; existing:=before_existing;
        skipped:=skipped+1; issues:=issues||jsonb_build_array(jsonb_build_object('item',coalesce(template_key,'offer'),'reason',sqlerrm,'source',offer::text));
      end;
    end loop;
    if p_preview then raise sqlstate 'ZX001'; end if;
  exception when sqlstate 'ZX001' then null;
  end;
  return jsonb_build_object('preview',p_preview,'added',added,'existing',existing,'skipped',skipped,'issues',issues,
    'note','Counts include clips, bundles, memberships and recipient records. Handles are historical evidence, not verified permanent fan IDs.');
end $$;
revoke all on function public.import_catalogue_desktop(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.import_catalogue_desktop(uuid,jsonb,jsonb,boolean) to service_role;
