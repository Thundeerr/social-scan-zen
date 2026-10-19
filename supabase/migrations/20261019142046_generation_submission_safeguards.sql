-- Read-only preflight, scoped to the authenticated operator by server functions.
create index model_pipeline_jobs_recent_hash
 on public.model_pipeline_jobs(user_id,source_sha256,created_at desc)
 where source_sha256 is not null;

create function public.generation_source_check(p_user uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare matches jsonb; enabled boolean;
begin
 if current_user not in ('service_role','postgres') or p_user is null
 or not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
 then raise exception 'Owner required'; end if;
 select s.enabled into enabled from public.model_pipeline_settings s where s.user_id=p_user;
 if not found then raise exception 'Model pipeline not configured'; end if;
 if p_data->>'kind'='file' then
  if coalesce(p_data->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid hash'; end if;
 elsif p_data->>'kind'='link' then
  if coalesce(p_data->>'shortcode','') !~ '^[A-Za-z0-9_-]{5,64}$' then raise exception 'Invalid Reel'; end if;
 else raise exception 'Invalid source'; end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc),'[]') into matches
 from (
  select j.id,j.model,j.state,j.created_at
  from public.model_pipeline_jobs j
  left join public.reel_inbox_items i on i.id=j.inbox_id and i.user_id=j.user_id
  where j.user_id=p_user and j.created_at>=now()-interval '30 days'
   and ((p_data->>'kind'='file' and j.source_sha256=p_data->>'sha256')
     or (p_data->>'kind'='link' and i.shortcode=p_data->>'shortcode'))
  order by j.created_at desc limit 10
 ) m;
 return jsonb_build_object('id','','duplicates',matches,'enabled',enabled);
end $$;
revoke all on function public.generation_source_check(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.generation_source_check(uuid,jsonb) to service_role;

-- Keep intake semantics and revision constraints intact behind an atomic guard.
alter function public.generation_submit(uuid,text,jsonb) rename to generation_submit_core;
revoke all on function public.generation_submit_core(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.generation_submit(p_user uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare check_result jsonb; result jsonb;
begin
 -- This wrapper is callable only by service_role; preserve owner authorization.
 if p_user is null or not exists(select 1 from public.user_roles where user_id=p_user and role='owner')
 then raise exception 'Owner required'; end if;
 perform 1 from public.model_pipeline_settings where user_id=p_user for update;
 if not found then raise exception 'Model pipeline not configured'; end if;
 if p_action in ('link','upload') then
  check_result:=public.generation_source_check(p_user,
    case when p_action='link' then jsonb_build_object('kind','link','shortcode',p_data->>'shortcode')
    else jsonb_build_object('kind','file','sha256',p_data->>'sha256') end);
  if jsonb_array_length(check_result->'duplicates')>0
   and coalesce((p_data->>'duplicate_confirmed')::boolean,false)=false then
   return check_result||jsonb_build_object('duplicate_warning',true);
  end if;
 end if;
 result:=public.generation_submit_core(p_user,p_action,p_data);
 return result;
end $$;
revoke all on function public.generation_submit(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.generation_submit(uuid,text,jsonb) to service_role;
