-- Existing connections and posts remain explicitly assigned to FollowerStar.
alter table public.ig_connections add column destination text not null default 'followerstar'
  check(destination in ('followerstar','kiikii','tuuva'));
alter table public.ig_connections drop constraint ig_connections_user_id_key;
alter table public.ig_connections add unique(user_id,destination), add unique(user_id,ig_user_id);
grant select(destination) on public.ig_connections to authenticated;
alter table public.ig_oauth_states add column destination text not null default 'followerstar'
  check(destination in ('followerstar','kiikii','tuuva'));
alter table public.content_posts add column destination text not null default 'followerstar'
  check(destination in ('followerstar','kiikii','tuuva'));

-- Legacy browser import stays on FollowerStar. Model posts are created only by
-- the separate reviewed-content handoff; existing posts can never be retargeted.
create function public.guard_content_destination() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.destination<>old.destination then raise exception 'Publishing destination is immutable'; end if;
 if TG_OP='INSERT' and new.destination<>'followerstar' and current_user not in ('postgres','service_role') then raise exception 'Use the model review workflow'; end if;
 return new;
end $$;
revoke all on function public.guard_content_destination() from public,anon,authenticated;
create trigger content_destination_guard before insert or update on public.content_posts
 for each row execute function public.guard_content_destination();

-- Every scheduling path (including existing batch approval) checks the exact
-- destination, not merely the existence of some healthy Instagram connection.
create function public.guard_content_account() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status in ('scheduled','publishing') and not exists(
  select 1 from public.ig_connections c where c.user_id=new.user_id and c.destination=new.destination
   and c.status='active' and c.token_expires_at>greatest(coalesce(new.scheduled_for,now()),now())+interval '1 hour'
 ) then raise exception 'The publishing destination must have its own active Instagram connection'; end if;
 return new;
end $$;
revoke all on function public.guard_content_account() from public,anon,authenticated;
create trigger content_account_guard before insert or update of status,scheduled_for on public.content_posts
 for each row execute function public.guard_content_account();
