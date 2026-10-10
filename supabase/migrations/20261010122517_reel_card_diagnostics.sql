-- Shape-only diagnostics: no DM text, titles, signed URLs, tokens or media IDs.
alter table public.reel_inbox_dm_receipts add column diagnostics jsonb;

create function public.reel_inbox_dm_ingest_v2(
  p_receiver text, p_sender text, p_username text, p_hash text,
  p_links jsonb, p_diagnostics jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb; safe jsonb;
begin
  if jsonb_typeof(p_diagnostics) is distinct from 'object'
     or (p_diagnostics->>'outcome') is null
     or (p_diagnostics->>'outcome') not in
       ('link_found','unsupported','no_permalink','attachment_without_link','no_attachment')
     or (p_diagnostics->>'attachment_count')::integer not between 0 and 50
     or (p_diagnostics->>'share_count')::integer not between 0 and 50
     or (p_diagnostics->>'url_count')::integer not between 0 and 100
     or p_diagnostics->>'attachment_count' is null
     or p_diagnostics->>'share_count' is null
     or p_diagnostics->>'url_count' is null
     or p_diagnostics->>'unsupported' is null then
    raise exception 'Invalid diagnostic';
  end if;
  safe := jsonb_build_object(
    'outcome',p_diagnostics->>'outcome',
    'attachment_count',(p_diagnostics->>'attachment_count')::integer,
    'share_count',(p_diagnostics->>'share_count')::integer,
    'url_count',(p_diagnostics->>'url_count')::integer,
    'unsupported',(p_diagnostics->>'unsupported')::boolean
  );
  -- Retain existing identity binding, allowlist, locking and replay protection.
  result := public.reel_inbox_dm_ingest(p_receiver,p_sender,p_username,p_hash,p_links);
  if result ? 'results' then
    update public.reel_inbox_dm_receipts r set diagnostics = safe
      from public.reel_inbox_dm_sources s
      where r.user_id=s.user_id and s.receiver_id=p_receiver
      and r.message_hash=p_hash and r.sender=p_username;
  end if;
  return result;
end $$;
revoke all on function public.reel_inbox_dm_ingest_v2(text,text,text,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.reel_inbox_dm_ingest_v2(text,text,text,text,jsonb,jsonb)
  to service_role;
