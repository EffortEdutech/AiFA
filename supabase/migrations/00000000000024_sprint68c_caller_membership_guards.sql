-- Sprint 68c -- caller membership guards (follow-up to migration 23).
--
-- next_document_number() and create_approval_task() (two overloads) are called
-- directly by the app but never checked that the signed-in caller belongs to
-- the business. With a business id, any signed-in user could burn another
-- business's invoice numbers or plant approval tasks in it.
--
-- convert_quotation_to_invoice(_with_credit_override) were reviewed and need no
-- change: _create_invoice_from_quotation already requires the sales:capture
-- capability.
--
-- Approach: keep the original bodies untouched by renaming them to
-- *_unchecked, then put a thin guarded function under the original name and
-- signature. Every existing caller (the app and the other SECURITY DEFINER
-- functions, which have already verified the caller) keeps working. The
-- guard allows: an active member of the business; or an internal / service
-- role call with no end user. It refuses anon and signed-in non-members.

create or replace function public._require_member_or_internal(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    if coalesce(auth.role(), '') in ('anon', 'authenticated') then
      raise exception 'not_authorized: sign in required';
    end if;
    return; -- service role or SQL editor: no end user to check
  end if;
  if not exists (
    select 1 from public.business_memberships bm
    where bm.business_id = p_business_id and bm.user_id = v_uid and bm.status = 'active'
  ) then
    raise exception 'not_authorized: not a member of this business';
  end if;
end;
$$;
revoke all on function public._require_member_or_internal(uuid) from public, anon, authenticated;
grant execute on function public._require_member_or_internal(uuid) to service_role;

-- next_document_number
alter function public.next_document_number(uuid, text) rename to _next_document_number_unchecked;
revoke all on function public._next_document_number_unchecked(uuid, text) from public, anon, authenticated;
grant execute on function public._next_document_number_unchecked(uuid, text) to service_role;

create function public.next_document_number(p_business_id uuid, p_document_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_member_or_internal(p_business_id);
  return public._next_document_number_unchecked(p_business_id, p_document_type);
end;
$$;
revoke all on function public.next_document_number(uuid, text) from public, anon;
grant execute on function public.next_document_number(uuid, text) to authenticated, service_role;

-- create_approval_task, 9-argument overload
alter function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean)
  rename to _create_approval_task_unchecked;
revoke all on function public._create_approval_task_unchecked(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public._create_approval_task_unchecked(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean)
  to service_role;

create function public.create_approval_task(
  p_business_id uuid, p_domain text, p_subject_type text, p_subject_id uuid,
  p_amount numeric, p_ai_draft_summary text, p_ai_confidence numeric,
  p_captured_by_membership_id uuid, p_auto_approved boolean default false
)
returns public.approval_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_member_or_internal(p_business_id);
  return public._create_approval_task_unchecked(
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id, p_auto_approved);
end;
$$;
revoke all on function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean) from public, anon;
grant execute on function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean) to authenticated, service_role;

-- create_approval_task, 10-argument overload (adds p_on_approval_action)
alter function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean, text)
  rename to _create_approval_task_unchecked;
revoke all on function public._create_approval_task_unchecked(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public._create_approval_task_unchecked(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean, text)
  to service_role;

create function public.create_approval_task(
  p_business_id uuid, p_domain text, p_subject_type text, p_subject_id uuid,
  p_amount numeric, p_ai_draft_summary text, p_ai_confidence numeric,
  p_captured_by_membership_id uuid, p_auto_approved boolean default false,
  p_on_approval_action text default null
)
returns public.approval_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_member_or_internal(p_business_id);
  return public._create_approval_task_unchecked(
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id, p_auto_approved, p_on_approval_action);
end;
$$;
revoke all on function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean, text) from public, anon;
grant execute on function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean, text) to authenticated, service_role;
