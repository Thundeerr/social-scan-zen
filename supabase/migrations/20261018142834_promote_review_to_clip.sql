-- One review can produce at most one permanent catalogue identity.
-- Fails rather than deleting data if pre-existing duplicates exist.
create unique index catalogue_clips_review_unique
  on public.catalogue_clips (review_item_id)
  where review_item_id is not null;

create function public.promote_review_item_to_clip(
  p_user uuid,
  p_review_item_id uuid,
  p_clip_code text,
  p_pipeline_job_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  item public.content_review_items;
  clip public.catalogue_clips;
  source_job uuid;
begin
  -- p_user comes from the authenticated server, never trusted client input.
  if current_user not in ('postgres', 'service_role')
     or p_user is null
     or not exists (
       select 1 from public.user_roles where user_id = p_user and role = 'owner'
     ) then
    raise exception 'Catalogue owner required';
  end if;

  -- Serialize promotion and review edits on the same row.
  select * into item from public.content_review_items
    where id = p_review_item_id and user_id = p_user for update;
  if not found then raise exception 'Review not found'; end if;
  if item.status <> 'approved' then
    raise exception 'Review must be approved';
  end if;
  if p_clip_code is null or not (
    (item.model = 'kiikii' and p_clip_code ~ '^KII-V[0-9]{3,}$') or
    (item.model = 'tuuva' and p_clip_code ~ '^TUU-V[0-9]{3,}$')
  ) then
    raise exception 'Invalid clip code for character';
  end if;

  -- Infer a source job, or verify the explicitly supplied job belongs to this review.
  select id into source_job from public.model_pipeline_jobs
    where review_id = item.id and user_id = p_user and model = item.model
      and (p_pipeline_job_id is null or id = p_pipeline_job_id)
    for share;
  if p_pipeline_job_id is not null and source_job is null then
    raise exception 'Pipeline job does not match review';
  end if;

  select * into clip from public.catalogue_clips where review_item_id = item.id;
  if found then
    if clip.user_id <> p_user or clip.model <> item.model
       or clip.clip_code <> p_clip_code
       or (p_pipeline_job_id is not null
           and clip.pipeline_job_id is distinct from p_pipeline_job_id) then
      raise exception 'Review already promoted with different details';
    end if;
    -- A retry must not reset an existing clip's assignment.
    return to_jsonb(clip);
  end if;

  insert into public.catalogue_clips
    (user_id, model, clip_code, assignment, review_item_id, pipeline_job_id)
    values (p_user, item.model, p_clip_code, 'unassigned', item.id, source_job)
    returning * into clip;
  return to_jsonb(clip);
end $$;

comment on function public.promote_review_item_to_clip(uuid, uuid, text, uuid) is
  'Server-only approved-review promotion. Exact retries return the existing clip; conflicting details fail.';
revoke all on function public.promote_review_item_to_clip(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_review_item_to_clip(uuid, uuid, text, uuid)
  to service_role;
