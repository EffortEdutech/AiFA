-- Sprint 68a regression test -- Customer Requests intake and tracking.
-- Paste into the Supabase dashboard SQL editor AFTER applying
-- 00000000000021_sprint68a_requests_intake_and_tracking.sql.
--
-- ONE self-contained block: no temp tables, no reliance on the editor
-- keeping a session open. It ends by raising a deliberate exception, which
-- rolls back every test row, throttle entry and slug change. So the result
-- panel shows an "error" -- read its text:
--   "ALL SPRINT 68a CHECKS PASSED (rolled back)"  = success
--   "FAIL Tn ..."                                 = that check failed
--
-- Not covered (needs a real signed-in session; check in the console once
-- phase B ships): a member WITHOUT Sales view cannot read requests.

do $$
declare
  v_biz   uuid := (select id from public.businesses order by created_at limit 1);
  v_other uuid := (select id from public.businesses order by created_at offset 1 limit 1);
  v_token text;
  v_res   jsonb;
  v_req   uuid;
  v_count int;
  v_hash  text;
  v_ok    jsonb := '{"name":"Test Customer","phone":"60123456789","message":"A long enough message","consent":"true"}'::jsonb;
  v_rfq   jsonb := '{"name":"Test Customer","phone":"60123456789","message":"A long enough message","consent":"true","items":[{"description":"Item","quantity":"2"}]}'::jsonb;
  v_cases jsonb;
  v_case  jsonb;
  v_old   text;
  v_new   text := 'sprint68a-test-' || substr(md5(random()::text), 1, 6);
  v_fail  text;
  i       int;
begin
  if v_biz is null then
    raise exception 'FAIL setup: no business exists to test against';
  end if;

  -- T1 -- anon submits a valid enquiry and gets only a code and token back.
  set local role anon;
  v_res := public.submit_public_request_v2(
    v_biz, 'contact',
    '{"name":"Test Customer","phone":"60123456789","email":"t@example.com","message":"Do you deliver to Shah Alam?","consent":"true"}'::jsonb,
    encode(sha256('t1'::bytea), 'hex'), 'counter');
  reset role;
  if v_res ->> 'reference_code' !~ '^RQ-[A-Z2-9]{6}$' then
    raise exception 'FAIL T1 reference code shape: %', v_res;
  end if;
  if length(v_res ->> 'tracking_token') <> 64 then
    raise exception 'FAIL T1 token length: %', v_res;
  end if;
  if (select count(*) from jsonb_object_keys(v_res)) <> 2 then
    raise exception 'FAIL T1 returned more than code and token: %', v_res;
  end if;
  v_token := v_res ->> 'tracking_token';

  -- T2 -- anon cannot read the tables directly.
  set local role anon;
  begin
    select count(*) into v_count from public.requests;
    if v_count <> 0 then v_fail := 'FAIL T2 anon read requests directly'; end if;
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into v_count from public.request_status_events;
    if v_count <> 0 then v_fail := 'FAIL T2 anon read events directly'; end if;
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into v_count from public.request_throttle;
    if v_count <> 0 then v_fail := 'FAIL T2 anon read throttle directly'; end if;
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into v_count from public.slug_aliases;
    if v_count <> 0 then v_fail := 'FAIL T2 anon read slug aliases directly'; end if;
  exception when insufficient_privilege then null; end;
  reset role;
  if v_fail is not null then raise exception '%', v_fail; end if;

  -- T3/T4 -- the token reveals exactly its own request, no private data.
  set local role anon;
  v_res := public.get_request_tracking(v_token);
  if v_res is null or v_res ->> 'customer_name' <> 'Test Customer' then
    reset role; raise exception 'FAIL T3 token did not return its own request: %', v_res;
  end if;
  if public.get_request_tracking(repeat('a', 64)) is not null then
    reset role; raise exception 'FAIL T3 a made-up token returned data';
  end if;
  if public.get_request_tracking('short') is not null or public.get_request_tracking(null) is not null then
    reset role; raise exception 'FAIL T3 malformed token returned data';
  end if;
  reset role;
  if v_res::text ~* 'customer_phone|customer_email|60123456789|t@example\.com' then
    raise exception 'FAIL T4 tracking leaked contact details: %', v_res;
  end if;
  if jsonb_array_length(v_res -> 'events') <> 1 then
    raise exception 'FAIL T4 expected exactly the public received event: %', v_res -> 'events';
  end if;

  -- T5 -- a private note and a spam mark are invisible to the customer.
  select id into v_req from public.requests where tracking_token = v_token;
  insert into public.request_status_events (request_id, business_id, kind, body, is_public)
  values (v_req, v_biz, 'note', 'private owner note', false);
  if public.get_request_tracking(v_token)::text like '%private owner note%' then
    raise exception 'FAIL T5 private note leaked to tracking page';
  end if;
  update public.requests set status = 'spam' where id = v_req;
  if public.get_request_tracking(v_token) is not null then
    raise exception 'FAIL T5 spam request still reachable by token';
  end if;
  update public.requests set status = 'new' where id = v_req;

  -- T6 -- bad input is rejected on the server.
  v_hash := encode(sha256('t6'::bytea), 'hex');
  v_cases := jsonb_build_array(
    jsonb_build_array('contact', (v_ok || '{"phone":"123"}'::jsonb), 'invalid_phone'),
    jsonb_build_array('contact', (v_ok || '{"name":"A"}'::jsonb), 'invalid_name'),
    jsonb_build_array('contact', (v_ok || '{"message":"short"}'::jsonb), 'invalid_message'),
    jsonb_build_array('contact', (v_ok || '{"consent":"false"}'::jsonb), 'consent_required'),
    jsonb_build_array('contact', (v_ok || '{"email":"not-an-email"}'::jsonb), 'invalid_email'),
    jsonb_build_array('contact', (v_ok || '{"message":"see http://a.com and http://b.com and http://c.com"}'::jsonb), 'too_many_links'),
    jsonb_build_array('rfq', v_ok, 'invalid_items'),
    jsonb_build_array('rfq', (v_rfq || '{"needed_by":"2020-01-01"}'::jsonb), 'invalid_needed_by'),
    jsonb_build_array('po', v_ok, 'invalid_request_type')
  );
  for v_case in select * from jsonb_array_elements(v_cases) loop
    v_fail := null;
    set local role anon;
    begin
      perform public.submit_public_request_v2(v_biz, v_case ->> 0, v_case -> 1, v_hash, null);
      v_fail := 'accepted bad input, expected ' || (v_case ->> 2);
    exception when others then
      if sqlerrm <> v_case ->> 2 then
        v_fail := 'expected "' || (v_case ->> 2) || '" got "' || sqlerrm || '"';
      end if;
    end;
    reset role;
    if v_fail is not null then raise exception 'FAIL T6 %', v_fail; end if;
  end loop;

  -- T7 -- an unknown business fails generically.
  v_fail := null;
  set local role anon;
  begin
    perform public.submit_public_request_v2(gen_random_uuid(), 'contact', v_ok,
      encode(sha256('t7'::bytea), 'hex'), null);
    v_fail := 'unknown business accepted';
  exception when others then
    if sqlerrm <> 'request_failed' then v_fail := 'expected request_failed, got ' || sqlerrm; end if;
  end;
  reset role;
  if v_fail is not null then raise exception 'FAIL T7 %', v_fail; end if;

  -- T8 -- per-source rate limit: the sixth submission in an hour is refused.
  v_hash := encode(sha256('t8'::bytea), 'hex');
  v_fail := null;
  set local role anon;
  for i in 1..5 loop
    perform public.submit_public_request_v2(v_biz, 'contact', v_ok, v_hash, null);
  end loop;
  begin
    perform public.submit_public_request_v2(v_biz, 'contact', v_ok, v_hash, null);
    v_fail := 'sixth submission from one source was accepted';
  exception when others then
    if sqlerrm <> 'rate_limited' then v_fail := 'expected rate_limited, got ' || sqlerrm; end if;
  end;
  reset role;
  if v_fail is not null then raise exception 'FAIL T8 %', v_fail; end if;

  -- T9 -- a renamed slug keeps resolving, and another business cannot take it.
  select slug into v_old from public.businesses where id = v_biz;
  update public.businesses set slug = v_new where id = v_biz;
  if public.resolve_business_slug(v_old) is distinct from v_biz then
    raise exception 'FAIL T9 old slug no longer resolves';
  end if;
  if public.resolve_business_slug(v_new) is distinct from v_biz then
    raise exception 'FAIL T9 new slug does not resolve';
  end if;
  if public.get_current_business_slug(v_old) is distinct from v_new then
    raise exception 'FAIL T9 alias did not report the current slug';
  end if;
  if v_other is not null then
    v_fail := null;
    begin
      update public.businesses set slug = v_old where id = v_other;
      v_fail := 'another business claimed an aliased slug';
    exception when others then
      if sqlerrm <> 'slug_already_taken' then v_fail := 'expected slug_already_taken, got ' || sqlerrm; end if;
    end;
    if v_fail is not null then raise exception 'FAIL T9 %', v_fail; end if;
  end if;

  -- Deliberate exception: rolls back everything above.
  raise exception 'ALL SPRINT 68a CHECKS PASSED (rolled back; nothing was saved)';
end $$;
