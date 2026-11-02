-- Additive schema. All writes go through service-only, ownership-checked commands.
create table public.sl_campaigns (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 120), template text not null default '' check(length(template)<=2000),
 status text not null default 'draft' check(status in ('draft','active','paused','archived')),
 created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.sl_batches (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid not null, fingerprint jsonb not null, created_at timestamptz not null default now(),
 foreign key(campaign_id,user_id) references public.sl_campaigns(id,user_id) on delete cascade
);
create table public.sl_recipients (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid not null, handle text not null check(handle ~ '^[a-z0-9._]{1,30}$'), name text not null check(length(name)<=100),
 consent text not null check(consent in ('unknown','granted','revoked')), evidence text not null default '' check(length(evidence)<=500),
 consent_at timestamptz not null default now(), created_at timestamptz not null default now(),
 unique(user_id,campaign_id,handle), unique(id,user_id),
 foreign key(campaign_id,user_id) references public.sl_campaigns(id,user_id) on delete cascade
);
create table public.sl_suppressions (
 user_id uuid not null references auth.users(id) on delete cascade, handle text not null,
 created_at timestamptz not null default now(), primary key(user_id,handle)
);
create table public.sl_links (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid not null, batch_id uuid not null references public.sl_batches(id),
 slug text not null unique check(slug ~ '^[a-f0-9]{32}$'), domain text not null, target text not null check(target ~ '^https://' and length(target)<=2048),
 active boolean not null default true, account_id uuid references public.ig_connections(id) on delete set null,
 recipient_id uuid, created_at timestamptz not null default now(),
 foreign key(campaign_id,user_id) references public.sl_campaigns(id,user_id) on delete cascade,
 foreign key(recipient_id,user_id) references public.sl_recipients(id,user_id), unique(id,user_id)
);
create table public.sl_events (
 id uuid primary key, link_id uuid not null references public.sl_links(id) on delete cascade,
 created_at timestamptz not null default now(), kind text not null check(kind in ('human','bot','preview','unknown')),
 device text not null check(device in ('desktop','mobile','tablet','unknown')), country text not null default 'ZZ' check(country ~ '^[A-Z]{2}$'),
 referrer text not null check(length(referrer)<=253), visitor_hash text check(visitor_hash ~ '^[a-f0-9]{64}$')
);
create table public.sl_messages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid not null, recipient_id uuid not null, link_id uuid not null, body text not null,
 status text not null default 'draft' check(status in ('draft','blocked','sent','failed')),
 error_code text, sent_at timestamptz, created_at timestamptz not null default now(),
 unique(campaign_id,recipient_id), foreign key(campaign_id,user_id) references public.sl_campaigns(id,user_id),
 foreign key(recipient_id,user_id) references public.sl_recipients(id,user_id), foreign key(link_id,user_id) references public.sl_links(id,user_id)
);
create table public.sl_limits (key text primary key, window_start timestamptz not null, hits integer not null);
create index sl_campaigns_owner on public.sl_campaigns(user_id,created_at);
create index sl_links_campaign on public.sl_links(user_id,campaign_id,created_at,id);
create index sl_links_batch on public.sl_links(batch_id);
create index sl_links_account on public.sl_links(account_id);
create index sl_links_recipient on public.sl_links(recipient_id);
create index sl_events_link_time on public.sl_events(link_id,created_at);
create index sl_events_time on public.sl_events(created_at);
create index sl_recipients_campaign on public.sl_recipients(user_id,campaign_id,id);
create index sl_batches_owner_time on public.sl_batches(user_id,created_at);
create index sl_messages_recipient on public.sl_messages(recipient_id);
create index sl_messages_link on public.sl_messages(link_id);
do $$ declare t text; begin
 foreach t in array array['sl_campaigns','sl_batches','sl_recipients','sl_suppressions','sl_links','sl_events','sl_messages','sl_limits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.sl_rate(p_key text,p_max integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer; begin
 if current_user not in ('service_role','postgres') then raise exception 'unauthorized'; end if;
 insert into public.sl_limits values(p_key,clock_timestamp(),1)
 on conflict(key) do update set
 hits=case when sl_limits.window_start < clock_timestamp()-make_interval(secs=>p_seconds) then 1 else sl_limits.hits+1 end,
 window_start=case when sl_limits.window_start < clock_timestamp()-make_interval(secs=>p_seconds) then clock_timestamp() else sl_limits.window_start end
 returning hits into n;
 return n<=p_max;
end $$;

create function public.sl_command(p_user uuid,p_action text,p jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.sl_campaigns; b public.sl_batches; r jsonb; result jsonb; cid uuid; n integer; link public.sl_links; rid uuid;
begin
 if current_user not in ('service_role','postgres') or p_user is null or not exists(select 1 from public.user_roles where user_id=p_user and role in ('owner','cofounder')) then raise exception 'operator required'; end if;
 -- Serialize consent, assignments and drafts for this operator, including opt-outs.
 if p_action not in ('overview','links','recipients') then
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,73));
 end if;
 if p_action='overview' then
 return jsonb_build_object('campaigns',coalesce((select jsonb_agg(x order by x.created_at desc) from (select c.*, (select count(*) from public.sl_links l where l.campaign_id=c.id) link_count from public.sl_campaigns c where c.user_id=p_user) x),'[]'::jsonb),
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
 insert into public.sl_links(user_id,campaign_id,batch_id,slug,domain,target,account_id)
 select p_user,c.id,b.id,replace(gen_random_uuid()::text,'-',''),p->>'domain',p->>'target',(p->>'account')::uuid from generate_series(1,n);
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
 select distinct on(r.id) p_user,c.id,r.id,l.id,replace(replace(c.template,'{{name}}',r.name),'{{link}}',l.domain||'/s/'||l.slug)
 from public.sl_recipients r join public.sl_links l on l.recipient_id=r.id and l.campaign_id=c.id and l.active
 where r.campaign_id=c.id and r.user_id=p_user and r.consent='granted' and not exists(select 1 from public.sl_suppressions s where s.user_id=p_user and s.handle=r.handle)
 order by r.id,l.created_at,l.id on conflict(campaign_id,recipient_id) do nothing;
 return jsonb_build_object('count',(select count(*) from public.sl_messages where campaign_id=c.id));
 end if;
 return jsonb_build_object('total',(select count(*) from public.sl_recipients where campaign_id=c.id),
 'items',coalesce((select jsonb_agg(x) from(select r.*, m.status message_status,m.body,m.error_code,m.sent_at from public.sl_recipients r left join public.sl_messages m on m.recipient_id=r.id and m.campaign_id=c.id where r.campaign_id=c.id order by r.id limit 100 offset coalesce((p->>'offset')::integer,0)) x),'[]'::jsonb));
 end if;
 raise exception 'unknown command';
end $$;

create function public.sl_analytics(p_user uuid,p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; begin
 if current_user not in ('service_role','postgres') or not exists(select 1 from public.user_roles where user_id=p_user and role in ('owner','cofounder')) then raise exception 'operator required'; end if;
 with hits as materialized (
 select e.*,l.campaign_id,l.slug from public.sl_events e join public.sl_links l on l.id=e.link_id
 where l.user_id=p_user and e.created_at >= greatest(now()-interval '30 days',now()-make_interval(days=>least(30,greatest(1,coalesce((p->>'days')::integer,7)))) )
 and (p->>'campaign' is null or l.campaign_id=(p->>'campaign')::uuid)
 and (p->>'account' is null or l.account_id=(p->>'account')::uuid)
 and (p->>'link' is null or l.id=(p->>'link')::uuid)
 and (p->>'device' is null or e.device=p->>'device') and (p->>'country' is null or e.country=p->>'country')
 ) select jsonb_build_object(
 'total',(select count(*) from hits),'human',(select count(*) from hits where kind='human'),
 'bots',(select count(*) from hits where kind in ('bot','preview')),'unknown',(select count(*) from hits where kind='unknown'),
 'unique',(select count(distinct visitor_hash) from hits where kind='human'),
 'unidentified',(select count(*) from hits where kind='human' and visitor_hash is null),
 'timeline',coalesce((select jsonb_agg(x order by x.day) from(select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as "day",count(*) total,count(*) filter(where kind='human') human from hits group by 1) x),'[]'::jsonb),
 'countries',coalesce((select jsonb_agg(x) from(select country label,count(*) count from hits group by 1 order by 2 desc limit 50) x),'[]'::jsonb),
 'devices',coalesce((select jsonb_agg(x) from(select device label,count(*) count from hits group by 1 order by 2 desc) x),'[]'::jsonb),
 'referrers',coalesce((select jsonb_agg(x) from(select referrer label,count(*) count from hits group by 1 order by 2 desc limit 20) x),'[]'::jsonb),
 'top',coalesce((select jsonb_agg(x) from(select link_id,slug,count(*) total,count(*) filter(where kind='human') human from hits group by 1,2 order by 4 desc,3 desc limit 20) x),'[]'::jsonb),
 'campaigns',coalesce((select jsonb_agg(x) from(select h.campaign_id,c.name,count(*) total,count(*) filter(where h.kind='human') human from hits h join public.sl_campaigns c on c.id=h.campaign_id group by 1,2 order by 4 desc) x),'[]'::jsonb)
 ) into result; return result;
end $$;

create function public.sl_purge() returns void language plpgsql security invoker set search_path='' as $$
begin
 if current_user not in ('service_role','postgres') then raise exception 'unauthorized'; end if;
 delete from public.sl_events where created_at<now()-interval '30 days';
 delete from public.sl_limits where window_start<now()-interval '1 day';
end $$;
revoke all on function public.sl_rate(text,integer,integer),public.sl_command(uuid,text,jsonb),public.sl_analytics(uuid,jsonb),public.sl_purge() from public,anon,authenticated;
grant execute on function public.sl_rate(text,integer,integer),public.sl_command(uuid,text,jsonb),public.sl_analytics(uuid,jsonb),public.sl_purge() to service_role;
