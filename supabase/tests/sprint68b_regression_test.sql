-- Sprint 68b/68c regression test -- Requests inbox actions.
-- Paste into the Supabase dashboard SQL editor AFTER applying
-- 00000000000022_sprint68b_requests_inbox_actions.sql (and migration 21).
--
-- One self-contained block, like the 68a test. It signs in as the first
-- business's owner by setting the same session values Supabase sets, runs
-- the owner actions, and ends with a deliberate exception that rolls every
-- test row back. The result panel shows an "error"; read its text:
--   "ALL SPRINT 68b CHECKS PASSED (rolled back; nothing was saved)" = success
--   "FAIL Tn ..."                                                    = a check failed
--
-- Needs: the first business has an active owner membership (every business
-- created through the app does).
--
-- Not covered here (needs real quotation data, check once in the console):
-- linking a real quotation. This test only proves the guard rails (an
-- unknown quotation is refused).

do $$
declare
  v_biz     uuid := (select id from public.businesses order by created_at limit 1);
  v_owner   uuid := (select owner_user_id from public.businesses order by created_at limit 1);
  v_stranger uuid := gen_random_uuid();
  v_res     jsonb;
  v_token   text;
  v_req     uuid;
  v_row     public.requests;
  v_track   jsonb;
  v_count   int;
  v_fail    text;
  v_status  text;
  v_ok      jsonb := '{"name":"Test Customer","phone":"60123456789","message":"A long enough message","consent":"true"}'::jsonb;
begin
  if v_biz is null or v_owner is null then
    raise exception 'FAIL setup: no business with an owner to test against';
  end if;
  if not exists (
    select 1 from public.business_memberships
    where business_id = v_biz and user_id = v_owner and status = 'active'
  ) then
    raise exception 'FAIL setup: the first business has no active owner membership';
  end if;

  -- a customer sends a request
  set local role anon;
  v_res := public.submit_public_request_v2(v_biz, 'contact', v_ok, encode(sha256('b1'::bytea), 'hex'), 'counter');
  reset role;
  v_token := v_res ->> 'tracking_token';
  select id into v_req from public.requests where tracking_token = v_token;

  -- T10 -- a stranger (signed in, not a member) cannot read or act.
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.requests where id = v_req;
  if v_count <> 0 then
    reset role; raise exception 'FAIL T10 a non-member can read the request';
  end if;
  v_fail := null;
  begin
    perform public.mark_request_seen(v_req);
    v_fail := 'a non-member marked a request seen';
  exception when others then
    if sqlerrm <> 'request_not_found' then v_fail := 'expected request_not_found, got ' || sqlerrm; end if;
  end;
  reset role;
  if v_fail is not null then raise exception 'FAIL T10 %', v_fail; end if;

  -- T11 -- anon cannot call the owner actions at all.
  v_fail := null;
  set local role anon;
  begin
    perform public.reply_to_request(v_req, 'hello');
    v_fail := 'anon could call reply_to_request';
  exception when insufficient_privilege then null;
  when others then v_fail := 'unexpected error ' || sqlerrm;
  end;
  reset role;
  if v_fail is not null then raise exception 'FAIL T11 %', v_fail; end if;

  -- sign in as the owner
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T12 -- owner can read the request and mark it seen.
  select count(*) into v_count from public.requests where id = v_req;
  if v_count <> 1 then
    reset role; raise exception 'FAIL T12 owner cannot read the request';
  end if;
  v_row := public.mark_request_seen(v_req);
  if v_row.status <> 'seen' or v_row.seen_at is null then
    reset role; raise exception 'FAIL T12 mark seen did not set status: %', v_row.status;
  end if;
  v_row := public.mark_request_seen(v_req); -- idempotent: no second event
  select count(*) into v_count from public.request_status_events where request_id = v_req and kind = 'seen';
  if v_count <> 1 then
    reset role; raise exception 'FAIL T12 seen event recorded % times', v_count;
  end if;

  -- T13 -- reply is public, replaces status, and rejects bad input.
  v_row := public.reply_to_request(v_req, 'Yes, we deliver to Shah Alam on weekdays.');
  if v_row.status <> 'replied' then
    reset role; raise exception 'FAIL T13 status after reply: %', v_row.status;
  end if;
  v_fail := null;
  begin
    perform public.reply_to_request(v_req, '   ');
    v_fail := 'empty reply accepted';
  exception when others then
    if sqlerrm <> 'invalid_reply' then v_fail := 'expected invalid_reply, got ' || sqlerrm; end if;
  end;
  begin
    perform public.reply_to_request(v_req, repeat('x', 2001));
    v_fail := coalesce(v_fail, 'oversized reply accepted');
  exception when others then
    if sqlerrm <> 'invalid_reply' then v_fail := coalesce(v_fail, 'expected invalid_reply for long text, got ' || sqlerrm); end if;
  end;
  reset role;
  if v_fail is not null then raise exception 'FAIL T13 %', v_fail; end if;

  set local role anon;
  v_track := public.get_request_tracking(v_token);
  reset role;
  if v_track::text not like '%we deliver to Shah Alam%' then
    raise exception 'FAIL T13 reply is not visible on the tracking page: %', v_track;
  end if;
  if v_track ->> 'status' <> 'replied' then
    raise exception 'FAIL T13 tracking status: %', v_track ->> 'status';
  end if;

  -- T14 -- private notes stay private.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  set local role authenticated;
  perform public.add_request_note(v_req, 'secret owner note');
  v_fail := null;
  begin
    perform public.add_request_note(v_req, '');
    v_fail := 'empty note accepted';
  exception when others then
    if sqlerrm <> 'invalid_note' then v_fail := 'expected invalid_note, got ' || sqlerrm; end if;
  end;
  reset role;
  if v_fail is not null then raise exception 'FAIL T14 %', v_fail; end if;
  set local role anon;
  v_track := public.get_request_tracking(v_token);
  reset role;
  if v_track::text like '%secret owner note%' then
    raise exception 'FAIL T14 private note leaked to the tracking page';
  end if;

  -- T15 -- status rules: quoted cannot be set by hand; closing is public;
  -- a reply reopens; spam kills the link and blocks replies.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  set local role authenticated;
  v_fail := null;
  begin
    perform public.set_request_status(v_req, 'quoted');
    v_fail := 'quoted was settable by hand';
  exception when others then
    if sqlerrm <> 'invalid_status' then v_fail := 'expected invalid_status, got ' || sqlerrm; end if;
  end;
  if v_fail is null then
    v_row := public.set_request_status(v_req, 'closed');
    if v_row.status <> 'closed' or v_row.closed_at is null then v_fail := 'close did not set closed_at'; end if;
  end if;
  reset role;
  if v_fail is not null then raise exception 'FAIL T15 %', v_fail; end if;
  set local role anon;
  v_track := public.get_request_tracking(v_token);
  reset role;
  if v_track ->> 'status' <> 'closed' then
    raise exception 'FAIL T15 tracking does not show closed: %', v_track ->> 'status';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  set local role authenticated;
  v_row := public.reply_to_request(v_req, 'Reopening: one more thing.');
  if v_row.status <> 'replied' or v_row.closed_at is not null then
    reset role; raise exception 'FAIL T15 a reply should reopen a closed request: %', v_row.status;
  end if;
  v_row := public.set_request_status(v_req, 'spam');
  v_fail := null;
  begin
    perform public.reply_to_request(v_req, 'should be refused');
    v_fail := 'reply to spam accepted';
  exception when others then
    if sqlerrm <> 'request_is_spam' then v_fail := 'expected request_is_spam, got ' || sqlerrm; end if;
  end;
  reset role;
  if v_fail is not null then raise exception 'FAIL T15 %', v_fail; end if;
  set local role anon;
  v_track := public.get_request_tracking(v_token);
  reset role;
  if v_track is not null then
    raise exception 'FAIL T15 spam request still reachable by token';
  end if;

  -- T16 -- linking: an unknown quotation is refused and nothing changes.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  set local role authenticated;
  perform public.set_request_status(v_req, 'seen');
  v_fail := null;
  begin
    perform public.link_request_quotation(v_req, gen_random_uuid());
    v_fail := 'linked a quotation that does not exist';
  exception when others then
    if sqlerrm <> 'quotation_not_found' then v_fail := 'expected quotation_not_found, got ' || sqlerrm; end if;
  end;
  select status into v_status from public.requests where id = v_req;
  reset role;
  if v_fail is not null then raise exception 'FAIL T16 %', v_fail; end if;
  if v_status = 'quoted' then
    raise exception 'FAIL T16 status changed to quoted without a quotation';
  end if;

  -- T17 -- retention function is not callable by app users.
  v_fail := null;
  set local role authenticated;
  begin
    perform public.purge_old_closed_requests();
    v_fail := 'a signed-in user could run the purge';
  exception when insufficient_privilege then null;
  when others then v_fail := 'unexpected error ' || sqlerrm;
  end;
  reset role;
  if v_fail is not null then raise exception 'FAIL T17 %', v_fail; end if;

  raise exception 'ALL SPRINT 68b CHECKS PASSED (rolled back; nothing was saved)';
end $$;
