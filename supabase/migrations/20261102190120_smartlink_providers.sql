-- Additive provider state; existing links remain ready on InstaScanner.
alter table public.sl_links add column provider text not null default 'instascanner' check(provider in ('instascanner','bitly','tinyurl')),
 add column provider_state text not null default 'ready' check(provider_state in ('ready','pending','processing','failed','uncertain')),
 add column short_url text check(short_url ~ '^https://'), add column provider_error text,
 add column provider_started_at timestamptz;
create index sl_links_provider_queue on public.sl_links(provider,provider_state,created_at);
create or replace function public.sl_command(p_user uuid,p_action text,p jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.sl_campaigns; b public.sl_batches; r jsonb; result jsonb; cid uuid; n integer; link public.sl_links; rid uuid;
begin
 if current_user not in ('service_role','postgres') or p_user is null or not exists(select 1 from public.user_roles where user_id=p_user and role in ('owner','cofounder')) then raise exception 'operator required'; end if;
 -- Serialize consent, assignments and drafts for this operator, including opt-outs.
 if p_action not in ('overview','links','recipients') then
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,73));
 end if;
 if p_action='overview' then
 return jsonb_build_object('campaigns',coalesce((select jsonb_agg(x order by x.created_at desc) from (select campaign_row.*, (select count(*) from public.sl_links l where l.campaign_id=campaign_row.id) link_count from public.sl_campaigns campaign_row where campaign_row.user_id=p_user) x),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',ig_username,'status',status)) from public.ig_connections where user_id=p_user),'[]'::jsonb));
 elsif p_action='create_campaign' then
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,73));
 if (select count(*) from public.sl_campaigns where user_id=p_user)>=500 then raise exception 'campaign limit'; end if;
 insert into public.sl_campaigns(user_id,name,template) values(p_user,p->>'name',p->>'template') returning * into c; return to_jsonb(c);
 elsif p_action='campaign_update' then
 update public.sl_campaigns set name=p->>'name',template=p->>'template',status=p->>'status' where id=(p->>'id')::uuid and user_id=p_user returning * into c;
 if not found then raise exception 'not found'; end if; return to_jsonb(c);
 elsif p_action='generate' then
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,73));
 select * into b from public.sl_batches where id=(p->>'request_id')::uuid;
 if found then
 if b.user_id<>p_user or b.fingerprint<>(p-'action'-'request_id') then raise exception 'idempotency conflict'; end if;
 return jsonb_build_object('batch_id',b.id,'count',(select count(*) from public.sl_links where batch_id=b.id),'replayed',true); end if;
 select * into c from public.sl_campaigns where id=(p->>'campaign')::uuid and user_id=p_user and status<>'archived';
 if not found then raise exception 'campaign not found'; end if;
 n:=(p->>'count')::integer;
 if n is null or n<1 or n>1000 then raise exception 'batch limit'; end if;
 if (select coalesce(sum((fingerprint->>'count')::integer),0) from public.sl_batches where user_id=p_user and created_at>now()-interval '1 hour')+n>5000 then raise exception 'hourly batch limit'; end if;
 if (select count(*) from public.sl_links where user_id=p_user)+n>100000 then raise exception 'link limit'; end if;
 if p->>'account' is not null and not exists(select 1 from public.ig_connections where id=(p->>'account')::uuid and user_id=p_user) then raise exception 'account not found'; end if;
 insert into public.sl_batches(id,user_id,campaign_id,fingerprint) values((p->>'request_id')::uuid,p_user,c.id,p-'action'-'request_id') returning * into b;
 if p?'providers' and (jsonb_typeof(p->'providers')<>'array' or jsonb_array_length(p->'providers') not between 1 and 3) then raise exception 'provider selection'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p->'providers','["instascanner"]')) v where v not in ('instascanner','bitly','tinyurl')) then raise exception 'unknown provider'; end if;
 if (select count(*)<>count(distinct v) from jsonb_array_elements_text(coalesce(p->'providers','["instascanner"]')) v) then raise exception 'duplicate provider'; end if;
 insert into public.sl_links(user_id,campaign_id,batch_id,slug,domain,target,account_id,provider,provider_state)
 select p_user,c.id,b.id,replace(gen_random_uuid()::text,'-',''),p->>'domain',p->>'target',(p->>'account')::uuid,
 coalesce(p->'providers','["instascanner"]')->>((seq-1)%jsonb_array_length(coalesce(p->'providers','["instascanner"]'))),
 case when coalesce(p->'providers','["instascanner"]')->>((seq-1)%jsonb_array_length(coalesce(p->'providers','["instascanner"]')))='instascanner' then 'ready' else 'pending' end
 from generate_series(1,n) seq;
 return jsonb_build_object('batch_id',b.id,'count',n,'replayed',false);
 elsif p_action='links' then
 return jsonb_build_object('total',(select count(*) from public.sl_links where user_id=p_user and (p->>'campaign' is null or campaign_id=(p->>'campaign')::uuid) and (slug like '%'||coalesce(p->>'search','')||'%' or target ilike '%'||coalesce(p->>'search','')||'%')),
 'items',coalesce((select jsonb_agg(x) from (select l.* from public.sl_links l where user_id=p_user and (p->>'campaign' is null or campaign_id=(p->>'campaign')::uuid) and (slug like '%'||coalesce(p->>'search','')||'%' or target ilike '%'||coalesce(p->>'search','')||'%') order by case when p->>'sort'='oldest' then created_at end asc,case when p->>'sort'<>'oldest' then created_at end desc,id limit 100 offset coalesce((p->>'offset')::integer,0)) x),'[]'::jsonb));
 elsif p_action='update_links' then
 if jsonb_array_length(p->'ids') not between 1 and 1000 then raise exception 'batch limit'; end if;
 if exists(select 1 from jsonb_array_elements_text(p->'ids') x where not exists(select 1 from public.sl_links where id=x::uuid and user_id=p_user)) then raise exception 'link not found'; end if;
 if p->>'account' is not null and not exists(select 1 from public.ig_connections where id=(p->>'account')::uuid and user_id=p_user) then raise exception 'account not found'; end if;
 if p->>'recipient' is not null and exists(select 1 from public.sl_links l where l.id in (select value::uuid from jsonb_array_elements_text(p->'ids')) and not exists(select 1 from public.sl_recipients r where r.id=(p->>'recipient')::uuid and r.user_id=p_user and r.campaign_id=l.campaign_id and r.consent='granted' and not exists(select 1 from public.sl_suppressions s where s.user_id=p_user and s.handle=r.handle))) then raise exception 'recipient not authorized'; end if;
 update public.sl_links set active=coalesce((p->>'active')::boolean,active),target=coalesce(p->>'target',target),account_id=case when p?'account' then (p->>'account')::uuid else account_id end,recipient_id=case when p?'recipient' then (p->>'recipient')::uuid else recipient_id end where user_id=p_user and id in(select value::uuid from jsonb_array_elements_text(p->'ids'));
 return '{"ok":true}';
 elsif p_action='suppress' then
 insert into public.sl_suppressions(user_id,handle) values(p_user,lower(ltrim(p->>'handle','@'))) on conflict do nothing;
 update public.sl_recipients set consent='revoked',consent_at=now() where user_id=p_user and handle=lower(ltrim(p->>'handle','@'));
 update public.sl_messages m set status='blocked',error_code='opt_out' where user_id=p_user and status='draft' and recipient_id in(select id from public.sl_recipients where user_id=p_user and handle=lower(ltrim(p->>'handle','@')));
 return '{"ok":true}';
 elsif p_action in ('import_recipients','recipients','drafts','assign_recipients') then
 select * into c from public.sl_campaigns where id=(p->>'campaign')::uuid and user_id=p_user;
 if not found then raise exception 'campaign not found'; end if;
 if p_action='assign_recipients' then
 if c.status in ('paused','archived') then raise exception 'campaign paused'; end if;
 with eligible as (
 select r.id,row_number() over(order by r.created_at,r.id) seq from public.sl_recipients r
 where r.campaign_id=c.id and r.user_id=p_user and r.consent='granted'
 and not exists(select 1 from public.sl_suppressions s where s.user_id=p_user and s.handle=r.handle)
 and not exists(select 1 from public.sl_links l where l.recipient_id=r.id and l.campaign_id=c.id)
 order by r.created_at,r.id limit 1000
 ), available as (
 select id,row_number() over(order by created_at,id) seq from public.sl_links
 where campaign_id=c.id and user_id=p_user and recipient_id is null and active
 order by created_at,id limit 1000
 ), assigned as (
 update public.sl_links l set recipient_id=e.id from eligible e join available a using(seq)
 where l.id=a.id returning l.id
 ) select count(*) into n from assigned;
 return jsonb_build_object('assigned',n);
 elsif p_action='import_recipients' then
 if jsonb_array_length(p->'recipients') not between 1 and 1000 then raise exception 'recipient limit'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,73));
 if (select count(*) from public.sl_recipients where user_id=p_user)+jsonb_array_length(p->'recipients')>100000 then raise exception 'recipient limit'; end if;
 for r in select * from jsonb_array_elements(p->'recipients') loop
 if r->>'consent'='granted' and length(trim(coalesce(r->>'evidence','')))=0 then raise exception 'consent evidence required'; end if;
 insert into public.sl_recipients(user_id,campaign_id,handle,name,consent,evidence)
 values(p_user,c.id,lower(ltrim(r->>'handle','@')),r->>'name',case when exists(select 1 from public.sl_suppressions where user_id=p_user and handle=lower(ltrim(r->>'handle','@'))) then 'revoked' else r->>'consent' end,r->>'evidence')
 on conflict(user_id,campaign_id,handle) do nothing;
 end loop; return '{"ok":true}';
 elsif p_action='drafts' then
 if c.status in ('paused','archived') then raise exception 'campaign paused'; end if;
 insert into public.sl_messages(user_id,campaign_id,recipient_id,link_id,body)
 select distinct on(r.id) p_user,c.id,r.id,l.id,replace(replace(c.template,'{{name}}',r.name),'{{link}}',coalesce(l.short_url,l.domain||'/s/'||l.slug))
 from public.sl_recipients r join public.sl_links l on l.recipient_id=r.id and l.campaign_id=c.id and l.active and l.provider_state='ready'
 where r.campaign_id=c.id and r.user_id=p_user and r.consent='granted' and not exists(select 1 from public.sl_suppressions s where s.user_id=p_user and s.handle=r.handle)
 order by r.id,l.created_at,l.id on conflict(campaign_id,recipient_id) do nothing;
 return jsonb_build_object('count',(select count(*) from public.sl_messages where campaign_id=c.id));
 end if;
 return jsonb_build_object('total',(select count(*) from public.sl_recipients where campaign_id=c.id),
 'items',coalesce((select jsonb_agg(x) from(select r.*, m.status message_status,m.body,m.error_code,m.sent_at from public.sl_recipients r left join public.sl_messages m on m.recipient_id=r.id and m.campaign_id=c.id where r.campaign_id=c.id order by r.id limit 100 offset coalesce((p->>'offset')::integer,0)) x),'[]'::jsonb));
 end if;
 raise exception 'unknown command';
end $$;


create function public.sl_provider_claim(p_user uuid,p_provider text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.sl_links;
begin
 if current_user not in ('postgres','service_role') or p_user is null or not exists(select 1 from public.user_roles where user_id=p_user and role in ('owner','cofounder')) then raise exception 'operator required'; end if;
 if p_provider not in ('bitly','tinyurl') then raise exception 'provider invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_provider,75));
 update public.sl_links set provider_state='uncertain',provider_error='interrupted_request' where provider=p_provider and provider_state='processing' and provider_started_at<now()-interval '2 minutes';
 -- Never retry ambiguous external calls or continue a provider after a platform error.
 if exists(select 1 from public.sl_links where provider=p_provider and (provider_state='processing' or (user_id=p_user and provider_state in ('failed','uncertain')))) then return null; end if;
 select l.* into job from public.sl_links l join public.sl_campaigns c on c.id=l.campaign_id
 where l.user_id=p_user and l.provider=p_provider and l.provider_state='pending' and l.active and c.status not in ('paused','archived')
 order by l.created_at,l.id limit 1 for update of l skip locked;
 if not found then return null; end if;
 update public.sl_links set provider_state='processing',provider_started_at=now() where id=job.id;
 return to_jsonb(job);
end $$;
revoke all on function public.sl_provider_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.sl_provider_claim(uuid,text) to service_role;

create function public.sl_provider_stats(p_user uuid,p jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if current_user not in ('postgres','service_role') or p_user is null or not exists(select 1 from public.user_roles where user_id=p_user and role in ('owner','cofounder')) then raise exception 'operator required'; end if;
 with scope as (
 select l.* from public.sl_links l where l.user_id=p_user
 and (p->>'campaign' is null or l.campaign_id=(p->>'campaign')::uuid)
 and (p->>'account' is null or l.account_id=(p->>'account')::uuid)
 and (p->>'link' is null or l.id=(p->>'link')::uuid)
 ), counts as (
 select s.id,count(e.id) clicks,count(e.id) filter(where e.kind='human') human from scope s left join public.sl_events e
 on e.link_id=s.id and e.created_at>=now()-make_interval(days=>greatest(1,least(30,coalesce((p->>'days')::int,7))))
 and (p->>'device' is null or e.device=p->>'device') and (p->>'country' is null or e.country=p->>'country') group by s.id
 ), grouped as (
 select s.provider,count(*) total,count(*) filter(where provider_state='ready') ready,
 count(*) filter(where provider_state in ('pending','processing')) pending,count(*) filter(where provider_state='failed') failed,
 count(*) filter(where provider_state='uncertain') uncertain,sum(c.clicks) clicks,sum(c.human) human,
 max(provider_error) last_error from scope s join counts c using(id) group by s.provider
 ), top_links as (
 select s.id,s.provider,coalesce(s.short_url,s.domain||'/s/'||s.slug) url,s.target,c.clicks,c.human from scope s join counts c using(id)
 where c.clicks>0 order by c.clicks desc,s.id limit 10
 ) select jsonb_build_object('providers',coalesce((select jsonb_agg(g) from grouped g),'[]'::jsonb),
 'top',coalesce((select jsonb_agg(t order by t.clicks desc,t.id) from top_links t),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.sl_provider_stats(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sl_provider_stats(uuid,jsonb) to service_role;
