-- Sprint 68b/68c -- Requests inbox: owner actions.
--
-- Reading requests and their timeline already works through the sales:view
-- policies added in migration 21. Every WRITE goes through the functions
-- below, so each change also records a timeline event, and nothing the
-- owner does can be forged from the browser.
--
--   mark_request_seen         sales:capture  new -> seen (idempotent)
--   reply_to_request          sales:capture  public reply on the tracking page
--   set_request_status        sales:capture  seen / replied / closed / spam / new
--   add_request_note          sales:capture  private note (never public)
--   link_request_quotation    sales:capture  attach a quotation, status -> quoted
--   purge_old_closed_requests (no grant)     24-month retention; run by the operator
--
-- The Owner role holds every capability, so a solo owner can do all of it.

begin;

-- Shared guard: loads the request, checks the caller may act on it.
create or replace function public._request_for_update(p_request_id uuid)
returns public.requests
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.requests;
begin
  select * into v_row from public.requests where id = p_request_id;
  if not found or not public._has_sales_capability(v_row.business_id, 'capture') then
    -- same answer for "does not exist" and "not yours": no probing.
    raise exception 'request_not_found';
  end if;
  return v_row;
end;
$$;
revoke all on function public._request_for_update(uuid) from public;
grant execute on function public._request_for_update(uuid) to authenticated;

create or replace function public.mark_request_seen(p_request_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.requests := public._request_for_update(p_request_id);
begin
  if v_row.status <> 'new' then
    return v_row; -- already seen, replied, quoted, closed or spam: nothing to do
  end if;
  update public.requests
     set status = 'seen', seen_at = now(), updated_at = now()
   where id = v_row.id
   returning * into v_row;
  insert into public.request_status_events (request_id, business_id, kind, status, is_public, actor_user_id)
  values (v_row.id, v_row.business_id, 'seen', 'seen', true, auth.uid());
  return v_row;
end;
$$;

create or replace function public.reply_to_request(p_request_id uuid, p_body text)
returns public.requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.requests := public._request_for_update(p_request_id);
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid_reply';
  end if;
  if v_row.status = 'spam' then
    raise exception 'request_is_spam';
  end if;
  -- A reply moves new/seen/closed to replied; a quoted request stays quoted.
  update public.requests
     set status = case when status = 'quoted' then status else 'replied' end,
         seen_at = coalesce(seen_at, now()),
         closed_at = null,
         updated_at = now()
   where id = v_row.id
   returning * into v_row;
  insert into public.request_status_events (request_id, business_id, kind, status, body, is_public, actor_user_id)
  values (v_row.id, v_row.business_id, 'reply', v_row.status, v_body, true, auth.uid());
  return v_row;
end;
$$;

create or replace function public.set_request_status(p_request_id uuid, p_status text)
returns public.requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.requests := public._request_for_update(p_request_id);
begin
  if p_status is null or p_status not in ('new', 'seen', 'replied', 'closed', 'spam') then
    raise exception 'invalid_status'; -- quoted is set only by link_request_quotation
  end if;
  if p_status = v_row.status then
    return v_row;
  end if;
  update public.requests
     set status = p_status,
         seen_at = case when p_status <> 'new' then coalesce(seen_at, now()) else seen_at end,
         closed_at = case when p_status in ('closed', 'spam') then now() else null end,
         updated_at = now()
   where id = v_row.id
   returning * into v_row;
  -- Closing is shown to the customer; marking spam or reopening is internal.
  insert into public.request_status_events (request_id, business_id, kind, status, is_public, actor_user_id)
  values (v_row.id, v_row.business_id, 'status', p_status, p_status in ('seen', 'replied', 'closed'), auth.uid());
  return v_row;
end;
$$;

create or replace function public.add_request_note(p_request_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.requests := public._request_for_update(p_request_id);
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid_note';
  end if;
  insert into public.request_status_events (request_id, business_id, kind, body, is_public, actor_user_id)
  values (v_row.id, v_row.business_id, 'note', v_body, false, auth.uid());
  update public.requests set updated_at = now() where id = v_row.id;
end;
$$;

create or replace function public.link_request_quotation(p_request_id uuid, p_quotation_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.requests := public._request_for_update(p_request_id);
begin
  if v_row.status = 'spam' then
    raise exception 'request_is_spam';
  end if;
  -- The quotation must belong to the same business.
  if not exists (
    select 1 from public.quotations q
    where q.id = p_quotation_id and q.business_id = v_row.business_id
  ) then
    raise exception 'quotation_not_found';
  end if;
  update public.requests
     set quotation_id = p_quotation_id,
         status = 'quoted',
         seen_at = coalesce(seen_at, now()),
         closed_at = null,
         updated_at = now()
   where id = v_row.id
   returning * into v_row;
  insert into public.request_status_events (request_id, business_id, kind, status, is_public, actor_user_id)
  values (v_row.id, v_row.business_id, 'quotation', 'quoted', true, auth.uid());
  return v_row;
end;
$$;

-- Retention: closed (and spam) requests older than 24 months are removed.
-- Not granted to anyone; the operator runs it (or schedules it) from the
-- SQL editor. Returns how many requests were removed.
create or replace function public.purge_old_closed_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with gone as (
    delete from public.requests
     where status in ('closed', 'spam')
       and coalesce(closed_at, updated_at) < now() - interval '24 months'
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

revoke all on function public.mark_request_seen(uuid) from public;
revoke all on function public.reply_to_request(uuid, text) from public;
revoke all on function public.set_request_status(uuid, text) from public;
revoke all on function public.add_request_note(uuid, text) from public;
revoke all on function public.link_request_quotation(uuid, uuid) from public;
revoke all on function public.purge_old_closed_requests() from public;
grant execute on function public.mark_request_seen(uuid) to authenticated;
grant execute on function public.reply_to_request(uuid, text) to authenticated;
grant execute on function public.set_request_status(uuid, text) to authenticated;
grant execute on function public.add_request_note(uuid, text) to authenticated;
grant execute on function public.link_request_quotation(uuid, uuid) to authenticated;

commit;
