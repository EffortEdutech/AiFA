-- BEGIN_TXN_WRAPPER_ADDED
begin;




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "invoice_no" "text" NOT NULL,
    "party_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'issued'::"text" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" NOT NULL,
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "grand_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "source_quotation_id" "uuid",
    "delivery_order_id" "uuid",
    "e_invoice_status" "text" DEFAULT 'not_applicable'::"text" NOT NULL,
    "outstanding_balance" numeric(14,2) DEFAULT 0 NOT NULL,
    "captured_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "agent_party_id" "uuid",
    CONSTRAINT "invoices_e_invoice_status_check" CHECK (("e_invoice_status" = ANY (ARRAY['not_applicable'::"text", 'pending'::"text", 'validated'::"text", 'rejected'::"text"]))),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'sent'::"text", 'partially_paid'::"text", 'paid'::"text", 'overdue'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_create_invoice_from_quotation"("p_quotation_id" "uuid", "p_allow_credit_override" boolean, "p_override_reason" "text") RETURNS "public"."invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_quotation public.quotations;
  v_party public.parties;
  v_caller_membership_id uuid;
  v_invoice_no text;
  v_invoice public.invoices;
  v_due_date date;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_line record;
  v_outstanding numeric;
  v_contract_limit numeric;
  v_effective_limit numeric;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'accepted' then
    raise exception 'quotation_not_accepted: current status %', v_quotation.status;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_quotation.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  select * into v_party from public.parties where id = v_quotation.party_id;
  v_due_date := current_date + coalesce(v_party.credit_terms_days, 0);

  -- Credit limit enforcement — Vol 13_0 §12.1, this plan's one hard
  -- system-level blocking gate. See header notes 5-6.
  select credit_limit_override into v_contract_limit from public.contracts
  where counterparty_id = v_party.id and business_id = v_quotation.business_id
    and status = 'active' and credit_limit_override is not null
  order by created_at desc limit 1;
  v_effective_limit := coalesce(v_contract_limit, v_party.credit_limit);

  if v_effective_limit is not null then
    select coalesce(sum(outstanding_balance), 0) into v_outstanding from public.invoices
    where party_id = v_party.id and business_id = v_quotation.business_id
      and status not in ('draft', 'cancelled', 'paid');

    if (v_outstanding + v_quotation.grand_total) > v_effective_limit then
      if not p_allow_credit_override then
        raise exception 'credit_limit_exceeded: party % outstanding % + new invoice % would exceed effective credit limit %',
          v_party.id, v_outstanding, v_quotation.grand_total, v_effective_limit;
      end if;
      if not public.caller_has_capability(v_quotation.business_id, 'settings', 'configure') then
        raise exception 'not_authorized: credit limit override requires configure on settings';
      end if;
      -- logged below, once the invoice (and its id) exists.
    end if;
  end if;

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (v_quotation.business_id, 'invoice', 'INV', 'never')
  on conflict (business_id, document_type) do nothing;
  v_invoice_no := public.next_document_number(v_quotation.business_id, 'invoice');

  insert into public.invoices (
    business_id, invoice_no, party_id, status, due_date, currency,
    subtotal, tax_total, grand_total, notes, source_quotation_id,
    outstanding_balance, captured_by_membership_id
  ) values (
    v_quotation.business_id, v_invoice_no, v_quotation.party_id, 'issued', v_due_date, v_quotation.currency,
    v_quotation.subtotal, v_quotation.tax_total, v_quotation.grand_total, v_quotation.notes, v_quotation.id,
    v_quotation.grand_total, v_caller_membership_id
  ) returning * into v_invoice;

  if v_effective_limit is not null and p_allow_credit_override
     and (v_outstanding + v_quotation.grand_total) > v_effective_limit then
    insert into public.credit_limit_override_log (
      business_id, invoice_id, party_id, requested_amount, effective_credit_limit,
      outstanding_balance_before, overridden_by_membership_id, reason
    ) values (
      v_quotation.business_id, v_invoice.id, v_party.id, v_quotation.grand_total, v_effective_limit,
      v_outstanding, v_caller_membership_id, p_override_reason
    );
  end if;

  for v_line in select * from public.quotation_lines where quotation_id = v_quotation.id order by line_no loop
    insert into public.invoice_lines (
      invoice_id, line_no, product_id, description, quantity, unit_price, unit_cost, tax_code, discount_amount, line_total
    ) values (
      v_invoice.id, v_line.line_no, v_line.product_id, v_line.description, v_line.quantity, v_line.unit_price,
      v_line.unit_cost, v_line.tax_code, v_line.discount_amount, v_line.line_total
    );
  end loop;

  update public.quotations set status = 'converted_to_invoice', converted_invoice_id = v_invoice.id
  where id = v_quotation.id;

  if v_invoice.grand_total > 0 then
    select id into v_ar_account_id from public.chart_of_accounts
    where business_id = v_quotation.business_id and account_code = '1100';
    select id into v_revenue_account_id from public.chart_of_accounts
    where business_id = v_quotation.business_id and account_code = '4000';
    if v_ar_account_id is null or v_revenue_account_id is null then
      raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing 1100/4000', v_quotation.business_id;
    end if;
    insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
    values
      (v_quotation.business_id, v_ar_account_id, 'debit', v_invoice.grand_total, v_invoice.currency, v_caller_membership_id),
      (v_quotation.business_id, v_revenue_account_id, 'credit', v_invoice.grand_total, v_invoice.currency, v_caller_membership_id);
  end if;

  return v_invoice;
end;
$$;


ALTER FUNCTION "public"."_create_invoice_from_quotation"("p_quotation_id" "uuid", "p_allow_credit_override" boolean, "p_override_reason" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "role_id" "uuid" NOT NULL,
    "party_id" "uuid",
    "approval_limit_myr" numeric(14,2),
    "status" "text" NOT NULL,
    "invited_by_membership_id" "uuid",
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "removed_at" timestamp with time zone,
    "invited_email" "text",
    "owner_label" "text",
    CONSTRAINT "business_memberships_shape_check" CHECK (((("status" = 'invited'::"text") AND ("user_id" IS NULL) AND ("invited_email" IS NOT NULL)) OR (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'removed'::"text"])) AND ("user_id" IS NOT NULL)))),
    CONSTRAINT "business_memberships_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'suspended'::"text", 'removed'::"text"])))
);


ALTER TABLE "public"."business_memberships" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_membership_invitation"("p_business_id" "uuid") RETURNS "public"."business_memberships"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_email text;
  v_before text;
  v_row public.business_memberships;
begin
  select email into v_caller_email from auth.users where id = auth.uid();
  if v_caller_email is null then
    raise exception 'not_authenticated';
  end if;

  v_before := public.effective_access_model(p_business_id);

  update public.business_memberships
  set user_id = auth.uid(),
      status = 'active',
      accepted_at = now()
  where business_id = p_business_id
    and status = 'invited'
    and user_id is null
    and lower(invited_email) = lower(v_caller_email)
  returning * into v_row;

  if not found then
    raise exception 'no_matching_pending_invitation';
  end if;

  perform public.record_access_model_transition_if_changed(
    p_business_id, v_before, 'membership_accepted'
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."accept_membership_invitation"("p_business_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contract_id" "uuid" NOT NULL,
    "alert_type" "text" NOT NULL,
    "trigger_date" "date" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "notified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contract_alerts_alert_type_check" CHECK (("alert_type" = ANY (ARRAY['renewal_upcoming'::"text", 'expiring'::"text", 'expired'::"text"]))),
    CONSTRAINT "contract_alerts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'acknowledged'::"text"])))
);


ALTER TABLE "public"."contract_alerts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acknowledge_contract_alert"("p_alert_id" "uuid") RETURNS "public"."contract_alerts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_business_id uuid; v_row public.contract_alerts;
begin
  select c.business_id into v_business_id from public.contract_alerts ca
  join public.contracts c on c.id = ca.contract_id where ca.id = p_alert_id;
  if v_business_id is null then raise exception 'contract_alert_not_found: %', p_alert_id; end if;
  if not public.caller_has_capability(v_business_id, 'legal_contract', 'capture') then
    raise exception 'not_authorized: requires capture on legal_contract';
  end if;

  update public.contract_alerts set status = 'acknowledged' where id = p_alert_id and status = 'pending'
  returning * into v_row;
  if v_row.id is null then raise exception 'contract_alert_not_pending: %', p_alert_id; end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."acknowledge_contract_alert"("p_alert_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_import_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "source_file_ref" "text" NOT NULL,
    "status" "text" DEFAULT 'parsed'::"text" NOT NULL,
    "row_count" integer DEFAULT 0 NOT NULL,
    "error_count" integer DEFAULT 0 NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_import_batches_status_check" CHECK (("status" = ANY (ARRAY['parsed'::"text", 'applied'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."product_import_batches" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_product_import_batch"("p_batch_id" "uuid") RETURNS "public"."product_import_batches"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_batch public.product_import_batches;
  v_row record;
  v_new_product public.products;
begin
  select * into v_batch from public.product_import_batches where id = p_batch_id;
  if not found then
    raise exception 'import_batch_not_found: %', p_batch_id;
  end if;
  if not public.caller_has_capability(v_batch.business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  for v_row in
    select * from public.product_import_rows
    where batch_id = p_batch_id and parse_status = 'ok' and created_product_id is null
  loop
    insert into public.products (business_id, sku, name, unit_of_measure, cost_source, track_inventory)
    values (v_batch.business_id, v_row.parsed_sku, v_row.parsed_name, v_row.parsed_unit_of_measure, 'manual', false)
    returning * into v_new_product;

    update public.product_import_rows set created_product_id = v_new_product.id where id = v_row.id;
  end loop;

  update public.product_import_batches set status = 'applied' where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;


ALTER FUNCTION "public"."apply_product_import_batch"("p_batch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ar_ageing_detail"("p_business_id" "uuid") RETURNS TABLE("invoice_id" "uuid", "invoice_no" "text", "party_id" "uuid", "due_date" "date", "outstanding_balance" numeric, "days_overdue" integer, "ageing_bucket" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  return query
  select
    i.id,
    i.invoice_no,
    i.party_id,
    i.due_date,
    i.outstanding_balance,
    greatest(0, current_date - i.due_date) as days_overdue,
    case
      when current_date <= i.due_date then 'current'
      when current_date - i.due_date <= 30 then '1-30'
      when current_date - i.due_date <= 60 then '31-60'
      when current_date - i.due_date <= 90 then '61-90'
      else '90+'
    end as ageing_bucket
  from public.invoices i
  where i.business_id = p_business_id
    and i.outstanding_balance > 0
    and i.status not in ('draft', 'cancelled', 'paid')
  order by i.due_date asc;
end;
$$;


ALTER FUNCTION "public"."ar_ageing_detail"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_invoice_agent"("p_invoice_id" "uuid", "p_agent_party_id" "uuid") RETURNS "public"."invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice_not_found: %', p_invoice_id; end if;
  if not public.caller_has_capability(v_invoice.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if not exists (
    select 1 from public.parties where id = p_agent_party_id and business_id = v_invoice.business_id
      and 'agent' = any(party_types)
  ) then
    raise exception 'agent_party_not_found_or_not_an_agent_party: %', p_agent_party_id;
  end if;

  update public.invoices set agent_party_id = p_agent_party_id where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;


ALTER FUNCTION "public"."assign_invoice_agent"("p_invoice_id" "uuid", "p_agent_party_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_vouchers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "pv_no" "text" NOT NULL,
    "payee_party_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "expense_category" "text" NOT NULL,
    "document_id_receipt" "uuid",
    "payment_method" "text" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "grand_total" numeric(14,2) NOT NULL,
    "notes" "text",
    "captured_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sst_code" "text",
    CONSTRAINT "payment_vouchers_grand_total_check" CHECK (("grand_total" > (0)::numeric)),
    CONSTRAINT "payment_vouchers_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::"text", 'bank_transfer'::"text", 'cheque'::"text"]))),
    CONSTRAINT "payment_vouchers_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'rejected'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."payment_vouchers" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."attach_payment_voucher_receipt"("p_payment_voucher_id" "uuid", "p_document_id" "uuid") RETURNS "public"."payment_vouchers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_pv public.payment_vouchers;
begin
  select * into v_pv from public.payment_vouchers where id = p_payment_voucher_id;
  if not found then raise exception 'payment_voucher_not_found: %', p_payment_voucher_id; end if;
  if not public.caller_has_capability(v_pv.business_id, 'expense', 'capture') then
    raise exception 'not_authorized: requires capture on expense';
  end if;
  if not exists (select 1 from public.documents where id = p_document_id and business_id = v_pv.business_id) then
    raise exception 'document_not_found_for_this_business: %', p_document_id;
  end if;
  update public.payment_vouchers set document_id_receipt = p_document_id where id = p_payment_voucher_id
  returning * into v_pv;
  return v_pv;
end;
$$;


ALTER FUNCTION "public"."attach_payment_voucher_receipt"("p_payment_voucher_id" "uuid", "p_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."balance_sheet_summary"("p_business_id" "uuid", "p_as_of_date" "date") RETURNS TABLE("total_assets" numeric, "total_liabilities" numeric, "total_equity" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_assets numeric(14, 2); v_liabilities numeric(14, 2); v_equity numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_assets
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'asset' and le.posted_at < (p_as_of_date + 1);

  select coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end), 0) into v_liabilities
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'liability' and le.posted_at < (p_as_of_date + 1);

  select coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end), 0) into v_equity
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'equity' and le.posted_at < (p_as_of_date + 1);

  return query select v_assets, v_liabilities, v_equity;
end;
$$;


ALTER FUNCTION "public"."balance_sheet_summary"("p_business_id" "uuid", "p_as_of_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_whatsapp_quotation_link"("p_quotation_id" "uuid") RETURNS TABLE("phone_e164" "text", "message_text" "text", "wa_link" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_quotation public.quotations;
  v_party public.parties;
  v_task_status text;
  v_digits text;
  v_message text;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;

  select status into v_task_status from public.approval_tasks
  where subject_type = 'quotation' and subject_id = p_quotation_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'quotation_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;

  select * into v_party from public.parties where id = v_quotation.party_id;
  if v_party.contact_phone is null or btrim(v_party.contact_phone) = '' then
    raise exception 'party_has_no_contact_phone: %', v_party.id;
  end if;

  v_digits := regexp_replace(v_party.contact_phone, '[^0-9]', '', 'g');
  v_message := format(
    'Hi %s, here is your quotation %s from us, total %s %s. Valid until %s. Thank you!',
    v_party.display_name, v_quotation.quotation_no, v_quotation.currency, v_quotation.grand_total,
    coalesce(v_quotation.valid_until::text, 'further notice')
  );

  return query select v_digits, v_message, 'https://wa.me/' || v_digits || '?text=' || replace(replace(v_message, ' ', '%20'), E'\n', '%0A');
end;
$$;


ALTER FUNCTION "public"."build_whatsapp_quotation_link"("p_quotation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."caller_has_capability"("p_business_id" "uuid", "p_domain" "text", "p_capability" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select exists (
    select 1
    from public.business_memberships bm
    join public.role_permissions rp on rp.role_id = bm.role_id
    where bm.business_id = p_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
      and rp.domain = p_domain
      and rp.capability = p_capability
  );
$$;


ALTER FUNCTION "public"."caller_has_capability"("p_business_id" "uuid", "p_domain" "text", "p_capability" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_book_detail"("p_business_id" "uuid", "p_bank_account_id" "uuid", "p_date_from" "date", "p_date_to" "date") RETURNS TABLE("entry_id" "uuid", "posted_at" timestamp with time zone, "direction" "text", "amount" numeric, "running_balance" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_ledger_account_id uuid;
  v_opening_balance numeric(14, 2);
  v_opening_movement numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select ba.ledger_account_id, ba.opening_balance into v_ledger_account_id, v_opening_balance
  from public.bank_accounts ba where ba.id = p_bank_account_id and ba.business_id = p_business_id;
  if v_ledger_account_id is null then
    raise exception 'bank_account_not_found_for_this_business: %', p_bank_account_id;
  end if;

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_opening_movement
  from public.ledger_entries le
  where le.chart_of_accounts_id = v_ledger_account_id and le.posted_at < p_date_from;

  return query
  with in_range as (
    select le.id, le.posted_at, le.direction, le.amount
    from public.ledger_entries le
    where le.chart_of_accounts_id = v_ledger_account_id
      and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1)
    order by le.posted_at asc
  )
  select
    r.id,
    r.posted_at,
    r.direction,
    r.amount,
    v_opening_balance + v_opening_movement + sum(case when r.direction = 'debit' then r.amount else -r.amount end)
      over (order by r.posted_at rows between unbounded preceding and current row)
  from in_range r;
end;
$$;


ALTER FUNCTION "public"."cash_book_detail"("p_business_id" "uuid", "p_bank_account_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_capture_permission"("p_business_id" "uuid", "p_domain_hint" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership record;
  v_domain text;
  v_can_capture boolean;
begin
  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  v_domain := public.map_domain_hint(p_domain_hint);

  if v_domain is null then
    raise exception 'unclassified_domain_hint_cannot_be_captured: %', p_domain_hint;
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = v_domain and rp.capability = 'capture'
  ) into v_can_capture;

  if not v_can_capture then
    raise exception 'not_authorized_to_capture: no capture access to %', v_domain;
  end if;

  return v_membership.membership_id;
end;
$$;


ALTER FUNCTION "public"."check_capture_permission"("p_business_id" "uuid", "p_domain_hint" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_takes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "warehouse_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "counted_at" timestamp with time zone,
    "captured_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_takes_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."stock_takes" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_stock_take"("p_stock_take_id" "uuid") RETURNS "public"."stock_takes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_stock_take public.stock_takes;
  v_caller_membership_id uuid;
  v_line record;
  v_movement_type text;
begin
  select * into v_stock_take from public.stock_takes where id = p_stock_take_id for update;
  if not found then raise exception 'stock_take_not_found: %', p_stock_take_id; end if;
  if not public.caller_has_capability(v_stock_take.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_stock_take.status <> 'in_progress' then
    raise exception 'stock_take_not_in_progress: current status %', v_stock_take.status;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_stock_take.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  for v_line in
    select stl.product_id, stl.variance
    from public.stock_take_lines stl
    where stl.stock_take_id = p_stock_take_id
      and stl.counted_qty is not null and stl.variance is not null and stl.variance <> 0
  loop
    v_movement_type := case when v_line.variance > 0 then 'adjustment_increase' else 'adjustment_decrease' end;

    perform 1 from public.stock_levels
    where product_id = v_line.product_id and warehouse_id = v_stock_take.warehouse_id
    for update;

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type, quantity,
      source_document_type, source_document_id, created_by_membership_id
    ) values (
      v_stock_take.business_id, v_line.product_id, v_stock_take.warehouse_id, v_movement_type, abs(v_line.variance),
      'stock_take', p_stock_take_id, v_caller_membership_id
    );

    update public.stock_levels
    set quantity_on_hand = quantity_on_hand + v_line.variance, last_movement_at = now()
    where product_id = v_line.product_id and warehouse_id = v_stock_take.warehouse_id;
  end loop;

  update public.stock_takes set status = 'completed', counted_at = now()
  where id = p_stock_take_id returning * into v_stock_take;

  return v_stock_take;
end;
$$;


ALTER FUNCTION "public"."complete_stock_take"("p_stock_take_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commission_calculations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "agent_party_id" "uuid" NOT NULL,
    "commission_rule_id" "uuid" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "status" "text" DEFAULT 'computed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "commission_calculations_status_check" CHECK (("status" = ANY (ARRAY['computed'::"text", 'approved'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."commission_calculations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_commission_for_invoice"("p_invoice_id" "uuid", "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."commission_calculations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_invoice public.invoices;
  v_business public.businesses;
  v_caller_membership_id uuid;
  v_rule public.commission_rules;
  v_amount numeric;
  v_margin numeric;
  v_total_qty numeric;
  v_row public.commission_calculations;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice_not_found: %', p_invoice_id; end if;
  if not public.caller_has_capability(v_invoice.business_id, 'commission', 'capture') then
    raise exception 'not_authorized: requires capture on commission';
  end if;
  select * into v_business from public.businesses where id = v_invoice.business_id;
  if v_invoice.status <> v_business.commission_trigger_status then
    raise exception 'invoice_has_not_reached_the_configured_commission_trigger_status: invoice is % but trigger is %',
      v_invoice.status, v_business.commission_trigger_status;
  end if;
  if v_invoice.agent_party_id is null then
    raise exception 'invoice_has_no_assigned_agent: call assign_invoice_agent first';
  end if;
  if exists (select 1 from public.commission_calculations where invoice_id = p_invoice_id) then
    raise exception 'commission_already_computed_for_this_invoice: %', p_invoice_id;
  end if;

  select * into v_rule from public.commission_rules
  where business_id = v_invoice.business_id and applies_to_party_id = v_invoice.agent_party_id
  order by created_at desc limit 1;
  if not found then
    select * into v_rule from public.commission_rules
    where business_id = v_invoice.business_id and applies_to_party_id is null
    order by created_at desc limit 1;
  end if;
  if not found then
    raise exception 'no_commission_rule_found_for_agent_or_business_default: %', v_invoice.agent_party_id;
  end if;

  if v_rule.basis = 'percent_of_invoice' then
    v_amount := round(v_invoice.grand_total * v_rule.rate, 2);
  elsif v_rule.basis = 'percent_of_margin' then
    select coalesce(sum(il.line_total - (il.unit_cost * il.quantity)), 0) into v_margin
    from public.invoice_lines il where il.invoice_id = p_invoice_id;
    v_amount := round(greatest(v_margin, 0) * v_rule.rate, 2);
  elsif v_rule.basis = 'flat_per_unit' then
    select coalesce(sum(il.quantity), 0) into v_total_qty
    from public.invoice_lines il where il.invoice_id = p_invoice_id;
    v_amount := round(v_total_qty * v_rule.rate, 2);
  else
    raise exception 'unrecognised_commission_basis: %', v_rule.basis;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_invoice.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.commission_calculations (business_id, invoice_id, agent_party_id, commission_rule_id, amount)
  values (v_invoice.business_id, p_invoice_id, v_invoice.agent_party_id, v_rule.id, v_amount)
  returning * into v_row;

  perform public.create_approval_task(
    v_invoice.business_id, 'commission', 'commission_calculation', v_row.id, v_amount,
    coalesce(p_ai_draft_summary, 'Commission (' || v_rule.basis || ') for invoice ' || v_invoice.invoice_no || ': ' || v_amount),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."compute_commission_for_invoice"("p_invoice_id" "uuid", "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sst_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "invoice_id" "uuid",
    "payment_voucher_id" "uuid",
    "sst_code" "text" NOT NULL,
    "rate" numeric(5,4) NOT NULL,
    "taxable_amount" numeric(14,2) NOT NULL,
    "sst_amount" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sst_transactions_exactly_one_source" CHECK (((("invoice_id" IS NOT NULL) AND ("payment_voucher_id" IS NULL)) OR (("invoice_id" IS NULL) AND ("payment_voucher_id" IS NOT NULL))))
);


ALTER TABLE "public"."sst_transactions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_sst_for_invoice"("p_invoice_id" "uuid") RETURNS SETOF "public"."sst_transactions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_invoice public.invoices;
  v_line record;
  v_rate public.sst_rates;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then raise exception 'invoice_not_found: %', p_invoice_id; end if;
  if not public.caller_has_capability(v_invoice.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if exists (select 1 from public.sst_transactions where invoice_id = p_invoice_id) then
    raise exception 'sst_already_computed_for_this_invoice: %', p_invoice_id;
  end if;

  for v_line in
    select il.tax_code, il.line_total
    from public.invoice_lines il
    where il.invoice_id = p_invoice_id and il.tax_code is not null and btrim(il.tax_code) <> ''
  loop
    select * into v_rate from public.sst_rates where sst_code = v_line.tax_code;
    if not found then
      continue; -- unrecognised tax_code — skip rather than fail the whole invoice
    end if;

    insert into public.sst_transactions (business_id, invoice_id, sst_code, rate, taxable_amount, sst_amount)
    values (
      v_invoice.business_id, p_invoice_id, v_rate.sst_code, v_rate.rate, v_line.line_total,
      round(v_line.line_total * v_rate.rate, 2)
    );
  end loop;

  return query select * from public.sst_transactions where invoice_id = p_invoice_id;
end;
$$;


ALTER FUNCTION "public"."compute_sst_for_invoice"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_sst_for_payment_voucher"("p_payment_voucher_id" "uuid") RETURNS "public"."sst_transactions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_pv public.payment_vouchers; v_rate public.sst_rates; v_row public.sst_transactions;
begin
  select * into v_pv from public.payment_vouchers where id = p_payment_voucher_id;
  if not found then raise exception 'payment_voucher_not_found: %', p_payment_voucher_id; end if;
  if not public.caller_has_capability(v_pv.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if v_pv.sst_code is null or btrim(v_pv.sst_code) = '' then
    raise exception 'payment_voucher_has_no_sst_code_set: %', p_payment_voucher_id;
  end if;
  if exists (select 1 from public.sst_transactions where payment_voucher_id = p_payment_voucher_id) then
    raise exception 'sst_already_computed_for_this_payment_voucher: %', p_payment_voucher_id;
  end if;

  select * into v_rate from public.sst_rates where sst_code = v_pv.sst_code;
  if not found then
    raise exception 'unrecognised_sst_code_on_payment_voucher: %', v_pv.sst_code;
  end if;

  insert into public.sst_transactions (business_id, payment_voucher_id, sst_code, rate, taxable_amount, sst_amount)
  values (v_pv.business_id, p_payment_voucher_id, v_rate.sst_code, v_rate.rate, v_pv.grand_total, round(v_pv.grand_total * v_rate.rate, 2))
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."compute_sst_for_payment_voucher"("p_payment_voucher_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_statutory_deductions"("p_gross_pay" numeric, "p_as_of" "date" DEFAULT CURRENT_DATE) RETURNS TABLE("epf_employee" numeric, "epf_employer" numeric, "socso_employee" numeric, "socso_employer" numeric, "eis_employee" numeric, "eis_employer" numeric, "pcb_deduction" numeric)
    LANGUAGE "plpgsql"
    AS $$
declare
  v_epf jsonb; v_socso jsonb; v_eis jsonb; v_pcb jsonb;
  v_epf_employee numeric; v_epf_employer numeric;
  v_socso_wage numeric; v_socso_employee numeric; v_socso_employer numeric;
  v_eis_wage numeric; v_eis_employee numeric; v_eis_employer numeric;
  v_annual_gross numeric; v_epf_relief numeric; v_chargeable numeric;
  v_annual_tax numeric := 0;
  v_bracket jsonb;
  v_lower numeric; v_upper numeric; v_rate numeric; v_taxable_in_bracket numeric;
begin
  select rate_rules into v_epf from public.statutory_rate_tables
  where scheme = 'epf' and effective_from <= p_as_of order by effective_from desc limit 1;
  select rate_rules into v_socso from public.statutory_rate_tables
  where scheme = 'socso' and effective_from <= p_as_of order by effective_from desc limit 1;
  select rate_rules into v_eis from public.statutory_rate_tables
  where scheme = 'eis' and effective_from <= p_as_of order by effective_from desc limit 1;
  select rate_rules into v_pcb from public.statutory_rate_tables
  where scheme = 'pcb' and effective_from <= p_as_of order by effective_from desc limit 1;
  if v_epf is null or v_socso is null or v_eis is null or v_pcb is null then
    raise exception 'no_statutory_rate_table_effective_as_of: %', p_as_of;
  end if;

  v_epf_employee := round(p_gross_pay * (v_epf ->> 'employee_rate')::numeric, 2);
  v_epf_employer := round(
    p_gross_pay * (case when p_gross_pay <= (v_epf ->> 'employer_threshold')::numeric
      then (v_epf ->> 'employer_rate_low')::numeric else (v_epf ->> 'employer_rate_high')::numeric end),
    2
  );

  v_socso_wage := least(p_gross_pay, (v_socso ->> 'wage_ceiling')::numeric);
  v_socso_employee := round(v_socso_wage * (v_socso ->> 'employee_rate')::numeric, 2);
  v_socso_employer := round(v_socso_wage * (v_socso ->> 'employer_rate')::numeric, 2);

  v_eis_wage := least(p_gross_pay, (v_eis ->> 'wage_ceiling')::numeric);
  v_eis_employee := round(v_eis_wage * (v_eis ->> 'employee_rate')::numeric, 2);
  v_eis_employer := round(v_eis_wage * (v_eis ->> 'employer_rate')::numeric, 2);

  v_annual_gross := p_gross_pay * 12;
  v_epf_relief := least(v_epf_employee * 12, (v_pcb ->> 'epf_relief_cap')::numeric);
  v_chargeable := greatest(v_annual_gross - v_epf_relief - (v_pcb ->> 'personal_relief')::numeric, 0);

  for v_bracket in select * from jsonb_array_elements(v_pcb -> 'brackets')
  loop
    v_lower := (v_bracket ->> 'lower')::numeric;
    v_upper := nullif(v_bracket ->> 'upper', 'null')::numeric; -- null = unbounded top bracket
    v_rate := (v_bracket ->> 'rate')::numeric;
    if v_chargeable > v_lower then
      v_taxable_in_bracket := least(v_chargeable, coalesce(v_upper, v_chargeable)) - v_lower;
      v_annual_tax := v_annual_tax + (v_taxable_in_bracket * v_rate);
    end if;
  end loop;

  return query select
    v_epf_employee, v_epf_employer, v_socso_employee, v_socso_employer,
    v_eis_employee, v_eis_employer, round(v_annual_tax / 12, 2);
end;
$$;


ALTER FUNCTION "public"."compute_statutory_deductions"("p_gross_pay" numeric, "p_as_of" "date") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_number_sequences" (
    "business_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "prefix" "text" NOT NULL,
    "next_number" integer DEFAULT 1 NOT NULL,
    "reset_period" "text" DEFAULT 'never'::"text" NOT NULL,
    "last_reset_key" "text",
    CONSTRAINT "document_number_sequences_reset_period_check" CHECK (("reset_period" = ANY (ARRAY['never'::"text", 'yearly'::"text", 'monthly'::"text"])))
);


ALTER TABLE "public"."document_number_sequences" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."configure_document_sequence"("p_business_id" "uuid", "p_document_type" "text", "p_prefix" "text", "p_reset_period" "text") RETURNS "public"."document_number_sequences"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_row public.document_number_sequences;
begin
  if not public.caller_has_capability(p_business_id, 'settings', 'configure') then
    raise exception 'not_authorized: requires configure on settings';
  end if;
  if p_reset_period not in ('never', 'yearly', 'monthly') then
    raise exception 'invalid_reset_period: must be never, yearly, or monthly';
  end if;

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, p_document_type, p_prefix, p_reset_period)
  on conflict (business_id, document_type) do update set
    prefix = excluded.prefix,
    reset_period = excluded.reset_period
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."configure_document_sequence"("p_business_id" "uuid", "p_document_type" "text", "p_prefix" "text", "p_reset_period" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_quotation_to_invoice"("p_quotation_id" "uuid") RETURNS "public"."invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  return public._create_invoice_from_quotation(p_quotation_id, false, null);
end;
$$;


ALTER FUNCTION "public"."convert_quotation_to_invoice"("p_quotation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_quotation_to_invoice_with_credit_override"("p_quotation_id" "uuid", "p_override_reason" "text" DEFAULT NULL::"text") RETURNS "public"."invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  return public._create_invoice_from_quotation(p_quotation_id, true, p_override_reason);
end;
$$;


ALTER FUNCTION "public"."convert_quotation_to_invoice_with_credit_override"("p_quotation_id" "uuid", "p_override_reason" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."approval_delegations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "delegator_membership_id" "uuid" NOT NULL,
    "delegate_membership_id" "uuid" NOT NULL,
    "domain_scope" "text",
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone,
    "reason" "text",
    "created_by_membership_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    CONSTRAINT "approval_delegations_domain_scope_check" CHECK (("domain_scope" = ANY (ARRAY['sales'::"text", 'pricing'::"text", 'expense'::"text", 'inventory'::"text", 'accounting_reports'::"text", 'tax_compliance'::"text", 'payroll'::"text", 'hr_attendance_leave'::"text", 'commission'::"text", 'legal_contract'::"text", 'settings'::"text"]))),
    CONSTRAINT "approval_delegations_not_self" CHECK (("delegator_membership_id" <> "delegate_membership_id")),
    CONSTRAINT "approval_delegations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'revoked'::"text"]))),
    CONSTRAINT "approval_delegations_valid_window" CHECK ((("ends_at" IS NULL) OR ("ends_at" > "starts_at")))
);


ALTER TABLE "public"."approval_delegations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_approval_delegation"("p_business_id" "uuid", "p_delegator_membership_id" "uuid", "p_delegate_membership_id" "uuid", "p_domain_scope" "text", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_reason" "text") RETURNS "public"."approval_delegations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_can_configure boolean;
  v_row public.approval_delegations;
begin
  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_caller_membership_id <> p_delegator_membership_id then
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = 'settings' and rp.capability = 'configure'
    ) into v_can_configure;
    if not v_can_configure then
      raise exception 'not_authorized: can only delegate your own authority, unless you have configure on settings';
    end if;
  end if;

  insert into public.approval_delegations (
    business_id, delegator_membership_id, delegate_membership_id, domain_scope,
    starts_at, ends_at, reason, created_by_membership_id, status
  ) values (
    p_business_id, p_delegator_membership_id, p_delegate_membership_id, p_domain_scope,
    coalesce(p_starts_at, now()), p_ends_at, p_reason, v_caller_membership_id, 'active'
  )
  returning * into v_row;

  perform public.resolve_approval_task(t.id)
  from public.approval_tasks t
  where t.business_id = p_business_id
    and t.status = 'pending_approval'
    and (p_domain_scope is null or t.domain = p_domain_scope);

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_approval_delegation"("p_business_id" "uuid", "p_delegator_membership_id" "uuid", "p_delegate_membership_id" "uuid", "p_domain_scope" "text", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_reason" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."approval_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "amount" numeric(14,2),
    "ai_draft_summary" "text",
    "ai_confidence" numeric(5,4),
    "captured_by_membership_id" "uuid",
    "assigned_membership_id" "uuid",
    "resolved_via" "text" NOT NULL,
    "delegated_from_membership_id" "uuid",
    "status" "text" DEFAULT 'pending_approval'::"text" NOT NULL,
    "decided_by_membership_id" "uuid",
    "decided_at" timestamp with time zone,
    "next_action" "text",
    "self_approved_via_escape_valve" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "on_approval_action" "text",
    CONSTRAINT "approval_tasks_domain_check" CHECK (("domain" = ANY (ARRAY['sales'::"text", 'pricing'::"text", 'expense'::"text", 'inventory'::"text", 'accounting_reports'::"text", 'tax_compliance'::"text", 'payroll'::"text", 'hr_attendance_leave'::"text", 'commission'::"text", 'legal_contract'::"text", 'settings'::"text"]))),
    CONSTRAINT "approval_tasks_resolved_via_check" CHECK (("resolved_via" = ANY (ARRAY['direct_permission'::"text", 'delegation'::"text", 'escalation'::"text", 'auto_approved'::"text", 'solo_self_resolved'::"text", 'blocked_awaiting_reviewer'::"text"]))),
    CONSTRAINT "approval_tasks_status_check" CHECK (("status" = ANY (ARRAY['pending_approval'::"text", 'approved'::"text", 'rejected'::"text", 'auto_approved'::"text"])))
);


ALTER TABLE "public"."approval_tasks" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_approval_task"("p_business_id" "uuid", "p_domain" "text", "p_subject_type" "text", "p_subject_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text", "p_ai_confidence" numeric, "p_captured_by_membership_id" "uuid", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."approval_tasks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.approval_tasks;
begin
  if p_auto_approved and p_domain = 'payroll' then
    raise exception 'payroll_never_auto_approves: Vol 13_0 §10 bars payroll from resolved_via = auto_approved regardless of AI confidence';
  end if;

  if p_auto_approved then
    insert into public.approval_tasks (
      business_id, domain, subject_type, subject_id, amount,
      ai_draft_summary, ai_confidence, captured_by_membership_id,
      resolved_via, status, decided_at
    ) values (
      p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
      p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
      'auto_approved', 'auto_approved', now()
    )
    returning * into v_row;
    return v_row;
  end if;

  insert into public.approval_tasks (
    business_id, domain, subject_type, subject_id, amount,
    ai_draft_summary, ai_confidence, captured_by_membership_id,
    resolved_via, status
  ) values (
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
    'escalation', -- placeholder, overwritten by resolve_approval_task below
    'pending_approval'
  )
  returning * into v_row;

  return public.resolve_approval_task(v_row.id);
end;
$$;


ALTER FUNCTION "public"."create_approval_task"("p_business_id" "uuid", "p_domain" "text", "p_subject_type" "text", "p_subject_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text", "p_ai_confidence" numeric, "p_captured_by_membership_id" "uuid", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_approval_task"("p_business_id" "uuid", "p_domain" "text", "p_subject_type" "text", "p_subject_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text", "p_ai_confidence" numeric, "p_captured_by_membership_id" "uuid", "p_auto_approved" boolean DEFAULT false, "p_on_approval_action" "text" DEFAULT NULL::"text") RETURNS "public"."approval_tasks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.approval_tasks;
begin
  if p_auto_approved and p_domain = 'payroll' then
    raise exception 'payroll_never_auto_approves: Vol 13_0 §10 bars payroll from resolved_via = auto_approved regardless of AI confidence';
  end if;

  if p_auto_approved then
    insert into public.approval_tasks (
      business_id, domain, subject_type, subject_id, amount,
      ai_draft_summary, ai_confidence, captured_by_membership_id,
      resolved_via, status, decided_at, on_approval_action
    ) values (
      p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
      p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
      'auto_approved', 'auto_approved', now(), p_on_approval_action
    )
    returning * into v_row;
    return v_row;
  end if;

  insert into public.approval_tasks (
    business_id, domain, subject_type, subject_id, amount,
    ai_draft_summary, ai_confidence, captured_by_membership_id,
    resolved_via, status, on_approval_action
  ) values (
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
    'escalation', -- placeholder, overwritten by resolve_approval_task below
    'pending_approval', p_on_approval_action
  )
  returning * into v_row;

  return public.resolve_approval_task(v_row.id);
end;
$$;


ALTER FUNCTION "public"."create_approval_task"("p_business_id" "uuid", "p_domain" "text", "p_subject_type" "text", "p_subject_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text", "p_ai_confidence" numeric, "p_captured_by_membership_id" "uuid", "p_auto_approved" boolean, "p_on_approval_action" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "employee_party_id" "uuid" NOT NULL,
    "clock_type" "text" NOT NULL,
    "recorded_at" timestamp with time zone NOT NULL,
    "gps_lat" numeric(10,6),
    "gps_lng" numeric(10,6),
    "gps_accuracy_m" numeric(8,2),
    "source" "text" DEFAULT 'mobile_app'::"text" NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attendance_records_clock_type_check" CHECK (("clock_type" = ANY (ARRAY['in'::"text", 'out'::"text"]))),
    CONSTRAINT "attendance_records_source_check" CHECK (("source" = ANY (ARRAY['mobile_app'::"text", 'manual_admin_entry'::"text"])))
);


ALTER TABLE "public"."attendance_records" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_attendance_record"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_clock_type" "text", "p_recorded_at" timestamp with time zone, "p_gps_lat" numeric DEFAULT NULL::numeric, "p_gps_lng" numeric DEFAULT NULL::numeric, "p_gps_accuracy_m" numeric DEFAULT NULL::numeric, "p_source" "text" DEFAULT 'mobile_app'::"text") RETURNS "public"."attendance_records"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_row public.attendance_records;
  v_last_clock_type text;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized: requires capture on hr_attendance_leave';
  end if;
  if p_clock_type not in ('in', 'out') then
    raise exception 'invalid_clock_type: must be in or out';
  end if;
  if p_source not in ('mobile_app', 'manual_admin_entry') then
    raise exception 'invalid_source: must be mobile_app or manual_admin_entry';
  end if;
  if not exists (
    select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
      and 'employee' = any(party_types)
  ) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;

  select clock_type into v_last_clock_type from public.attendance_records
  where employee_party_id = p_employee_party_id
  order by recorded_at desc limit 1;

  if v_last_clock_type is null and p_clock_type <> 'in' then
    raise exception 'cannot_clock_out_before_ever_clocking_in';
  end if;
  if v_last_clock_type is not null and v_last_clock_type = p_clock_type then
    raise exception 'cannot_clock_%_twice_in_a_row: most recent record was already %', p_clock_type, v_last_clock_type;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.attendance_records (
    business_id, employee_party_id, clock_type, recorded_at, gps_lat, gps_lng, gps_accuracy_m, source, created_by_membership_id
  ) values (
    p_business_id, p_employee_party_id, p_clock_type, p_recorded_at, p_gps_lat, p_gps_lng, p_gps_accuracy_m, p_source, v_caller_membership_id
  ) returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_attendance_record"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_clock_type" "text", "p_recorded_at" timestamp with time zone, "p_gps_lat" numeric, "p_gps_lng" numeric, "p_gps_accuracy_m" numeric, "p_source" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "account_name" "text" NOT NULL,
    "ledger_account_id" "uuid" NOT NULL,
    "opening_balance" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bank_accounts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_bank_account"("p_business_id" "uuid", "p_account_name" "text", "p_ledger_account_id" "uuid", "p_opening_balance" numeric) RETURNS "public"."bank_accounts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_row public.bank_accounts;
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if not exists (
    select 1 from public.chart_of_accounts
    where id = p_ledger_account_id and business_id = p_business_id
  ) then
    raise exception 'ledger_account_not_found_for_this_business: %', p_ledger_account_id;
  end if;

  insert into public.bank_accounts (business_id, account_name, ledger_account_id, opening_balance)
  values (p_business_id, p_account_name, p_ledger_account_id, coalesce(p_opening_balance, 0))
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_bank_account"("p_business_id" "uuid", "p_account_name" "text", "p_ledger_account_id" "uuid", "p_opening_balance" numeric) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."businesses" (
    "id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "legal_name" "text",
    "industry" "text",
    "pka_version" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "access_model_override" "text",
    "commission_trigger_status" "text" DEFAULT 'issued'::"text" NOT NULL,
    "ssm_registration_number" "text",
    CONSTRAINT "businesses_access_model_override_check" CHECK (("access_model_override" = ANY (ARRAY['forced_solo'::"text", 'forced_team'::"text"]))),
    CONSTRAINT "businesses_commission_trigger_status_check" CHECK (("commission_trigger_status" = ANY (ARRAY['issued'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."businesses" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_business"("p_legal_name" "text", "p_industry" "text" DEFAULT NULL::"text", "p_ssm_registration_number" "text" DEFAULT NULL::"text") RETURNS "public"."businesses"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_row public.businesses;
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if p_legal_name is null or btrim(p_legal_name) = '' then
    raise exception 'legal_name_required';
  end if;

  if exists (select 1 from public.businesses where id = auth.uid()) then
    raise exception 'business_already_exists_for_this_login';
  end if;

  insert into public.businesses (
    id, owner_user_id, legal_name, industry, ssm_registration_number, pka_version
  )
  values (
    auth.uid(), auth.uid(), btrim(p_legal_name), nullif(btrim(p_industry), ''),
    nullif(btrim(p_ssm_registration_number), ''), 'v2.0'
  )
  returning * into v_row;

  insert into public.business_memberships (
    business_id, user_id, role_id, status, invited_at, accepted_at
  ) values (
    auth.uid(), auth.uid(), v_owner_role_id, 'active', now(), now()
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_business"("p_legal_name" "text", "p_industry" "text", "p_ssm_registration_number" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."capture_triage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "raw_text" "text" NOT NULL,
    "detected_domain" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "capture_triage_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'dismissed'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."capture_triage" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_capture_triage_item"("p_business_id" "uuid", "p_raw_text" "text", "p_detected_domain" "text" DEFAULT NULL::"text") RETURNS "public"."capture_triage"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_row public.capture_triage;
begin
  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';
  if v_caller_membership_id is null then
    raise exception 'not_authorized: no active membership for this business';
  end if;
  if length(trim(p_raw_text)) = 0 then
    raise exception 'raw_text_required';
  end if;

  insert into public.capture_triage (business_id, raw_text, detected_domain, created_by_membership_id)
  values (p_business_id, p_raw_text, p_detected_domain, v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_capture_triage_item"("p_business_id" "uuid", "p_raw_text" "text", "p_detected_domain" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chart_of_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "account_code" "text" NOT NULL,
    "account_name" "text" NOT NULL,
    "account_type" "text" NOT NULL,
    "parent_account_id" "uuid",
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chart_of_accounts_account_type_check" CHECK (("account_type" = ANY (ARRAY['asset'::"text", 'liability'::"text", 'equity'::"text", 'revenue'::"text", 'expense'::"text"])))
);


ALTER TABLE "public"."chart_of_accounts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_chart_of_account"("p_business_id" "uuid", "p_account_code" "text", "p_account_name" "text", "p_account_type" "text", "p_parent_account_id" "uuid") RETURNS "public"."chart_of_accounts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_row public.chart_of_accounts;
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if p_account_type not in ('asset', 'liability', 'equity', 'revenue', 'expense') then
    raise exception 'invalid_account_type: %', p_account_type;
  end if;

  insert into public.chart_of_accounts (business_id, account_code, account_name, account_type, parent_account_id, is_system)
  values (p_business_id, p_account_code, p_account_name, p_account_type, p_parent_account_id, false)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_chart_of_account"("p_business_id" "uuid", "p_account_code" "text", "p_account_name" "text", "p_account_type" "text", "p_parent_account_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "employee_party_id" "uuid" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "category" "text" NOT NULL,
    "status" "text" DEFAULT 'pending_approval'::"text" NOT NULL,
    "document_id_receipt" "uuid",
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "claims_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "claims_status_check" CHECK (("status" = ANY (ARRAY['pending_approval'::"text", 'approved'::"text", 'included_in_payroll'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."claims" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_claim"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_amount" numeric, "p_category" "text", "p_document_id_receipt" "uuid" DEFAULT NULL::"uuid", "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."claims"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_caller_membership_id uuid; v_row public.claims;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if not exists (select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
    and 'employee' = any(party_types)) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.claims (business_id, employee_party_id, amount, category, document_id_receipt, created_by_membership_id)
  values (p_business_id, p_employee_party_id, p_amount, p_category, p_document_id_receipt, v_caller_membership_id)
  returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'payroll', 'claim', v_row.id, v_row.amount,
    coalesce(p_ai_draft_summary, 'Claim (' || p_category || ') for ' || v_row.amount),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_claim"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_amount" numeric, "p_category" "text", "p_document_id_receipt" "uuid", "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commission_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "applies_to_party_id" "uuid",
    "basis" "text" NOT NULL,
    "rate" numeric(10,4) NOT NULL,
    "product_scope" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "commission_rules_basis_check" CHECK (("basis" = ANY (ARRAY['percent_of_invoice'::"text", 'percent_of_margin'::"text", 'flat_per_unit'::"text"]))),
    CONSTRAINT "commission_rules_rate_check" CHECK (("rate" >= (0)::numeric))
);


ALTER TABLE "public"."commission_rules" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_commission_rule"("p_business_id" "uuid", "p_basis" "text", "p_rate" numeric, "p_applies_to_party_id" "uuid" DEFAULT NULL::"uuid", "p_product_scope" "text" DEFAULT NULL::"text") RETURNS "public"."commission_rules"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.commission_rules;
begin
  if not public.caller_has_capability(p_business_id, 'commission', 'configure') then
    raise exception 'not_authorized: requires configure on commission';
  end if;
  if p_basis not in ('percent_of_invoice', 'percent_of_margin', 'flat_per_unit') then
    raise exception 'invalid_basis: %', p_basis;
  end if;
  if p_applies_to_party_id is not null and not exists (
    select 1 from public.parties where id = p_applies_to_party_id and business_id = p_business_id and 'agent' = any(party_types)
  ) then
    raise exception 'applies_to_party_not_found_or_not_an_agent_party: %', p_applies_to_party_id;
  end if;

  insert into public.commission_rules (business_id, applies_to_party_id, basis, rate, product_scope)
  values (p_business_id, p_applies_to_party_id, p_basis, p_rate, p_product_scope)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_commission_rule"("p_business_id" "uuid", "p_basis" "text", "p_rate" numeric, "p_applies_to_party_id" "uuid", "p_product_scope" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contracts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "counterparty_id" "uuid" NOT NULL,
    "contract_type" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "auto_renew" boolean DEFAULT false NOT NULL,
    "renewal_notice_days" integer,
    "document_id" "uuid",
    "credit_limit_override" numeric(14,2),
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contracts_check" CHECK ((("end_date" IS NULL) OR ("start_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "contracts_contract_type_check" CHECK (("contract_type" = ANY (ARRAY['distributor_agreement'::"text", 'nda'::"text", 'employment_contract'::"text", 'other'::"text"]))),
    CONSTRAINT "contracts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_signature'::"text", 'active'::"text", 'expired'::"text", 'terminated'::"text"])))
);


ALTER TABLE "public"."contracts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_contract"("p_business_id" "uuid", "p_counterparty_id" "uuid", "p_contract_type" "text", "p_start_date" "date", "p_end_date" "date", "p_auto_renew" boolean, "p_renewal_notice_days" integer, "p_document_id" "uuid" DEFAULT NULL::"uuid", "p_credit_limit_override" numeric DEFAULT NULL::numeric, "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."contracts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_row public.contracts;
  v_trigger_date date;
  v_alert_type text;
begin
  if not public.caller_has_capability(p_business_id, 'legal_contract', 'capture') then
    raise exception 'not_authorized: requires capture on legal_contract';
  end if;
  if p_contract_type not in ('distributor_agreement', 'nda', 'employment_contract', 'other') then
    raise exception 'invalid_contract_type: %', p_contract_type;
  end if;
  if not exists (select 1 from public.parties where id = p_counterparty_id and business_id = p_business_id) then
    raise exception 'counterparty_not_found_for_this_business: %', p_counterparty_id;
  end if;
  if p_document_id is not null and not exists (
    select 1 from public.documents where id = p_document_id and business_id = p_business_id
  ) then
    raise exception 'document_not_found_for_this_business: %', p_document_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.contracts (
    business_id, counterparty_id, contract_type, start_date, end_date, auto_renew,
    renewal_notice_days, document_id, credit_limit_override, created_by_membership_id
  ) values (
    p_business_id, p_counterparty_id, p_contract_type, p_start_date, p_end_date, p_auto_renew,
    p_renewal_notice_days, p_document_id, p_credit_limit_override, v_caller_membership_id
  ) returning * into v_row;

  -- ContractAlert generation — see header note 4.
  if p_end_date is not null and p_renewal_notice_days is not null then
    v_trigger_date := p_end_date - p_renewal_notice_days;
    v_alert_type := case when p_auto_renew then 'renewal_upcoming' else 'expiring' end;
    insert into public.contract_alerts (contract_id, alert_type, trigger_date)
    values (v_row.id, v_alert_type, v_trigger_date);
  end if;

  perform public.create_approval_task(
    p_business_id, 'legal_contract', 'contract', v_row.id, p_credit_limit_override,
    coalesce(p_ai_draft_summary, 'Contract (' || p_contract_type || ') with counterparty ' || p_counterparty_id),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_contract"("p_business_id" "uuid", "p_counterparty_id" "uuid", "p_contract_type" "text", "p_start_date" "date", "p_end_date" "date", "p_auto_renew" boolean, "p_renewal_notice_days" integer, "p_document_id" "uuid", "p_credit_limit_override" numeric, "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "credit_note_no" "text" NOT NULL,
    "party_id" "uuid" NOT NULL,
    "source_invoice_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "grand_total" numeric(14,2) NOT NULL,
    "reason" "text",
    "captured_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_notes_grand_total_check" CHECK (("grand_total" > (0)::numeric)),
    CONSTRAINT "credit_notes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'rejected'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."credit_notes" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_credit_note"("p_business_id" "uuid", "p_source_invoice_id" "uuid", "p_grand_total" numeric, "p_reason" "text", "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."credit_notes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_invoice public.invoices;
  v_credit_note_no text;
  v_row public.credit_notes;
  v_total_paid numeric(14, 2);
  v_total_credited numeric(14, 2);
begin
  if not (
    public.caller_has_capability(p_business_id, 'sales', 'capture')
    or public.caller_has_capability(p_business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on sales, or configure on accounting_reports';
  end if;
  if p_grand_total is null or p_grand_total <= 0 then
    raise exception 'invalid_grand_total: must be positive';
  end if;

  select * into v_invoice from public.invoices where id = p_source_invoice_id and business_id = p_business_id;
  if not found then
    raise exception 'invoice_not_found_for_this_business: %', p_source_invoice_id;
  end if;

  select coalesce(sum(amount), 0) into v_total_paid from public.payments where invoice_id = p_source_invoice_id;
  select coalesce(sum(grand_total), 0) into v_total_credited
    from public.credit_notes where source_invoice_id = p_source_invoice_id and status = 'issued';
  if v_total_paid + v_total_credited + p_grand_total > v_invoice.grand_total then
    raise exception 'credit_note_exceeds_outstanding_balance: invoice % has % remaining, credit note of % would exceed it',
      p_source_invoice_id, v_invoice.grand_total - v_total_paid - v_total_credited, p_grand_total;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'credit_note', 'CN', 'never')
  on conflict (business_id, document_type) do nothing;
  v_credit_note_no := public.next_document_number(p_business_id, 'credit_note');

  insert into public.credit_notes (
    business_id, credit_note_no, party_id, source_invoice_id, grand_total, reason, captured_by_membership_id
  ) values (
    p_business_id, v_credit_note_no, v_invoice.party_id, p_source_invoice_id, p_grand_total, p_reason, v_caller_membership_id
  ) returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'sales', 'credit_note', v_row.id, v_row.grand_total,
    coalesce(p_ai_draft_summary, 'Credit note ' || v_credit_note_no || ' for ' || v_row.grand_total || ' ' || v_row.currency
      || ' against invoice ' || v_invoice.invoice_no),
    null, v_caller_membership_id, p_auto_approved, 'post credit note'
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_credit_note"("p_business_id" "uuid", "p_source_invoice_id" "uuid", "p_grand_total" numeric, "p_reason" "text", "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "do_no" "text" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "warehouse_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "notes" "text",
    "captured_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "delivery_orders_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'dispatched'::"text", 'delivered'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."delivery_orders" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_delivery_order"("p_business_id" "uuid", "p_invoice_id" "uuid", "p_warehouse_id" "uuid", "p_lines" "jsonb", "p_notes" "text" DEFAULT NULL::"text", "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."delivery_orders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_do_no text;
  v_row public.delivery_orders;
  v_invoice public.invoices;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and business_id = p_business_id;
  if not found then raise exception 'invoice_not_found_for_this_business: %', p_invoice_id; end if;
  if v_invoice.delivery_order_id is not null then
    raise exception 'invoice_already_has_a_delivery_order: %', v_invoice.delivery_order_id;
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'delivery_order', 'DO', 'never')
  on conflict (business_id, document_type) do nothing;
  v_do_no := public.next_document_number(p_business_id, 'delivery_order');

  insert into public.delivery_orders (business_id, do_no, invoice_id, warehouse_id, notes, captured_by_membership_id)
  values (p_business_id, v_do_no, p_invoice_id, p_warehouse_id, p_notes, v_caller_membership_id)
  returning * into v_row;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;

    if v_product_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'line_%_needs_a_product_id_and_a_positive_quantity', v_line_no;
    end if;
    if not exists (select 1 from public.products where id = v_product_id and business_id = p_business_id) then
      raise exception 'line_%_product_not_found_for_this_business: %', v_line_no, v_product_id;
    end if;

    insert into public.delivery_order_lines (delivery_order_id, line_no, product_id, quantity)
    values (v_row.id, v_line_no, v_product_id, v_quantity);
  end loop;

  update public.invoices set delivery_order_id = v_row.id where id = p_invoice_id;

  perform public.create_approval_task(
    p_business_id, 'inventory', 'delivery_order', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Delivery order ' || v_do_no || ' for invoice ' || v_invoice.invoice_no
      || ' (' || v_line_no || ' line(s))'),
    null, v_caller_membership_id, p_auto_approved, 'dispatch'
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_delivery_order"("p_business_id" "uuid", "p_invoice_id" "uuid", "p_warehouse_id" "uuid", "p_lines" "jsonb", "p_notes" "text", "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "storage_ref" "text" NOT NULL,
    "content_type" "text",
    "uploaded_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_document"("p_business_id" "uuid", "p_storage_ref" "text", "p_content_type" "text") RETURNS "public"."documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_caller_membership_id uuid; v_row public.documents;
begin
  if not (
    public.caller_has_capability(p_business_id, 'expense', 'capture')
    or public.caller_has_capability(p_business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on expense, or configure on accounting_reports';
  end if;
  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';
  insert into public.documents (business_id, storage_ref, content_type, uploaded_by_membership_id)
  values (p_business_id, p_storage_ref, p_content_type, v_caller_membership_id)
  returning * into v_row;
  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_document"("p_business_id" "uuid", "p_storage_ref" "text", "p_content_type" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."e_invoice_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "invoice_id" "uuid",
    "lhdn_uuid" "text",
    "qr_code_ref" "text",
    "submission_type" "text" NOT NULL,
    "consolidated_period" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "irb_response_ref" "text",
    "submitted_at" timestamp with time zone,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "e_invoice_submissions_normal_has_invoice" CHECK (((("submission_type" = 'normal'::"text") AND ("invoice_id" IS NOT NULL) AND ("consolidated_period" IS NULL)) OR (("submission_type" = 'consolidated'::"text") AND ("invoice_id" IS NULL) AND ("consolidated_period" IS NOT NULL)))),
    CONSTRAINT "e_invoice_submissions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'validated'::"text", 'rejected'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "e_invoice_submissions_submission_type_check" CHECK (("submission_type" = ANY (ARRAY['normal'::"text", 'consolidated'::"text"])))
);


ALTER TABLE "public"."e_invoice_submissions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_einvoice_submission"("p_business_id" "uuid", "p_invoice_id" "uuid") RETURNS "public"."e_invoice_submissions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_caller_membership_id uuid; v_row public.e_invoice_submissions;
begin
  if not public.caller_has_capability(p_business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id and business_id = p_business_id) then
    raise exception 'invoice_not_found_for_this_business: %', p_invoice_id;
  end if;
  if exists (
    select 1 from public.e_invoice_submissions
    where invoice_id = p_invoice_id and status not in ('rejected', 'cancelled')
  ) then
    raise exception 'invoice_already_has_an_active_einvoice_submission: %', p_invoice_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.e_invoice_submissions (business_id, invoice_id, submission_type, created_by_membership_id)
  values (p_business_id, p_invoice_id, 'normal', v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_einvoice_submission"("p_business_id" "uuid", "p_invoice_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "party_id" "uuid" NOT NULL,
    "ic_number_encrypted" "bytea" NOT NULL,
    "epf_number_encrypted" "bytea",
    "socso_number_encrypted" "bytea",
    "income_tax_no_encrypted" "bytea",
    "bank_name" "text",
    "bank_account_no_encrypted" "bytea" NOT NULL,
    "basic_salary" numeric(14,2) NOT NULL,
    "employment_type" "text" NOT NULL,
    "hire_date" "date" NOT NULL,
    "resign_date" "date",
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_profiles_basic_salary_check" CHECK (("basic_salary" >= (0)::numeric)),
    CONSTRAINT "employee_profiles_employment_type_check" CHECK (("employment_type" = ANY (ARRAY['full_time'::"text", 'part_time'::"text", 'contract'::"text"])))
);


ALTER TABLE "public"."employee_profiles" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_employee_profile"("p_business_id" "uuid", "p_party_id" "uuid", "p_ic_number" "text", "p_epf_number" "text", "p_socso_number" "text", "p_income_tax_no" "text", "p_bank_name" "text", "p_bank_account_no" "text", "p_basic_salary" numeric, "p_employment_type" "text", "p_hire_date" "date", "p_encryption_key" "text") RETURNS "public"."employee_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_row public.employee_profiles;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if p_encryption_key is null or btrim(p_encryption_key) = '' then
    raise exception 'encryption_key_required';
  end if;
  if not exists (
    select 1 from public.parties where id = p_party_id and business_id = p_business_id
      and 'employee' = any(party_types)
  ) then
    raise exception 'party_not_found_or_not_an_employee_party: %', p_party_id;
  end if;
  if exists (select 1 from public.employee_profiles where party_id = p_party_id) then
    raise exception 'employee_profile_already_exists_for_this_party: %', p_party_id;
  end if;
  if p_employment_type not in ('full_time', 'part_time', 'contract') then
    raise exception 'invalid_employment_type: %', p_employment_type;
  end if;
  if p_ic_number is null or p_bank_account_no is null then
    raise exception 'ic_number_and_bank_account_no_required';
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.employee_profiles (
    business_id, party_id, ic_number_encrypted, epf_number_encrypted, socso_number_encrypted,
    income_tax_no_encrypted, bank_name, bank_account_no_encrypted, basic_salary, employment_type,
    hire_date, created_by_membership_id
  ) values (
    p_business_id, p_party_id,
    pgp_sym_encrypt(p_ic_number, p_encryption_key),
    case when p_epf_number is not null then pgp_sym_encrypt(p_epf_number, p_encryption_key) end,
    case when p_socso_number is not null then pgp_sym_encrypt(p_socso_number, p_encryption_key) end,
    case when p_income_tax_no is not null then pgp_sym_encrypt(p_income_tax_no, p_encryption_key) end,
    p_bank_name, pgp_sym_encrypt(p_bank_account_no, p_encryption_key), p_basic_salary, p_employment_type,
    p_hire_date, v_caller_membership_id
  ) returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_employee_profile"("p_business_id" "uuid", "p_party_id" "uuid", "p_ic_number" "text", "p_epf_number" "text", "p_socso_number" "text", "p_income_tax_no" "text", "p_bank_name" "text", "p_bank_account_no" "text", "p_basic_salary" numeric, "p_employment_type" "text", "p_hire_date" "date", "p_encryption_key" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."e_signature_envelopes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "contract_id" "uuid",
    "quotation_id" "uuid",
    "provider" "text" DEFAULT 'generic'::"text" NOT NULL,
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "signed_document_id" "uuid",
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "e_signature_envelopes_check" CHECK (((("contract_id" IS NOT NULL) AND ("quotation_id" IS NULL)) OR (("contract_id" IS NULL) AND ("quotation_id" IS NOT NULL)))),
    CONSTRAINT "e_signature_envelopes_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'viewed'::"text", 'signed'::"text", 'declined'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."e_signature_envelopes" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_esignature_envelope"("p_contract_id" "uuid" DEFAULT NULL::"uuid", "p_quotation_id" "uuid" DEFAULT NULL::"uuid", "p_provider" "text" DEFAULT 'generic'::"text") RETURNS "public"."e_signature_envelopes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_business_id uuid;
  v_caller_membership_id uuid;
  v_row public.e_signature_envelopes;
  v_contract public.contracts;
  v_quotation public.quotations;
begin
  if (p_contract_id is null) = (p_quotation_id is null) then
    raise exception 'exactly_one_of_contract_id_or_quotation_id_required';
  end if;

  if p_contract_id is not null then
    select * into v_contract from public.contracts where id = p_contract_id for update;
    if not found then raise exception 'contract_not_found: %', p_contract_id; end if;
    if not public.caller_has_capability(v_contract.business_id, 'legal_contract', 'capture') then
      raise exception 'not_authorized: requires capture on legal_contract';
    end if;
    if v_contract.status <> 'pending_signature' then
      raise exception 'contract_not_ready_for_signature: current status %', v_contract.status;
    end if;
    v_business_id := v_contract.business_id;
  else
    select * into v_quotation from public.quotations where id = p_quotation_id for update;
    if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
    if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
      raise exception 'not_authorized: requires capture on sales';
    end if;
    if v_quotation.status <> 'sent' then
      raise exception 'quotation_not_ready_for_signature: current status %', v_quotation.status;
    end if;
    v_business_id := v_quotation.business_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.e_signature_envelopes (business_id, contract_id, quotation_id, provider, created_by_membership_id)
  values (v_business_id, p_contract_id, p_quotation_id, coalesce(nullif(p_provider, ''), 'generic'), v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_esignature_envelope"("p_contract_id" "uuid", "p_quotation_id" "uuid", "p_provider" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "employee_party_id" "uuid" NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'pending_approval'::"text" NOT NULL,
    "approved_by" "uuid",
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "leave_applications_check" CHECK (("end_date" >= "start_date")),
    CONSTRAINT "leave_applications_status_check" CHECK (("status" = ANY (ARRAY['pending_approval'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."leave_applications" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_leave_application"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_leave_type_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."leave_applications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_row public.leave_applications;
  v_days numeric;
  v_balance public.leave_balances;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized: requires capture on hr_attendance_leave';
  end if;
  if not exists (
    select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
      and 'employee' = any(party_types)
  ) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;
  if not exists (select 1 from public.leave_types where id = p_leave_type_id and business_id = p_business_id) then
    raise exception 'leave_type_not_found_for_this_business: %', p_leave_type_id;
  end if;

  v_days := (p_end_date - p_start_date) + 1;

  select * into v_balance from public.leave_balances
  where employee_party_id = p_employee_party_id and leave_type_id = p_leave_type_id
    and year = extract(year from p_start_date)::integer;
  if not found or (v_balance.entitled_days - v_balance.used_days) < v_days then
    raise exception 'insufficient_leave_balance: requested % days, % available', v_days,
      coalesce(v_balance.entitled_days - v_balance.used_days, 0);
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.leave_applications (
    business_id, employee_party_id, leave_type_id, start_date, end_date, created_by_membership_id
  ) values (
    p_business_id, p_employee_party_id, p_leave_type_id, p_start_date, p_end_date, v_caller_membership_id
  ) returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'hr_attendance_leave', 'leave_application', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Leave application ' || p_start_date || ' to ' || p_end_date || ' (' || v_days || ' days)'),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_leave_application"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_leave_type_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "default_entitlement_days" numeric(6,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "leave_types_default_entitlement_days_check" CHECK (("default_entitlement_days" >= (0)::numeric))
);


ALTER TABLE "public"."leave_types" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_leave_type"("p_business_id" "uuid", "p_name" "text", "p_default_entitlement_days" numeric) RETURNS "public"."leave_types"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.leave_types;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'configure') then
    raise exception 'not_authorized: requires configure on hr_attendance_leave';
  end if;
  insert into public.leave_types (business_id, name, default_entitlement_days)
  values (p_business_id, p_name, p_default_entitlement_days)
  returning * into v_row;
  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_leave_type"("p_business_id" "uuid", "p_name" "text", "p_default_entitlement_days" numeric) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "party_no" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "legal_name" "text",
    "party_types" "text"[] NOT NULL,
    "registration_no" "text",
    "tin" "text",
    "sst_reg_no" "text",
    "contact_phone" "text",
    "contact_email" "text",
    "billing_address" "text",
    "price_type_id" "uuid",
    "credit_limit" numeric(14,2),
    "credit_terms_days" integer,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "parties_party_types_valid" CHECK ((("party_types" <@ ARRAY['customer'::"text", 'supplier'::"text", 'employee'::"text", 'agent'::"text", 'dropship_partner'::"text"]) AND ("array_length"("party_types", 1) > 0))),
    CONSTRAINT "parties_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."parties" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_party"("p_business_id" "uuid", "p_display_name" "text", "p_legal_name" "text", "p_party_types" "text"[], "p_registration_no" "text", "p_tin" "text", "p_sst_reg_no" "text", "p_contact_phone" "text", "p_contact_email" "text", "p_billing_address" "text", "p_credit_limit" numeric, "p_credit_terms_days" integer) RETURNS "public"."parties"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_party_no text;
  v_row public.parties;
begin
  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if p_party_types is null or array_length(p_party_types, 1) is null then
    raise exception 'party_types_required';
  end if;

  if 'employee' = any(p_party_types) and not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized_to_capture: no capture access to hr_attendance_leave';
  end if;

  if (p_party_types && array['customer', 'supplier', 'agent', 'dropship_partner']::text[])
     and not public.caller_has_capability(p_business_id, 'sales', 'capture') then
    raise exception 'not_authorized_to_capture: no capture access to sales';
  end if;

  -- Party's own numbering format, Vol 13_0 §3.1's literal "PTY-NNNNNN"
  -- example, differs from next_document_number's generic
  -- upper(left(document_type,3)) auto-provisioned default ('party' ->
  -- 'PAR') — so ensure the 'party' sequence exists with the correct
  -- prefix before ever calling it, on first use only (idempotent).
  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'party', 'PTY', 'never')
  on conflict (business_id, document_type) do nothing;

  v_party_no := public.next_document_number(p_business_id, 'party');

  insert into public.parties (
    business_id, party_no, display_name, legal_name, party_types, registration_no, tin,
    sst_reg_no, contact_phone, contact_email, billing_address, credit_limit, credit_terms_days,
    created_by_membership_id
  ) values (
    p_business_id, v_party_no, p_display_name, p_legal_name, p_party_types, p_registration_no, p_tin,
    p_sst_reg_no, p_contact_phone, p_contact_email, p_billing_address, p_credit_limit, p_credit_terms_days,
    v_caller_membership_id
  )
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_party"("p_business_id" "uuid", "p_display_name" "text", "p_legal_name" "text", "p_party_types" "text"[], "p_registration_no" "text", "p_tin" "text", "p_sst_reg_no" "text", "p_contact_phone" "text", "p_contact_email" "text", "p_billing_address" "text", "p_credit_limit" numeric, "p_credit_terms_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_payment_voucher"("p_business_id" "uuid", "p_payee_party_id" "uuid", "p_expense_category" "text", "p_payment_method" "text", "p_grand_total" numeric, "p_notes" "text" DEFAULT NULL::"text", "p_document_id_receipt" "uuid" DEFAULT NULL::"uuid", "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."payment_vouchers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_pv_no text;
  v_row public.payment_vouchers;
  v_account_id uuid;
begin
  if not public.caller_has_capability(p_business_id, 'expense', 'capture') then
    raise exception 'not_authorized: requires capture on expense';
  end if;
  if p_grand_total is null or p_grand_total <= 0 then
    raise exception 'invalid_grand_total: must be positive';
  end if;
  if not exists (select 1 from public.parties where id = p_payee_party_id and business_id = p_business_id) then
    raise exception 'payee_party_not_found_for_this_business: %', p_payee_party_id;
  end if;

  -- Resolve the posting account now, so a bad category is caught at
  -- creation time rather than surfacing as a confusing failure later
  -- when the PV is actually paid.
  select id into v_account_id from public.chart_of_accounts
  where business_id = p_business_id and account_type = 'expense' and lower(account_name) = lower(p_expense_category);
  if v_account_id is null then
    raise exception 'expense_category_not_found_in_chart_of_accounts: % (expected an existing expense account_name)', p_expense_category;
  end if;

  if p_document_id_receipt is not null and not exists (
    select 1 from public.documents where id = p_document_id_receipt and business_id = p_business_id
  ) then
    raise exception 'document_not_found_for_this_business: %', p_document_id_receipt;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'payment_voucher', 'PV', 'never')
  on conflict (business_id, document_type) do nothing;
  v_pv_no := public.next_document_number(p_business_id, 'payment_voucher');

  insert into public.payment_vouchers (
    business_id, pv_no, payee_party_id, expense_category, payment_method,
    grand_total, notes, document_id_receipt, captured_by_membership_id
  ) values (
    p_business_id, v_pv_no, p_payee_party_id, p_expense_category, p_payment_method,
    p_grand_total, p_notes, p_document_id_receipt, v_caller_membership_id
  ) returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'expense', 'payment_voucher', v_row.id, v_row.grand_total,
    coalesce(p_ai_draft_summary, 'Payment voucher ' || v_pv_no || ' to payee for ' || v_row.grand_total || ' ' || v_row.currency
      || ' (' || p_expense_category || ')'),
    null, v_caller_membership_id, p_auto_approved, 'mark as paid'
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_payment_voucher"("p_business_id" "uuid", "p_payee_party_id" "uuid", "p_expense_category" "text", "p_payment_method" "text", "p_grand_total" numeric, "p_notes" "text", "p_document_id_receipt" "uuid", "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "total_net_pay" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payroll_runs_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_approval'::"text", 'approved'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."payroll_runs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_payroll_run"("p_business_id" "uuid", "p_period" "text") RETURNS "public"."payroll_runs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare
  v_caller_membership_id uuid;
  v_row public.payroll_runs;
  v_emp record;
  v_stat record;
  v_claims_total numeric;
  v_advance_total numeric;
  v_claim record;
  v_advance record;
  v_overtime_hours numeric;
  v_overtime_pay numeric;
  v_hourly_rate numeric;
  v_gross_pay numeric;
  v_net numeric;
  v_total numeric := 0;
  v_period_end date;
  v_period_start date;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if p_period is null or p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_period_format: expected YYYY-MM, got %', p_period;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  v_period_start := to_date(p_period, 'YYYY-MM');
  v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;

  insert into public.payroll_runs (business_id, period, created_by_membership_id)
  values (p_business_id, p_period, v_caller_membership_id)
  returning * into v_row;

  for v_emp in
    select ep.*, p.id as employee_party_id from public.employee_profiles ep
    join public.parties p on p.id = ep.party_id
    where ep.business_id = p_business_id
      and ep.hire_date <= v_period_end
      and (ep.resign_date is null or ep.resign_date > v_period_end)
  loop
    -- Overtime: sum approved, not-yet-synced OvertimeRecords within this period (see header note 4).
    select coalesce(sum(hours), 0) into v_overtime_hours from public.overtime_records
    where employee_party_id = v_emp.employee_party_id and status = 'approved'
      and date >= v_period_start and date <= v_period_end;

    v_hourly_rate := v_emp.basic_salary / (26 * 8);
    v_overtime_pay := round(v_overtime_hours * v_hourly_rate * 1.5, 2);
    v_gross_pay := v_emp.basic_salary + v_overtime_pay;

    select * into v_stat from public.compute_statutory_deductions(v_gross_pay, v_period_end);

    v_claims_total := 0;
    for v_claim in select * from public.claims
      where employee_party_id = v_emp.employee_party_id and status = 'approved'
    loop
      v_claims_total := v_claims_total + v_claim.amount;
      update public.claims set status = 'included_in_payroll' where id = v_claim.id;
    end loop;

    v_advance_total := 0;
    for v_advance in select * from public.salary_advances
      where employee_party_id = v_emp.employee_party_id and status = 'approved'
    loop
      v_advance_total := v_advance_total + v_advance.outstanding_balance;
      update public.salary_advances set status = 'fully_deducted', outstanding_balance = 0 where id = v_advance.id;
    end loop;

    v_net := v_gross_pay - v_stat.epf_employee - v_stat.socso_employee - v_stat.eis_employee
      - v_stat.pcb_deduction + v_claims_total - v_advance_total;

    insert into public.payslips (
      payroll_run_id, employee_party_id, gross_pay, epf_employee, epf_employer,
      socso_employee, socso_employer, eis_employee, eis_employer, pcb_deduction,
      claims_included, advance_deducted, net_pay
    ) values (
      v_row.id, v_emp.employee_party_id, v_gross_pay, v_stat.epf_employee, v_stat.epf_employer,
      v_stat.socso_employee, v_stat.socso_employer, v_stat.eis_employee, v_stat.eis_employer, v_stat.pcb_deduction,
      v_claims_total, v_advance_total, v_net
    );

    update public.overtime_records set status = 'synced_to_payroll'
    where employee_party_id = v_emp.employee_party_id and status = 'approved'
      and date >= v_period_start and date <= v_period_end;

    v_total := v_total + v_net;
  end loop;

  update public.payroll_runs set total_net_pay = v_total where id = v_row.id returning * into v_row;

  return v_row;
end;
$_$;


ALTER FUNCTION "public"."create_payroll_run"("p_business_id" "uuid", "p_period" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_list_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "price_type_id" "uuid" NOT NULL,
    "unit_price" numeric(14,2) NOT NULL,
    "effective_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "effective_to" "date",
    "promo_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "price_list_entries_unit_price_check" CHECK (("unit_price" >= (0)::numeric)),
    CONSTRAINT "price_list_entries_valid_window" CHECK ((("effective_to" IS NULL) OR ("effective_to" >= "effective_from")))
);


ALTER TABLE "public"."price_list_entries" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_price_list_entry"("p_product_id" "uuid", "p_price_type_id" "uuid", "p_unit_price" numeric, "p_effective_from" "date", "p_effective_to" "date", "p_promo_note" "text") RETURNS "public"."price_list_entries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_business_id uuid;
  v_row public.price_list_entries;
begin
  select business_id into v_business_id from public.products where id = p_product_id;
  if v_business_id is null then
    raise exception 'product_not_found: %', p_product_id;
  end if;
  if not public.caller_has_capability(v_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if not exists (select 1 from public.price_types where id = p_price_type_id and business_id = v_business_id) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  insert into public.price_list_entries (
    product_id, price_type_id, unit_price, effective_from, effective_to, promo_note
  ) values (
    p_product_id, p_price_type_id, p_unit_price, coalesce(p_effective_from, current_date), p_effective_to, p_promo_note
  )
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_price_list_entry"("p_product_id" "uuid", "p_price_type_id" "uuid", "p_unit_price" numeric, "p_effective_from" "date", "p_effective_to" "date", "p_promo_note" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."price_types" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_price_type"("p_business_id" "uuid", "p_name" "text") RETURNS "public"."price_types"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_row public.price_types;
  v_is_first boolean;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select not exists (select 1 from public.price_types where business_id = p_business_id) into v_is_first;

  insert into public.price_types (business_id, name, is_default)
  values (p_business_id, p_name, v_is_first)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_price_type"("p_business_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "sku" "text",
    "name" "text" NOT NULL,
    "unit_of_measure" "text" NOT NULL,
    "default_cost" numeric(14,2),
    "cost_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "track_inventory" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "products_cost_source_check" CHECK (("cost_source" = ANY (ARRAY['manual'::"text", 'auto_from_purchase'::"text"]))),
    CONSTRAINT "products_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_product"("p_business_id" "uuid", "p_sku" "text", "p_name" "text", "p_unit_of_measure" "text", "p_default_cost" numeric, "p_cost_source" "text", "p_track_inventory" boolean) RETURNS "public"."products"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_row public.products;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if coalesce(p_cost_source, 'manual') = 'auto_from_purchase' then
    raise exception 'auto_from_purchase_not_yet_available: Purchase module addendum has not shipped (Vol 13_0 §5) — use manual for now';
  end if;

  insert into public.products (
    business_id, sku, name, unit_of_measure, default_cost, cost_source, track_inventory,
    created_by_membership_id
  ) values (
    p_business_id, nullif(p_sku, ''), p_name, p_unit_of_measure, p_default_cost,
    coalesce(p_cost_source, 'manual'), coalesce(p_track_inventory, false), v_caller_membership_id
  )
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_product"("p_business_id" "uuid", "p_sku" "text", "p_name" "text", "p_unit_of_measure" "text", "p_default_cost" numeric, "p_cost_source" "text", "p_track_inventory" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_product_import_batch"("p_business_id" "uuid", "p_source_file_ref" "text", "p_rows" "jsonb") RETURNS "public"."product_import_batches"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_batch public.product_import_batches;
  v_row jsonb;
  v_row_no integer := 0;
  v_error_count integer := 0;
  v_row_count integer := 0;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'no_rows_supplied';
  end if;

  insert into public.product_import_batches (business_id, source_file_ref, status, created_by_membership_id)
  values (p_business_id, p_source_file_ref, 'parsed', v_caller_membership_id)
  returning * into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_row_no := v_row_no + 1;
    v_row_count := v_row_count + 1;
    if (v_row ->> 'parse_status') = 'error' then
      v_error_count := v_error_count + 1;
    end if;
    insert into public.product_import_rows (
      batch_id, row_no, raw_data, parsed_sku, parsed_name, parsed_unit_of_measure,
      parsed_default_cost, parse_status, error_message
    ) values (
      v_batch.id,
      v_row_no,
      coalesce(v_row -> 'raw_data', v_row),
      nullif(v_row ->> 'sku', ''),
      nullif(v_row ->> 'name', ''),
      nullif(v_row ->> 'unit_of_measure', ''),
      nullif(v_row ->> 'default_cost', '')::numeric,
      coalesce(v_row ->> 'parse_status', 'error'),
      v_row ->> 'error_message'
    );
  end loop;

  update public.product_import_batches
  set row_count = v_row_count, error_count = v_error_count,
      status = case when v_error_count = v_row_count then 'failed' else 'parsed' end
  where id = v_batch.id
  returning * into v_batch;

  return v_batch;
end;
$$;


ALTER FUNCTION "public"."create_product_import_batch"("p_business_id" "uuid", "p_source_file_ref" "text", "p_rows" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "quotation_no" "text" NOT NULL,
    "party_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date",
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "grand_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "converted_invoice_id" "uuid",
    "captured_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quotations_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'accepted'::"text", 'rejected'::"text", 'expired'::"text", 'converted_to_invoice'::"text"])))
);


ALTER TABLE "public"."quotations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_quotation"("p_business_id" "uuid", "p_party_id" "uuid", "p_valid_until" "date", "p_notes" "text", "p_lines" "jsonb", "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."quotations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_quotation_no text;
  v_quotation public.quotations;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_tax_code text;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_resolved record;
begin
  if not public.caller_has_capability(p_business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and business_id = p_business_id) then
    raise exception 'party_not_found_for_this_business: %', p_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'quotation', 'QTN', 'never')
  on conflict (business_id, document_type) do nothing;
  v_quotation_no := public.next_document_number(p_business_id, 'quotation');

  insert into public.quotations (
    business_id, quotation_no, party_id, valid_until, notes, captured_by_membership_id
  ) values (
    p_business_id, v_quotation_no, p_party_id, p_valid_until, p_notes, v_caller_membership_id
  ) returning * into v_quotation;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_discount := coalesce((v_line ->> 'discount_amount')::numeric, 0);
    v_tax_code := nullif(v_line ->> 'tax_code', '');

    if v_line ? 'unit_price' and (v_line ->> 'unit_price') is not null then
      v_unit_price := (v_line ->> 'unit_price')::numeric;
    elsif v_product_id is not null then
      select r.unit_price into v_unit_price from public.resolve_price(p_business_id, v_product_id, p_party_id) r;
    else
      raise exception 'line_%_needs_either_product_id_or_an_explicit_unit_price', v_line_no;
    end if;

    v_line_total := (v_quantity * v_unit_price) - v_discount;
    v_subtotal := v_subtotal + v_line_total;

    insert into public.quotation_lines (
      quotation_id, line_no, product_id, description, quantity, unit_price, tax_code, discount_amount, line_total
    ) values (
      v_quotation.id, v_line_no, v_product_id, v_line ->> 'description', v_quantity, v_unit_price, v_tax_code, v_discount, v_line_total
    );
  end loop;

  update public.quotations set subtotal = v_subtotal, tax_total = 0, grand_total = v_subtotal
  where id = v_quotation.id
  returning * into v_quotation;

  perform public.create_approval_task(
    p_business_id, 'sales', 'quotation', v_quotation.id, v_quotation.grand_total,
    coalesce(p_ai_draft_summary, 'Quotation ' || v_quotation_no || ' for ' || v_quotation.grand_total || ' ' || v_quotation.currency),
    null, v_caller_membership_id, p_auto_approved, 'send WhatsApp'
  );

  return v_quotation;
end;
$$;


ALTER FUNCTION "public"."create_quotation"("p_business_id" "uuid", "p_party_id" "uuid", "p_valid_until" "date", "p_notes" "text", "p_lines" "jsonb", "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salary_advances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "employee_party_id" "uuid" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "status" "text" DEFAULT 'pending_approval'::"text" NOT NULL,
    "outstanding_balance" numeric(14,2) NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "salary_advances_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "salary_advances_status_check" CHECK (("status" = ANY (ARRAY['pending_approval'::"text", 'approved'::"text", 'fully_deducted'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."salary_advances" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_salary_advance"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."salary_advances"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_caller_membership_id uuid; v_row public.salary_advances;
begin
  if not public.caller_has_capability(p_business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if not exists (select 1 from public.parties where id = p_employee_party_id and business_id = p_business_id
    and 'employee' = any(party_types)) then
    raise exception 'employee_party_not_found_for_this_business: %', p_employee_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.salary_advances (business_id, employee_party_id, amount, outstanding_balance, created_by_membership_id)
  values (p_business_id, p_employee_party_id, p_amount, p_amount, v_caller_membership_id)
  returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'payroll', 'salary_advance', v_row.id, v_row.amount,
    coalesce(p_ai_draft_summary, 'Salary advance for ' || v_row.amount),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_salary_advance"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sst_returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "total_output_tax" numeric(14,2) DEFAULT 0 NOT NULL,
    "submitted_at" timestamp with time zone,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sst_returns_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text"])))
);


ALTER TABLE "public"."sst_returns" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_sst_return"("p_business_id" "uuid", "p_period" "text") RETURNS "public"."sst_returns"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_caller_membership_id uuid; v_total numeric(14, 2); v_row public.sst_returns;
begin
  if not public.caller_has_capability(p_business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if p_period is null or btrim(p_period) = '' then
    raise exception 'period_required';
  end if;

  select coalesce(sum(st.sst_amount), 0) into v_total
  from public.sst_transactions st
  left join public.invoices i on i.id = st.invoice_id
  left join public.payment_vouchers pv on pv.id = st.payment_voucher_id
  where st.business_id = p_business_id
    and coalesce(to_char(i.issue_date, 'YYYY-MM'), to_char(pv.issue_date, 'YYYY-MM')) = p_period;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.sst_returns (business_id, period, total_output_tax, created_by_membership_id)
  values (p_business_id, p_period, v_total, v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_sst_return"("p_business_id" "uuid", "p_period" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_stock_take"("p_business_id" "uuid", "p_warehouse_id" "uuid") RETURNS "public"."stock_takes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_caller_membership_id uuid; v_row public.stock_takes;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.stock_takes (business_id, warehouse_id, captured_by_membership_id)
  values (p_business_id, p_warehouse_id, v_caller_membership_id)
  returning * into v_row;

  insert into public.stock_take_lines (stock_take_id, product_id, system_qty)
  select v_row.id, sl.product_id, sl.quantity_on_hand
  from public.stock_levels sl
  where sl.warehouse_id = p_warehouse_id and sl.business_id = p_business_id;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_stock_take"("p_business_id" "uuid", "p_warehouse_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warehouses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."warehouses" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_warehouse"("p_business_id" "uuid", "p_name" "text") RETURNS "public"."warehouses"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.warehouses;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'configure') then
    raise exception 'not_authorized: requires configure on inventory';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'warehouse_name_required';
  end if;
  insert into public.warehouses (business_id, name) values (p_business_id, btrim(p_name))
  returning * into v_row;
  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_warehouse"("p_business_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_approval_task"("p_task_id" "uuid", "p_decision" "text") RETURNS "public"."approval_tasks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_task public.approval_tasks;
  v_caller_membership_id uuid;
  v_can_approve boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision: must be approved or rejected';
  end if;

  select * into v_task from public.approval_tasks where id = p_task_id for update;
  if not found then
    raise exception 'approval_task_not_found: %', p_task_id;
  end if;
  if v_task.status <> 'pending_approval' then
    raise exception 'already_actioned_by_another_approver: current status %', v_task.status;
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = v_task.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_task.assigned_membership_id is not null then
    if v_caller_membership_id <> v_task.assigned_membership_id then
      raise exception 'not_the_assigned_approver';
    end if;
  else
    -- Open queue: caller must actually be eligible right now (re-derive
    -- the same permission+limit check resolve_approval_task uses,
    -- rather than trusting the client).
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = v_task.domain and rp.capability = 'approve'
    ) into v_can_approve;
    if not v_can_approve then
      raise exception 'not_eligible_to_decide_this_task';
    end if;
  end if;

  update public.approval_tasks set
    status = p_decision,
    decided_by_membership_id = v_caller_membership_id,
    decided_at = now(),
    assigned_membership_id = coalesce(assigned_membership_id, v_caller_membership_id)
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;


ALTER FUNCTION "public"."decide_approval_task"("p_task_id" "uuid", "p_decision" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."overtime_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "employee_party_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "hours" numeric(6,2) NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "overtime_records_hours_check" CHECK (("hours" > (0)::numeric)),
    CONSTRAINT "overtime_records_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'synced_to_payroll'::"text"])))
);


ALTER TABLE "public"."overtime_records" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_overtime_for_date"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_date" "date", "p_scheduled_hours" numeric DEFAULT 8, "p_ai_draft_summary" "text" DEFAULT NULL::"text", "p_auto_approved" boolean DEFAULT false) RETURNS "public"."overtime_records"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_row public.overtime_records;
  v_worked_hours numeric := 0;
  v_pair record;
  v_overtime_hours numeric;
begin
  if not public.caller_has_capability(p_business_id, 'hr_attendance_leave', 'capture') then
    raise exception 'not_authorized: requires capture on hr_attendance_leave';
  end if;
  if exists (select 1 from public.overtime_records where employee_party_id = p_employee_party_id and date = p_date) then
    raise exception 'overtime_already_derived_for_this_employee_and_date: %', p_date;
  end if;

  -- Pair consecutive in/out records that fall on this calendar date,
  -- summing worked duration. A record spanning midnight is out of
  -- scope this sprint (disclosed simplification, not silently wrong —
  -- such a pair simply doesn't match this date-scoped query and is
  -- excluded rather than mis-attributed).
  for v_pair in
    select
      a_in.recorded_at as clock_in, a_out.recorded_at as clock_out
    from public.attendance_records a_in
    join lateral (
      select recorded_at from public.attendance_records a_out
      where a_out.employee_party_id = a_in.employee_party_id and a_out.clock_type = 'out'
        and a_out.recorded_at > a_in.recorded_at
      order by a_out.recorded_at asc limit 1
    ) a_out on true
    where a_in.employee_party_id = p_employee_party_id and a_in.clock_type = 'in'
      and a_in.recorded_at::date = p_date and a_out.recorded_at::date = p_date
  loop
    v_worked_hours := v_worked_hours + extract(epoch from (v_pair.clock_out - v_pair.clock_in)) / 3600.0;
  end loop;

  v_overtime_hours := round(v_worked_hours - p_scheduled_hours, 2);
  if v_overtime_hours <= 0 then
    raise exception 'no_overtime_for_this_date: worked % hours against a % hour schedule', round(v_worked_hours, 2), p_scheduled_hours;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.overtime_records (business_id, employee_party_id, date, hours)
  values (p_business_id, p_employee_party_id, p_date, v_overtime_hours)
  returning * into v_row;

  perform public.create_approval_task(
    p_business_id, 'hr_attendance_leave', 'overtime_record', v_row.id, null,
    coalesce(p_ai_draft_summary, 'Overtime for ' || p_date || ': ' || v_overtime_hours || ' hours'),
    null, v_caller_membership_id, p_auto_approved, null
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."derive_overtime_for_date"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_date" "date", "p_scheduled_hours" numeric, "p_ai_draft_summary" "text", "p_auto_approved" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_delivery_order"("p_delivery_order_id" "uuid") RETURNS "public"."delivery_orders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_do public.delivery_orders;
  v_task_status text;
  v_caller_membership_id uuid;
  v_line record;
  v_product public.products;
  v_stock_level public.stock_levels;
begin
  select * into v_do from public.delivery_orders where id = p_delivery_order_id for update;
  if not found then raise exception 'delivery_order_not_found: %', p_delivery_order_id; end if;
  if not public.caller_has_capability(v_do.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_do.status <> 'draft' then
    raise exception 'delivery_order_not_in_draft_status: current status %', v_do.status;
  end if;

  select status into v_task_status from public.approval_tasks
  where subject_type = 'delivery_order' and subject_id = p_delivery_order_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'delivery_order_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_do.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  for v_line in
    select dol.product_id, dol.quantity
    from public.delivery_order_lines dol
    where dol.delivery_order_id = p_delivery_order_id
    order by dol.line_no
  loop
    select * into v_product from public.products where id = v_line.product_id;
    if not v_product.track_inventory then
      continue; -- see header note 5
    end if;

    select * into v_stock_level from public.stock_levels
    where product_id = v_line.product_id and warehouse_id = v_do.warehouse_id
    for update;
    if not found or v_stock_level.quantity_on_hand < v_line.quantity then
      raise exception 'insufficient_stock_for_product_%: available %, requested %',
        v_line.product_id, coalesce(v_stock_level.quantity_on_hand, 0), v_line.quantity;
    end if;

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type, quantity,
      source_document_type, source_document_id, created_by_membership_id
    ) values (
      v_do.business_id, v_line.product_id, v_do.warehouse_id, 'delivery_out', v_line.quantity,
      'delivery_order', p_delivery_order_id, v_caller_membership_id
    );

    update public.stock_levels
    set quantity_on_hand = quantity_on_hand - v_line.quantity, last_movement_at = now()
    where product_id = v_line.product_id and warehouse_id = v_do.warehouse_id;
  end loop;

  update public.delivery_orders set status = 'dispatched' where id = p_delivery_order_id returning * into v_do;
  return v_do;
end;
$$;


ALTER FUNCTION "public"."dispatch_delivery_order"("p_delivery_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."effective_access_model"("p_business_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when (select access_model_override from public.businesses where id = p_business_id) = 'forced_solo' then 'solo'
    when (select access_model_override from public.businesses where id = p_business_id) = 'forced_team' then 'team'
    when (
      select count(*) from public.business_memberships
      where business_id = p_business_id and status = 'active'
    ) > 1
    then 'team'
    else 'solo'
  end
$$;


ALTER FUNCTION "public"."effective_access_model"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_own_capture_attribution"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  if new.captured_by_membership_id is not null then
    if not exists (
      select 1 from public.business_memberships bm
      where bm.id = new.captured_by_membership_id
        and bm.business_id = new.business_id
        and bm.user_id = auth.uid()
        and bm.status = 'active'
    ) then
      raise exception 'captured_by_membership_id_must_be_callers_own_active_membership';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_own_capture_attribution"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_sole_owner_membership"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  -- Fixed, well-known id for the Owner system template — same constant
  -- Section 5's seed and Section 6's business_memberships_one_active_owner
  -- partial index use, so all three stay trivially in agreement.
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_remaining_active_owners integer;
begin
  if old.role_id = v_owner_role_id and old.status = 'active'
     and (new.status <> 'active' or new.role_id <> v_owner_role_id) then
    select count(*) into v_remaining_active_owners
    from public.business_memberships
    where business_id = old.business_id
      and status = 'active'
      and role_id = v_owner_role_id
      and id <> old.id;

    if v_remaining_active_owners = 0 then
      raise exception 'cannot_remove_sole_owner: business % must always have exactly one active Owner membership', old.business_id;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_sole_owner_membership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_system_account_immutability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if TG_OP = 'DELETE' and OLD.is_system then
    raise exception 'cannot_delete_system_account: %', OLD.account_code;
  end if;
  if TG_OP = 'UPDATE' and OLD.is_system and (
    NEW.account_type <> OLD.account_type or NEW.account_code <> OLD.account_code or NEW.is_system <> OLD.is_system
  ) then
    raise exception 'cannot_modify_system_account_type_or_code: %', OLD.account_code;
  end if;
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."enforce_system_account_immutability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expense_category_breakdown"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") RETURNS TABLE("account_code" "text", "account_name" "text", "amount" numeric, "pct_of_total_expense" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_total_expense numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_total_expense
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'expense'
    and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1);

  return query
  select
    coa.account_code,
    coa.account_name,
    sum(case when le.direction = 'debit' then le.amount else -le.amount end) as amount,
    case when v_total_expense > 0
      then round(100.0 * sum(case when le.direction = 'debit' then le.amount else -le.amount end) / v_total_expense, 2)
      else 0
    end as pct_of_total_expense
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'expense'
    and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1)
  group by coa.account_code, coa.account_name
  having sum(case when le.direction = 'debit' then le.amount else -le.amount end) <> 0
  order by amount desc;
end;
$$;


ALTER FUNCTION "public"."expense_category_breakdown"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."general_ledger_detail"("p_business_id" "uuid", "p_account_id" "uuid", "p_date_from" "date", "p_date_to" "date") RETURNS TABLE("entry_id" "uuid", "posted_at" timestamp with time zone, "direction" "text", "amount" numeric, "running_balance" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_opening_balance numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;
  if not exists (select 1 from public.chart_of_accounts where id = p_account_id and business_id = p_business_id) then
    raise exception 'chart_of_accounts_row_not_found_for_this_business: %', p_account_id;
  end if;

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_opening_balance
  from public.ledger_entries le
  where le.chart_of_accounts_id = p_account_id and le.posted_at < p_date_from;

  return query
  with in_range as (
    select le.id, le.posted_at, le.direction, le.amount
    from public.ledger_entries le
    where le.chart_of_accounts_id = p_account_id
      and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1)
    order by le.posted_at asc
  )
  select
    r.id,
    r.posted_at,
    r.direction,
    r.amount,
    v_opening_balance + sum(case when r.direction = 'debit' then r.amount else -r.amount end)
      over (order by r.posted_at rows between unbounded preceding and current row)
  from in_range r;
end;
$$;


ALTER FUNCTION "public"."general_ledger_detail"("p_business_id" "uuid", "p_account_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bulk_payment_file_exports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payroll_run_id" "uuid" NOT NULL,
    "bank_format" "text" NOT NULL,
    "file_ref" "text" NOT NULL,
    "file_content" "text" NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bulk_payment_file_exports" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_bulk_payment_file_export"("p_payroll_run_id" "uuid", "p_encryption_key" "text", "p_bank_format" "text" DEFAULT 'Maybank2u'::"text") RETURNS "public"."bulk_payment_file_exports"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_run public.payroll_runs;
  v_caller_membership_id uuid;
  v_line record;
  v_csv text := 'Recipient Name,Recipient Bank Name,Recipient Bank Account No,Amount,Payment Reference,Payment Date' || E'\n';
  v_row public.bulk_payment_file_exports;
  v_file_ref text;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'payroll_run_not_found: %', p_payroll_run_id; end if;
  if not public.caller_has_capability(v_run.business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'payroll_run_not_approved: current status %', v_run.status;
  end if;
  if exists (select 1 from public.bulk_payment_file_exports where payroll_run_id = p_payroll_run_id) then
    raise exception 'bulk_payment_file_already_generated_for_this_run: %', p_payroll_run_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_run.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  for v_line in
    select
      coalesce(p.legal_name, p.display_name) as recipient_name,
      ep.bank_name,
      pgp_sym_decrypt(ep.bank_account_no_encrypted, p_encryption_key) as bank_account_no,
      ps.net_pay
    from public.payslips ps
    join public.parties p on p.id = ps.employee_party_id
    join public.employee_profiles ep on ep.party_id = ps.employee_party_id
    where ps.payroll_run_id = p_payroll_run_id
    order by p.display_name
  loop
    v_csv := v_csv || format(
      '%s,%s,%s,%s,%s,%s' || E'\n',
      replace(v_line.recipient_name, ',', ' '),
      coalesce(replace(v_line.bank_name, ',', ' '), ''),
      v_line.bank_account_no,
      to_char(v_line.net_pay, 'FM999999990.00'),
      'Payroll ' || v_run.period,
      to_char(current_date, 'YYYY-MM-DD')
    );
  end loop;

  v_file_ref := 'payroll_' || v_run.period || '_' || p_bank_format || '_' || p_payroll_run_id::text || '.csv';

  insert into public.bulk_payment_file_exports (payroll_run_id, bank_format, file_ref, file_content, created_by_membership_id)
  values (p_payroll_run_id, p_bank_format, v_file_ref, v_csv, v_caller_membership_id)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."generate_bulk_payment_file_export"("p_payroll_run_id" "uuid", "p_encryption_key" "text", "p_bank_format" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_consolidated_einvoice_batch"("p_business_id" "uuid", "p_consolidated_period" "text") RETURNS "public"."e_invoice_submissions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_row public.e_invoice_submissions;
  v_invoice_id uuid;
  v_line_count integer := 0;
begin
  if not public.caller_has_capability(p_business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if p_consolidated_period is null or btrim(p_consolidated_period) = '' then
    raise exception 'consolidated_period_required';
  end if;
  if exists (
    select 1 from public.e_invoice_submissions
    where business_id = p_business_id and submission_type = 'consolidated'
      and consolidated_period = p_consolidated_period and status not in ('rejected', 'cancelled')
  ) then
    raise exception 'consolidated_batch_already_exists_for_this_period: %', p_consolidated_period;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.e_invoice_submissions (
    business_id, submission_type, consolidated_period, created_by_membership_id
  ) values (
    p_business_id, 'consolidated', p_consolidated_period, v_caller_membership_id
  ) returning * into v_row;

  for v_invoice_id in
    select i.id
    from public.invoices i
    join public.parties pty on pty.id = i.party_id
    where i.business_id = p_business_id
      and to_char(i.issue_date, 'YYYY-MM') = p_consolidated_period
      and i.status not in ('draft', 'cancelled')
      and (pty.tin is null or btrim(pty.tin) = '') -- non-B2B, see header note 4
      and not exists (
        select 1 from public.e_invoice_submissions es
        where es.invoice_id = i.id and es.status not in ('rejected', 'cancelled')
      )
  loop
    insert into public.e_invoice_submission_lines (submission_id, invoice_id) values (v_row.id, v_invoice_id);
    v_line_count := v_line_count + 1;
  end loop;

  if v_line_count = 0 then
    raise exception 'no_eligible_non_b2b_invoices_found_for_period: %', p_consolidated_period;
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."generate_consolidated_einvoice_batch"("p_business_id" "uuid", "p_consolidated_period" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_employee_profile_decrypted"("p_employee_profile_id" "uuid", "p_encryption_key" "text") RETURNS TABLE("id" "uuid", "party_id" "uuid", "ic_number" "text", "epf_number" "text", "socso_number" "text", "income_tax_no" "text", "bank_name" "text", "bank_account_no" "text", "basic_salary" numeric, "employment_type" "text", "hire_date" "date", "resign_date" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_ep public.employee_profiles;
begin
  select * into v_ep from public.employee_profiles ep where ep.id = p_employee_profile_id;
  if not found then raise exception 'employee_profile_not_found: %', p_employee_profile_id; end if;
  if not public.caller_has_capability(v_ep.business_id, 'payroll', 'view') then
    raise exception 'not_authorized: requires view on payroll';
  end if;

  return query select
    v_ep.id, v_ep.party_id,
    pgp_sym_decrypt(v_ep.ic_number_encrypted, p_encryption_key),
    case when v_ep.epf_number_encrypted is not null then pgp_sym_decrypt(v_ep.epf_number_encrypted, p_encryption_key) end,
    case when v_ep.socso_number_encrypted is not null then pgp_sym_decrypt(v_ep.socso_number_encrypted, p_encryption_key) end,
    case when v_ep.income_tax_no_encrypted is not null then pgp_sym_decrypt(v_ep.income_tax_no_encrypted, p_encryption_key) end,
    v_ep.bank_name,
    pgp_sym_decrypt(v_ep.bank_account_no_encrypted, p_encryption_key),
    v_ep.basic_salary, v_ep.employment_type, v_ep.hire_date, v_ep.resign_date;
end;
$$;


ALTER FUNCTION "public"."get_employee_profile_decrypted"("p_employee_profile_id" "uuid", "p_encryption_key" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_balances" (
    "employee_party_id" "uuid" NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "entitled_days" numeric(6,2) DEFAULT 0 NOT NULL,
    "used_days" numeric(6,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."leave_balances" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."grant_leave_balance"("p_employee_party_id" "uuid", "p_leave_type_id" "uuid", "p_year" integer, "p_entitled_days" numeric DEFAULT NULL::numeric) RETURNS "public"."leave_balances"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_leave_type public.leave_types; v_row public.leave_balances; v_days numeric;
begin
  select * into v_leave_type from public.leave_types where id = p_leave_type_id;
  if not found then raise exception 'leave_type_not_found: %', p_leave_type_id; end if;
  if not public.caller_has_capability(v_leave_type.business_id, 'hr_attendance_leave', 'configure') then
    raise exception 'not_authorized: requires configure on hr_attendance_leave';
  end if;
  v_days := coalesce(p_entitled_days, v_leave_type.default_entitlement_days);

  insert into public.leave_balances (employee_party_id, leave_type_id, year, entitled_days, used_days)
  values (p_employee_party_id, p_leave_type_id, p_year, v_days, 0)
  on conflict (employee_party_id, leave_type_id, year)
  do update set entitled_days = excluded.entitled_days
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."grant_leave_balance"("p_employee_party_id" "uuid", "p_leave_type_id" "uuid", "p_year" integer, "p_entitled_days" numeric) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_statement_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_account_id" "uuid" NOT NULL,
    "statement_date" "date" NOT NULL,
    "description" "text",
    "amount" numeric(14,2) NOT NULL,
    "matched_ledger_entry_id" "uuid",
    "match_status" "text" DEFAULT 'unmatched'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_statement_lines_match_status_check" CHECK (("match_status" = ANY (ARRAY['unmatched'::"text", 'matched'::"text", 'ignored'::"text"])))
);


ALTER TABLE "public"."bank_statement_lines" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ignore_bank_statement_line"("p_statement_line_id" "uuid") RETURNS "public"."bank_statement_lines"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_line public.bank_statement_lines; v_bank_account public.bank_accounts;
begin
  select * into v_line from public.bank_statement_lines where id = p_statement_line_id;
  if not found then raise exception 'bank_statement_line_not_found: %', p_statement_line_id; end if;

  select * into v_bank_account from public.bank_accounts where id = v_line.bank_account_id;
  if not public.caller_has_capability(v_bank_account.business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if v_line.match_status <> 'unmatched' then
    raise exception 'bank_statement_line_not_unmatched: current status %', v_line.match_status;
  end if;

  update public.bank_statement_lines set match_status = 'ignored' where id = p_statement_line_id
  returning * into v_line;

  return v_line;
end;
$$;


ALTER FUNCTION "public"."ignore_bank_statement_line"("p_statement_line_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_bank_statement_lines"("p_bank_account_id" "uuid", "p_lines" "jsonb") RETURNS SETOF "public"."bank_statement_lines"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_bank_account public.bank_accounts;
  v_line jsonb;
  v_statement_date date;
  v_description text;
  v_amount numeric;
begin
  select * into v_bank_account from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'bank_account_not_found: %', p_bank_account_id; end if;
  if not public.caller_has_capability(v_bank_account.business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_statement_date := (v_line ->> 'statement_date')::date;
    v_description := v_line ->> 'description';
    v_amount := (v_line ->> 'amount')::numeric;
    if v_statement_date is null or v_amount is null or v_amount = 0 then
      raise exception 'each_line_needs_a_statement_date_and_a_nonzero_amount';
    end if;

    insert into public.bank_statement_lines (bank_account_id, statement_date, description, amount)
    values (p_bank_account_id, v_statement_date, v_description, v_amount);
  end loop;

  return query select * from public.bank_statement_lines
    where bank_account_id = p_bank_account_id
    order by created_at desc limit jsonb_array_length(p_lines);
end;
$$;


ALTER FUNCTION "public"."import_bank_statement_lines"("p_bank_account_id" "uuid", "p_lines" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invite_member"("p_business_id" "uuid", "p_invited_email" "text", "p_role_id" "uuid") RETURNS "public"."business_memberships"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare
  v_membership record;
  v_can_configure boolean;
  v_normalized_email text := lower(btrim(p_invited_email));
  v_existing_user_id uuid;
  v_row public.business_memberships;
begin
  if v_normalized_email is null or v_normalized_email = '' or v_normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  if not exists (
    select 1 from public.roles r
    where r.id = p_role_id and (r.business_id is null or r.business_id = p_business_id)
  ) then
    raise exception 'role_not_available_to_this_business';
  end if;

  select id into v_existing_user_id from auth.users where lower(email) = v_normalized_email;

  if v_existing_user_id is not null and exists (
    select 1 from public.business_memberships
    where user_id = v_existing_user_id and status in ('invited', 'active', 'suspended')
  ) then
    raise exception 'invitee_already_has_a_live_membership_elsewhere';
  end if;

  insert into public.business_memberships (
    business_id, user_id, role_id, invited_email, status,
    invited_by_membership_id, invited_at
  ) values (
    p_business_id, null, p_role_id, v_normalized_email, 'invited',
    v_membership.membership_id, now()
  )
  returning * into v_row;

  return v_row;
end;
$_$;


ALTER FUNCTION "public"."invite_member"("p_business_id" "uuid", "p_invited_email" "text", "p_role_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoice_effective_status"("p_invoice_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when i.status in ('issued', 'sent', 'partially_paid')
         and i.due_date < current_date
         and i.outstanding_balance > 0
    then 'overdue'
    else i.status
  end
  from public.invoices i
  where i.id = p_invoice_id
$$;


ALTER FUNCTION "public"."invoice_effective_status"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_member"("p_business_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.business_memberships bm
    where bm.business_id = p_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
  )
$$;


ALTER FUNCTION "public"."is_active_member"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_due_contract_alerts"("p_business_id" "uuid", "p_as_of" "date" DEFAULT CURRENT_DATE) RETURNS SETOF "public"."contract_alerts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  if not public.caller_has_capability(p_business_id, 'legal_contract', 'view') then
    raise exception 'not_authorized: requires view on legal_contract';
  end if;

  update public.contract_alerts ca
  set notified_at = now()
  from public.contracts c
  where ca.contract_id = c.id and c.business_id = p_business_id
    and ca.status = 'pending' and ca.trigger_date <= p_as_of and ca.notified_at is null;

  return query
  select ca.* from public.contract_alerts ca
  join public.contracts c on c.id = ca.contract_id
  where c.business_id = p_business_id and ca.status = 'pending' and ca.trigger_date <= p_as_of
  order by ca.trigger_date asc;
end;
$$;


ALTER FUNCTION "public"."list_due_contract_alerts"("p_business_id" "uuid", "p_as_of" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_member_identities"("p_business_id" "uuid") RETURNS TABLE("membership_id" "uuid", "display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$ select bm.id as membership_id, coalesce( nullif(btrim(bm.owner_label), ''), nullif(btrim(p.display_name), ''), case when bm.status = 'invited' then bm.invited_email end ) as display_name from public.business_memberships bm left join public.profiles p on p.id = bm.user_id where bm.business_id = p_business_id and public.is_active_member(p_business_id); $$;


ALTER FUNCTION "public"."list_member_identities"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."map_domain_hint"("p_domain_hint" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case p_domain_hint
    when 'sale' then 'sales'
    when 'purchase' then 'purchase'
    when 'expense' then 'expense'
    when 'banking' then 'accounting_reports'
    else null
  end;
$$;


ALTER FUNCTION "public"."map_domain_hint"("p_domain_hint" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_commission_paid"("p_commission_calculation_id" "uuid") RETURNS "public"."commission_calculations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.commission_calculations;
begin
  select * into v_row from public.commission_calculations where id = p_commission_calculation_id for update;
  if not found then raise exception 'commission_calculation_not_found: %', p_commission_calculation_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'commission', 'capture') then
    raise exception 'not_authorized: requires capture on commission';
  end if;
  if v_row.status <> 'approved' then
    raise exception 'commission_calculation_not_approved: current status %', v_row.status;
  end if;

  update public.commission_calculations set status = 'paid' where id = p_commission_calculation_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."mark_commission_paid"("p_commission_calculation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_delivery_order_delivered"("p_delivery_order_id" "uuid") RETURNS "public"."delivery_orders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_do public.delivery_orders;
begin
  select * into v_do from public.delivery_orders where id = p_delivery_order_id;
  if not found then raise exception 'delivery_order_not_found: %', p_delivery_order_id; end if;
  if not public.caller_has_capability(v_do.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_do.status <> 'dispatched' then
    raise exception 'delivery_order_not_dispatched: current status %', v_do.status;
  end if;
  update public.delivery_orders set status = 'delivered' where id = p_delivery_order_id returning * into v_do;
  return v_do;
end;
$$;


ALTER FUNCTION "public"."mark_delivery_order_delivered"("p_delivery_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_esignature_envelope_declined"("p_envelope_id" "uuid") RETURNS "public"."e_signature_envelopes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.e_signature_envelopes; v_capture_ok boolean;
begin
  select * into v_row from public.e_signature_envelopes where id = p_envelope_id for update;
  if not found then raise exception 'envelope_not_found: %', p_envelope_id; end if;
  if v_row.contract_id is not null then
    v_capture_ok := public.caller_has_capability(v_row.business_id, 'legal_contract', 'capture');
  else
    v_capture_ok := public.caller_has_capability(v_row.business_id, 'sales', 'capture');
  end if;
  if not v_capture_ok then
    raise exception 'not_authorized: requires capture on the envelope''s own domain';
  end if;
  if v_row.status not in ('sent', 'viewed') then
    raise exception 'envelope_not_declinable: current status %', v_row.status;
  end if;

  update public.e_signature_envelopes set status = 'declined' where id = p_envelope_id returning * into v_row;
  return v_row;
end;
$$;


ALTER FUNCTION "public"."mark_esignature_envelope_declined"("p_envelope_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_esignature_envelope_signed"("p_envelope_id" "uuid", "p_signed_document_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."e_signature_envelopes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.e_signature_envelopes; v_capture_ok boolean;
begin
  select * into v_row from public.e_signature_envelopes where id = p_envelope_id for update;
  if not found then raise exception 'envelope_not_found: %', p_envelope_id; end if;
  if v_row.contract_id is not null then
    v_capture_ok := public.caller_has_capability(v_row.business_id, 'legal_contract', 'capture');
  else
    v_capture_ok := public.caller_has_capability(v_row.business_id, 'sales', 'capture');
  end if;
  if not v_capture_ok then
    raise exception 'not_authorized: requires capture on the envelope''s own domain';
  end if;
  if v_row.status not in ('sent', 'viewed') then
    raise exception 'envelope_not_signable: current status %', v_row.status;
  end if;

  update public.e_signature_envelopes set status = 'signed', signed_document_id = p_signed_document_id
  where id = p_envelope_id returning * into v_row;

  if v_row.contract_id is not null then
    update public.contracts set status = 'active', start_date = coalesce(start_date, current_date)
    where id = v_row.contract_id and status = 'pending_signature';
  else
    update public.quotations set status = 'accepted' where id = v_row.quotation_id and status = 'sent';
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."mark_esignature_envelope_signed"("p_envelope_id" "uuid", "p_signed_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_esignature_envelope_viewed"("p_envelope_id" "uuid") RETURNS "public"."e_signature_envelopes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.e_signature_envelopes;
begin
  select * into v_row from public.e_signature_envelopes where id = p_envelope_id for update;
  if not found then raise exception 'envelope_not_found: %', p_envelope_id; end if;
  if not (
    public.caller_has_capability(v_row.business_id, 'legal_contract', 'view')
    or public.caller_has_capability(v_row.business_id, 'sales', 'view')
  ) then
    raise exception 'not_authorized: requires view on legal_contract or sales';
  end if;
  if v_row.status <> 'sent' then
    raise exception 'envelope_not_in_sent_status: current status %', v_row.status;
  end if;

  update public.e_signature_envelopes set status = 'viewed' where id = p_envelope_id returning * into v_row;
  return v_row;
end;
$$;


ALTER FUNCTION "public"."mark_esignature_envelope_viewed"("p_envelope_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_payment_voucher_paid"("p_payment_voucher_id" "uuid") RETURNS "public"."payment_vouchers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_pv public.payment_vouchers;
  v_caller_membership_id uuid;
  v_expense_account_id uuid;
  v_cash_account_id uuid;
begin
  select * into v_pv from public.payment_vouchers where id = p_payment_voucher_id for update;
  if not found then raise exception 'payment_voucher_not_found: %', p_payment_voucher_id; end if;
  if not (
    public.caller_has_capability(v_pv.business_id, 'expense', 'capture')
    or public.caller_has_capability(v_pv.business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on expense, or configure on accounting_reports';
  end if;
  if v_pv.status <> 'approved' then
    raise exception 'payment_voucher_not_approved: current status %', v_pv.status;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_pv.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  select id into v_expense_account_id from public.chart_of_accounts
  where business_id = v_pv.business_id and account_type = 'expense' and lower(account_name) = lower(v_pv.expense_category);
  select id into v_cash_account_id from public.chart_of_accounts
  where business_id = v_pv.business_id and account_code = '1000';
  if v_expense_account_id is null or v_cash_account_id is null then
    raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing the % account or 1000', v_pv.business_id, v_pv.expense_category;
  end if;

  insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
  values
    (v_pv.business_id, v_expense_account_id, 'debit', v_pv.grand_total, v_pv.currency, v_caller_membership_id),
    (v_pv.business_id, v_cash_account_id, 'credit', v_pv.grand_total, v_pv.currency, v_caller_membership_id);

  update public.payment_vouchers set status = 'paid' where id = p_payment_voucher_id
  returning * into v_pv;

  return v_pv;
end;
$$;


ALTER FUNCTION "public"."mark_payment_voucher_paid"("p_payment_voucher_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_payroll_run_paid"("p_payroll_run_id" "uuid") RETURNS "public"."payroll_runs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_run public.payroll_runs;
  v_caller_membership_id uuid;
  v_salaries_account_id uuid;
  v_statutory_account_id uuid;
  v_cash_account_id uuid;
  v_debit_total numeric;
  v_statutory_total numeric;
  v_cash_total numeric;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'payroll_run_not_found: %', p_payroll_run_id; end if;
  if not (
    public.caller_has_capability(v_run.business_id, 'payroll', 'capture')
    or public.caller_has_capability(v_run.business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on payroll, or configure on accounting_reports';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'payroll_run_not_approved: current status %', v_run.status;
  end if;
  if not exists (select 1 from public.bulk_payment_file_exports where payroll_run_id = p_payroll_run_id) then
    raise exception 'bulk_payment_file_not_yet_generated_for_this_run: %', p_payroll_run_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_run.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  select id into v_salaries_account_id from public.chart_of_accounts
  where business_id = v_run.business_id and account_code = '6500';
  select id into v_statutory_account_id from public.chart_of_accounts
  where business_id = v_run.business_id and account_code = '2100';
  select id into v_cash_account_id from public.chart_of_accounts
  where business_id = v_run.business_id and account_code = '1000';
  if v_salaries_account_id is null or v_statutory_account_id is null or v_cash_account_id is null then
    raise exception 'chart_of_accounts_missing_expected_payroll_accounts: business %', v_run.business_id;
  end if;

  select
    coalesce(sum(gross_pay + epf_employer + socso_employer + eis_employer + claims_included - advance_deducted), 0),
    coalesce(sum(epf_employee + epf_employer + socso_employee + socso_employer + eis_employee + eis_employer + pcb_deduction), 0),
    coalesce(sum(net_pay), 0)
  into v_debit_total, v_statutory_total, v_cash_total
  from public.payslips where payroll_run_id = p_payroll_run_id;

  insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
  values
    (v_run.business_id, v_salaries_account_id, 'debit', v_debit_total, 'MYR', v_caller_membership_id),
    (v_run.business_id, v_statutory_account_id, 'credit', v_statutory_total, 'MYR', v_caller_membership_id),
    (v_run.business_id, v_cash_account_id, 'credit', v_cash_total, 'MYR', v_caller_membership_id);

  update public.payroll_runs set status = 'paid' where id = p_payroll_run_id returning * into v_run;

  return v_run;
end;
$$;


ALTER FUNCTION "public"."mark_payroll_run_paid"("p_payroll_run_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payslips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payroll_run_id" "uuid" NOT NULL,
    "employee_party_id" "uuid" NOT NULL,
    "gross_pay" numeric(14,2) NOT NULL,
    "epf_employee" numeric(14,2) DEFAULT 0 NOT NULL,
    "epf_employer" numeric(14,2) DEFAULT 0 NOT NULL,
    "socso_employee" numeric(14,2) DEFAULT 0 NOT NULL,
    "socso_employer" numeric(14,2) DEFAULT 0 NOT NULL,
    "eis_employee" numeric(14,2) DEFAULT 0 NOT NULL,
    "eis_employer" numeric(14,2) DEFAULT 0 NOT NULL,
    "pcb_deduction" numeric(14,2) DEFAULT 0 NOT NULL,
    "claims_included" numeric(14,2) DEFAULT 0 NOT NULL,
    "advance_deducted" numeric(14,2) DEFAULT 0 NOT NULL,
    "net_pay" numeric(14,2) NOT NULL,
    "e_payslip_sent_at" timestamp with time zone,
    "e_payslip_channel" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payslips_e_payslip_channel_check" CHECK (("e_payslip_channel" = ANY (ARRAY['whatsapp'::"text", 'email'::"text"])))
);


ALTER TABLE "public"."payslips" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_payslip_sent"("p_payslip_id" "uuid", "p_channel" "text") RETURNS "public"."payslips"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_payslip public.payslips; v_run public.payroll_runs;
begin
  if p_channel not in ('whatsapp', 'email') then
    raise exception 'invalid_channel: must be whatsapp or email';
  end if;
  select * into v_payslip from public.payslips where id = p_payslip_id for update;
  if not found then raise exception 'payslip_not_found: %', p_payslip_id; end if;
  select * into v_run from public.payroll_runs where id = v_payslip.payroll_run_id;
  if not public.caller_has_capability(v_run.business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if v_run.status not in ('approved', 'paid') then
    raise exception 'payroll_run_not_yet_approved: current status %', v_run.status;
  end if;
  if v_payslip.e_payslip_sent_at is not null then
    raise exception 'payslip_already_marked_sent: %', p_payslip_id;
  end if;

  update public.payslips set e_payslip_sent_at = now(), e_payslip_channel = p_channel
  where id = p_payslip_id returning * into v_payslip;

  return v_payslip;
end;
$$;


ALTER FUNCTION "public"."mark_payslip_sent"("p_payslip_id" "uuid", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_quotation_accepted"("p_quotation_id" "uuid") RETURNS "public"."quotations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_quotation public.quotations;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'sent' then
    raise exception 'quotation_not_in_sent_status: current status %', v_quotation.status;
  end if;
  update public.quotations set status = 'accepted' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;


ALTER FUNCTION "public"."mark_quotation_accepted"("p_quotation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_quotation_rejected"("p_quotation_id" "uuid") RETURNS "public"."quotations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_quotation public.quotations;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'sent' then
    raise exception 'quotation_not_in_sent_status: current status %', v_quotation.status;
  end if;
  update public.quotations set status = 'rejected' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;


ALTER FUNCTION "public"."mark_quotation_rejected"("p_quotation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_quotation_sent"("p_quotation_id" "uuid") RETURNS "public"."quotations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_quotation public.quotations; v_task_status text;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'draft' then
    raise exception 'quotation_not_in_draft_status: current status %', v_quotation.status;
  end if;
  select status into v_task_status from public.approval_tasks
  where subject_type = 'quotation' and subject_id = p_quotation_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'quotation_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;
  update public.quotations set status = 'sent' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;


ALTER FUNCTION "public"."mark_quotation_sent"("p_quotation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_bank_statement_line"("p_statement_line_id" "uuid", "p_ledger_entry_id" "uuid") RETURNS "public"."bank_statement_lines"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_line public.bank_statement_lines;
  v_bank_account public.bank_accounts;
  v_ledger_entry public.ledger_entries;
begin
  select * into v_line from public.bank_statement_lines where id = p_statement_line_id for update;
  if not found then raise exception 'bank_statement_line_not_found: %', p_statement_line_id; end if;

  select * into v_bank_account from public.bank_accounts where id = v_line.bank_account_id;
  if not public.caller_has_capability(v_bank_account.business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;
  if v_line.match_status <> 'unmatched' then
    raise exception 'bank_statement_line_not_unmatched: current status %', v_line.match_status;
  end if;

  select * into v_ledger_entry from public.ledger_entries where id = p_ledger_entry_id;
  if not found or v_ledger_entry.business_id <> v_bank_account.business_id
    or v_ledger_entry.chart_of_accounts_id <> v_bank_account.ledger_account_id then
    raise exception 'ledger_entry_not_found_for_this_bank_account: %', p_ledger_entry_id;
  end if;
  if exists (
    select 1 from public.bank_statement_lines
    where matched_ledger_entry_id = p_ledger_entry_id and match_status = 'matched'
  ) then
    raise exception 'ledger_entry_already_matched_to_another_statement_line: %', p_ledger_entry_id;
  end if;

  update public.bank_statement_lines
  set matched_ledger_entry_id = p_ledger_entry_id, match_status = 'matched'
  where id = p_statement_line_id
  returning * into v_line;

  return v_line;
end;
$$;


ALTER FUNCTION "public"."match_bank_statement_line"("p_statement_line_id" "uuid", "p_ledger_entry_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_document_number"("p_business_id" "uuid", "p_document_type" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.document_number_sequences;
  v_reset_key text;
  v_formatted text;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text || ':' || p_document_type));

  select * into v_row
  from public.document_number_sequences
  where business_id = p_business_id and document_type = p_document_type
  for update;

  if not found then
    insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
    values (p_business_id, p_document_type, upper(left(p_document_type, 3)), 'never')
    returning * into v_row;
  end if;

  v_reset_key := case v_row.reset_period
    when 'yearly' then to_char(now(), 'YYYY')
    when 'monthly' then to_char(now(), 'YYYYMM')
    else null
  end;

  if v_row.reset_period <> 'never' and (v_row.last_reset_key is distinct from v_reset_key) then
    v_row.next_number := 1;
  end if;

  v_formatted := case v_row.reset_period
    when 'never' then v_row.prefix || '-' || lpad(v_row.next_number::text, 6, '0')
    else v_row.prefix || '-' || v_reset_key || '-' || lpad(v_row.next_number::text, 4, '0')
  end;

  update public.document_number_sequences
  set next_number = v_row.next_number + 1,
      last_reset_key = v_reset_key
  where business_id = p_business_id and document_type = p_document_type;

  return v_formatted;
end;
$$;


ALTER FUNCTION "public"."next_document_number"("p_business_id" "uuid", "p_document_type" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ledger_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "business_data_id" "uuid",
    "chart_of_accounts_id" "uuid" NOT NULL,
    "direction" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "posted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reversal_of" "uuid",
    "posted_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ledger_entries_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "ledger_entries_direction_check" CHECK (("direction" = ANY (ARRAY['debit'::"text", 'credit'::"text"])))
);


ALTER TABLE "public"."ledger_entries" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."post_ledger_entries"("p_business_id" "uuid", "p_business_data_id" "uuid", "p_entries" "jsonb") RETURNS SETOF "public"."ledger_entries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_entry jsonb;
  v_debit_total numeric(14, 2) := 0;
  v_credit_total numeric(14, 2) := 0;
  v_direction text;
  v_amount numeric(14, 2);
  v_new_row public.ledger_entries;
  v_ids uuid[] := array[]::uuid[];
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'configure') then
    raise exception 'not_authorized: requires configure on accounting_reports';
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if p_entries is null or jsonb_array_length(p_entries) = 0 then
    raise exception 'no_entries_supplied';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_direction := v_entry ->> 'direction';
    v_amount := (v_entry ->> 'amount')::numeric;
    if v_direction not in ('debit', 'credit') then
      raise exception 'invalid_direction: %', v_direction;
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'invalid_amount: entries must have a positive amount';
    end if;
    if v_direction = 'debit' then
      v_debit_total := v_debit_total + v_amount;
    else
      v_credit_total := v_credit_total + v_amount;
    end if;
  end loop;

  if v_debit_total <> v_credit_total then
    raise exception 'unbalanced_ledger_entry_batch: debits % != credits %', v_debit_total, v_credit_total;
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    insert into public.ledger_entries (
      business_id, business_data_id, chart_of_accounts_id, direction, amount, currency,
      reversal_of, posted_by_membership_id
    ) values (
      p_business_id,
      p_business_data_id,
      (v_entry ->> 'chart_of_accounts_id')::uuid,
      v_entry ->> 'direction',
      (v_entry ->> 'amount')::numeric,
      coalesce(v_entry ->> 'currency', 'MYR'),
      nullif(v_entry ->> 'reversal_of', '')::uuid,
      v_caller_membership_id
    )
    returning * into v_new_row;
    v_ids := v_ids || v_new_row.id;
  end loop;

  return query select * from public.ledger_entries where id = any(v_ids) order by created_at asc;
end;
$$;


ALTER FUNCTION "public"."post_ledger_entries"("p_business_id" "uuid", "p_business_data_id" "uuid", "p_entries" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profit_and_loss_summary"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") RETURNS TABLE("total_revenue" numeric, "total_expense" numeric, "net_profit" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_revenue numeric(14, 2); v_expense numeric(14, 2);
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end), 0) into v_revenue
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'revenue'
    and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1);

  select coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) into v_expense
  from public.ledger_entries le
  join public.chart_of_accounts coa on coa.id = le.chart_of_accounts_id
  where coa.business_id = p_business_id and coa.account_type = 'expense'
    and le.posted_at >= p_date_from and le.posted_at < (p_date_to + 1);

  return query select v_revenue, v_expense, v_revenue - v_expense;
end;
$$;


ALTER FUNCTION "public"."profit_and_loss_summary"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_invoice_balance"("p_invoice_id" "uuid") RETURNS "public"."invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_invoice public.invoices;
  v_total_paid numeric(14, 2);
  v_total_credited numeric(14, 2);
  v_outstanding numeric(14, 2);
  v_new_status text;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice_not_found: %', p_invoice_id;
  end if;

  select coalesce(sum(amount), 0) into v_total_paid from public.payments where invoice_id = p_invoice_id;
  select coalesce(sum(grand_total), 0) into v_total_credited
    from public.credit_notes where source_invoice_id = p_invoice_id and status = 'issued';

  v_outstanding := v_invoice.grand_total - v_total_paid - v_total_credited;
  if v_outstanding < 0 then
    v_outstanding := 0;
  end if;

  if v_invoice.status in ('cancelled') then
    v_new_status := v_invoice.status; -- terminal, never reopened by a payment/credit
  elsif v_outstanding = 0 then
    v_new_status := 'paid';
  elsif v_total_paid > 0 or v_total_credited > 0 then
    v_new_status := 'partially_paid';
  else
    v_new_status := v_invoice.status;
  end if;

  update public.invoices set outstanding_balance = v_outstanding, status = v_new_status
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;


ALTER FUNCTION "public"."recompute_invoice_balance"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_access_model_transition_if_changed"("p_business_id" "uuid", "p_before" "text", "p_trigger_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_after text;
begin
  v_after := public.effective_access_model(p_business_id);
  if v_after is distinct from p_before then
    insert into public.business_access_model_transitions (business_id, transitioned_to, trigger_reason)
    values (p_business_id, v_after, p_trigger_reason);
  end if;
end;
$$;


ALTER FUNCTION "public"."record_access_model_transition_if_changed"("p_business_id" "uuid", "p_before" "text", "p_trigger_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_einvoice_submission_result"("p_submission_id" "uuid", "p_status" "text", "p_lhdn_uuid" "text" DEFAULT NULL::"text", "p_qr_code_ref" "text" DEFAULT NULL::"text", "p_irb_response_ref" "text" DEFAULT NULL::"text") RETURNS "public"."e_invoice_submissions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.e_invoice_submissions;
begin
  select * into v_row from public.e_invoice_submissions where id = p_submission_id for update;
  if not found then raise exception 'e_invoice_submission_not_found: %', p_submission_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if v_row.status <> 'submitted' then
    raise exception 'e_invoice_submission_not_submitted: current status %', v_row.status;
  end if;
  if p_status not in ('validated', 'rejected') then
    raise exception 'invalid_result_status: must be validated or rejected, got %', p_status;
  end if;
  if p_status = 'validated' and (p_lhdn_uuid is null or p_qr_code_ref is null) then
    raise exception 'validated_result_requires_lhdn_uuid_and_qr_code_ref';
  end if;

  update public.e_invoice_submissions
  set status = p_status, lhdn_uuid = p_lhdn_uuid, qr_code_ref = p_qr_code_ref, irb_response_ref = p_irb_response_ref
  where id = p_submission_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."record_einvoice_submission_result"("p_submission_id" "uuid", "p_status" "text", "p_lhdn_uuid" "text", "p_qr_code_ref" "text", "p_irb_response_ref" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_levels" (
    "business_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "warehouse_id" "uuid" NOT NULL,
    "quantity_on_hand" numeric(14,3) DEFAULT 0 NOT NULL,
    "last_movement_at" timestamp with time zone
);


ALTER TABLE "public"."stock_levels" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_opening_stock"("p_business_id" "uuid", "p_product_id" "uuid", "p_warehouse_id" "uuid", "p_quantity" numeric, "p_unit_cost" numeric DEFAULT NULL::numeric) RETURNS "public"."stock_levels"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_product public.products;
  v_row public.stock_levels;
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity: must be positive';
  end if;

  select * into v_product from public.products where id = p_product_id and business_id = p_business_id;
  if not found then raise exception 'product_not_found_for_this_business: %', p_product_id; end if;
  if not v_product.track_inventory then
    raise exception 'product_is_not_stock_tracked: %', p_product_id;
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and business_id = p_business_id) then
    raise exception 'warehouse_not_found_for_this_business: %', p_warehouse_id;
  end if;
  if exists (
    select 1 from public.stock_movements
    where product_id = p_product_id and warehouse_id = p_warehouse_id and movement_type = 'opening'
  ) then
    raise exception 'opening_stock_already_recorded_for_this_product_and_warehouse';
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.stock_movements (
    business_id, product_id, warehouse_id, movement_type, quantity, unit_cost,
    source_document_type, created_by_membership_id
  ) values (
    p_business_id, p_product_id, p_warehouse_id, 'opening', p_quantity, p_unit_cost,
    'manual', v_caller_membership_id
  );

  insert into public.stock_levels (business_id, product_id, warehouse_id, quantity_on_hand, last_movement_at)
  values (p_business_id, p_product_id, p_warehouse_id, p_quantity, now())
  on conflict (product_id, warehouse_id) do update
    set quantity_on_hand = public.stock_levels.quantity_on_hand + excluded.quantity_on_hand,
        last_movement_at = now()
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."record_opening_stock"("p_business_id" "uuid", "p_product_id" "uuid", "p_warehouse_id" "uuid", "p_quantity" numeric, "p_unit_cost" numeric) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "method" "text" NOT NULL,
    "received_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "reference" "text",
    "recorded_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "payments_method_check" CHECK (("method" = ANY (ARRAY['cash'::"text", 'bank_transfer'::"text", 'cheque'::"text", 'card'::"text", 'e_wallet'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_payment"("p_business_id" "uuid", "p_invoice_id" "uuid", "p_amount" numeric, "p_method" "text", "p_received_at" "date", "p_reference" "text") RETURNS "public"."payments"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller_membership_id uuid;
  v_invoice public.invoices;
  v_total_paid_so_far numeric(14, 2);
  v_total_credited numeric(14, 2);
  v_cash_account_id uuid;
  v_ar_account_id uuid;
  v_row public.payments;
begin
  if not (
    public.caller_has_capability(p_business_id, 'sales', 'capture')
    or public.caller_has_capability(p_business_id, 'accounting_reports', 'configure')
  ) then
    raise exception 'not_authorized: requires capture on sales, or configure on accounting_reports';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and business_id = p_business_id for update;
  if not found then
    raise exception 'invoice_not_found_for_this_business: %', p_invoice_id;
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'invoice_is_cancelled: %', p_invoice_id;
  end if;

  select coalesce(sum(amount), 0) into v_total_paid_so_far from public.payments where invoice_id = p_invoice_id;
  select coalesce(sum(grand_total), 0) into v_total_credited
    from public.credit_notes where source_invoice_id = p_invoice_id and status = 'issued';

  if v_total_paid_so_far + v_total_credited + p_amount > v_invoice.grand_total then
    raise exception 'payment_exceeds_outstanding_balance: invoice % has % outstanding, payment of % would exceed it',
      p_invoice_id, v_invoice.grand_total - v_total_paid_so_far - v_total_credited, p_amount;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.payments (
    business_id, invoice_id, amount, method, received_at, reference, recorded_by_membership_id
  ) values (
    p_business_id, p_invoice_id, p_amount, p_method, coalesce(p_received_at, current_date), p_reference, v_caller_membership_id
  ) returning * into v_row;

  select id into v_cash_account_id from public.chart_of_accounts where business_id = p_business_id and account_code = '1000';
  select id into v_ar_account_id from public.chart_of_accounts where business_id = p_business_id and account_code = '1100';
  if v_cash_account_id is null or v_ar_account_id is null then
    raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing 1000/1100', p_business_id;
  end if;
  insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
  values
    (p_business_id, v_cash_account_id, 'debit', p_amount, v_invoice.currency, v_caller_membership_id),
    (p_business_id, v_ar_account_id, 'credit', p_amount, v_invoice.currency, v_caller_membership_id);

  perform public.recompute_invoice_balance(p_invoice_id);

  return v_row;
end;
$$;


ALTER FUNCTION "public"."record_payment"("p_business_id" "uuid", "p_invoice_id" "uuid", "p_amount" numeric, "p_method" "text", "p_received_at" "date", "p_reference" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_take_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stock_take_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "system_qty" numeric(14,3) NOT NULL,
    "counted_qty" numeric(14,3),
    "variance" numeric(14,3)
);


ALTER TABLE "public"."stock_take_lines" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_stock_take_counts"("p_stock_take_id" "uuid", "p_counts" "jsonb") RETURNS SETOF "public"."stock_take_lines"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_stock_take public.stock_takes;
  v_count jsonb;
  v_product_id uuid;
  v_counted_qty numeric;
begin
  select * into v_stock_take from public.stock_takes where id = p_stock_take_id;
  if not found then raise exception 'stock_take_not_found: %', p_stock_take_id; end if;
  if not public.caller_has_capability(v_stock_take.business_id, 'inventory', 'capture') then
    raise exception 'not_authorized: requires capture on inventory';
  end if;
  if v_stock_take.status <> 'in_progress' then
    raise exception 'stock_take_not_in_progress: current status %', v_stock_take.status;
  end if;
  if p_counts is null or jsonb_array_length(p_counts) = 0 then
    raise exception 'no_counts_supplied';
  end if;

  for v_count in select * from jsonb_array_elements(p_counts) loop
    v_product_id := nullif(v_count ->> 'product_id', '')::uuid;
    v_counted_qty := (v_count ->> 'counted_qty')::numeric;
    if v_product_id is null or v_counted_qty is null or v_counted_qty < 0 then
      raise exception 'each_count_needs_a_product_id_and_a_nonnegative_counted_qty';
    end if;

    update public.stock_take_lines
    set counted_qty = v_counted_qty, variance = v_counted_qty - system_qty
    where stock_take_id = p_stock_take_id and product_id = v_product_id;

    if not found then
      raise exception 'product_%_not_on_this_stock_take_(not_stocked_in_this_warehouse_at_snapshot_time)', v_product_id;
    end if;
  end loop;

  return query select * from public.stock_take_lines where stock_take_id = p_stock_take_id order by product_id;
end;
$$;


ALTER FUNCTION "public"."record_stock_take_counts"("p_stock_take_id" "uuid", "p_counts" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devices" (
    "device_id" "text" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "device_label" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "registered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_synced_server_seq" bigint DEFAULT 0 NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "revoked_at" timestamp with time zone,
    "business_membership_id" "uuid" NOT NULL,
    CONSTRAINT "devices_platform_check" CHECK (("platform" = ANY (ARRAY['ios'::"text", 'android'::"text", 'web'::"text"])))
);


ALTER TABLE "public"."devices" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_device"("p_device_id" "text", "p_platform" "text", "p_device_label" "text") RETURNS "public"."devices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership record;
  v_is_first boolean;
  v_row public.devices;
  v_lock_token uuid;
begin
  select bm.id as membership_id, bm.business_id as business_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  -- Serialize registration per-membership (was per-business through
  -- Sprint 19) so two near-simultaneous registrations by the same
  -- person can never both believe they are "this membership's first
  -- device" — unrelated to, and no longer contending with, any other
  -- member's own registrations.
  perform pg_advisory_xact_lock(hashtext(v_membership.membership_id::text));

  select not exists (
    select 1 from public.devices
    where business_membership_id = v_membership.membership_id and revoked_at is null
  ) into v_is_first;

  insert into public.devices (
    device_id, business_id, business_membership_id, device_label, platform,
    registered_at, last_seen_at, last_synced_server_seq, is_primary
  ) values (
    p_device_id, v_membership.business_id, v_membership.membership_id, p_device_label, p_platform,
    now(), now(), 0, v_is_first
  )
  returning * into v_row;

  if v_is_first then
    v_lock_token := gen_random_uuid();
    insert into public.active_device_lock (business_membership_id, business_id, active_device_id, lock_token, acquired_at)
    values (v_membership.membership_id, v_membership.business_id, p_device_id, v_lock_token, now());
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."register_device"("p_device_id" "text", "p_platform" "text", "p_device_label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_membership"("p_target_membership_id" "uuid") RETURNS "public"."business_memberships"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller record;
  v_can_configure boolean;
  v_target record;
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_remaining_active_owners integer;
  v_before text;
  v_row public.business_memberships;
begin
  select bm.id as membership_id, bm.business_id as business_id, bm.role_id as role_id into v_caller
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  select id, business_id, role_id, status into v_target
  from public.business_memberships
  where id = p_target_membership_id;

  if v_target.id is null or v_target.business_id <> v_caller.business_id then
    raise exception 'membership_not_found_in_your_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_caller.role_id and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  -- Unlike suspend, removal of one's own membership is never
  -- self-service here (leaving a business is a real, disclosed gap this
  -- sprint does not build — Vol 13_1 does not describe a self-removal
  -- flow, only an Owner/configure-gated administrative one).
  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  if v_target.role_id = v_owner_role_id and v_target.status = 'active' then
    select count(*) into v_remaining_active_owners
    from public.business_memberships
    where business_id = v_target.business_id and status = 'active'
      and role_id = v_owner_role_id and id <> v_target.id;
    if v_remaining_active_owners = 0 then
      raise exception 'cannot_remove_sole_owner';
    end if;
  end if;

  v_before := public.effective_access_model(v_target.business_id);

  update public.business_memberships
  set status = 'removed', removed_at = now()
  where id = p_target_membership_id
  returning * into v_row;

  -- Device cleanup (Sprint 23's flagged gap, closed here): revoke every
  -- device this membership held, and drop its active_device_lock row
  -- entirely rather than leaving it pointing at a revoked device or
  -- forcing a replacement that cannot exist.
  update public.devices
  set revoked_at = now()
  where business_membership_id = p_target_membership_id and revoked_at is null;

  delete from public.active_device_lock
  where business_membership_id = p_target_membership_id;

  perform public.record_access_model_transition_if_changed(
    v_target.business_id, v_before, 'membership_removed'
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."remove_membership"("p_target_membership_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_device"("p_device_id" "text", "p_new_device_label" "text") RETURNS "public"."devices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership_id uuid;
  v_row public.devices;
begin
  select bm.id into v_membership_id
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership_id is null then
    raise exception 'no_active_membership';
  end if;

  if p_new_device_label is null or btrim(p_new_device_label) = '' then
    raise exception 'device_label_required';
  end if;

  update public.devices
  set device_label = p_new_device_label
  where device_id = p_device_id
    and business_membership_id = v_membership_id
    and revoked_at is null
  returning * into v_row;

  if not found then
    raise exception 'device_not_registered_or_revoked';
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."rename_device"("p_device_id" "text", "p_new_device_label" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."active_device_lock" (
    "business_id" "uuid" NOT NULL,
    "active_device_id" "text" NOT NULL,
    "lock_token" "uuid" NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "business_membership_id" "uuid" NOT NULL
);


ALTER TABLE "public"."active_device_lock" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_activation"("p_device_id" "text", "p_last_applied_server_seq" bigint, "p_expected_lock_token" "uuid") RETURNS "public"."active_device_lock"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership record;
  v_true_max_seq bigint;
  v_new_token uuid;
  v_row public.active_device_lock;
begin
  select bm.id as membership_id, bm.business_id as business_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_membership.membership_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_device_id
      and business_membership_id = v_membership.membership_id
      and revoked_at is null
  ) then
    raise exception 'device_not_registered_or_revoked';
  end if;

  -- Business-wide catch-up check (unchanged in spirit from Sprint 15):
  -- all members share one envelope stream.
  select coalesce(max(server_seq), 0) into v_true_max_seq
  from public.sync_envelopes
  where business_id = v_membership.business_id;

  if p_last_applied_server_seq <> v_true_max_seq then
    raise exception 'not_caught_up: device reports %, true max is %', p_last_applied_server_seq, v_true_max_seq;
  end if;

  v_new_token := gen_random_uuid();

  update public.active_device_lock
  set active_device_id = p_device_id,
      lock_token = v_new_token,
      acquired_at = now()
  where business_membership_id = v_membership.membership_id
    and lock_token is not distinct from p_expected_lock_token
  returning * into v_row;

  if not found then
    raise exception 'lock_conflict: the active-device lock changed since you last observed it — refresh and retry';
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."request_activation"("p_device_id" "text", "p_last_applied_server_seq" bigint, "p_expected_lock_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_primary_takeover"("p_device_id" "text", "p_last_applied_server_seq" bigint) RETURNS "public"."active_device_lock"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership record;
  v_true_max_seq bigint;
  v_new_token uuid;
  v_row public.active_device_lock;
begin
  select bm.id as membership_id, bm.business_id as business_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_membership.membership_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_device_id
      and business_membership_id = v_membership.membership_id
      and revoked_at is null
      and is_primary = true
  ) then
    raise exception 'device_not_primary_or_revoked';
  end if;

  select coalesce(max(server_seq), 0) into v_true_max_seq
  from public.sync_envelopes
  where business_id = v_membership.business_id;

  if p_last_applied_server_seq <> v_true_max_seq then
    raise exception 'not_caught_up: device reports %, true max is %', p_last_applied_server_seq, v_true_max_seq;
  end if;

  v_new_token := gen_random_uuid();

  update public.active_device_lock
  set active_device_id = p_device_id,
      lock_token = v_new_token,
      acquired_at = now()
  where business_membership_id = v_membership.membership_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."request_primary_takeover"("p_device_id" "text", "p_last_applied_server_seq" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_approval_task"("p_task_id" "uuid") RETURNS "public"."approval_tasks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.approval_tasks;
  v_business_id uuid;
  v_access_model text;
  v_policy public.segregation_of_duties_policies;
  v_sod_applies boolean := false;
  v_excluded_id uuid := null;
  v_owner_membership_id uuid;
  v_eligible_raw uuid[];
  v_eligible_filtered uuid[];
  v_delegate_candidates uuid[];
  v_delegated_from uuid;
  v_candidates uuid[];
  v_resolved_via text;
  v_assigned uuid;
  v_next_action text := null;
  v_escape_valve_invoked boolean := false;
begin
  select * into v_task from public.approval_tasks where id = p_task_id for update;
  if not found then
    raise exception 'approval_task_not_found: %', p_task_id;
  end if;
  if v_task.status <> 'pending_approval' then
    -- Already decided or otherwise terminal — nothing to (re-)resolve.
    return v_task;
  end if;

  v_business_id := v_task.business_id;
  v_access_model := public.effective_access_model(v_business_id);

  -- Vol 13_3 §3: a solo business resolves and confirms in the same
  -- transaction, no separate review step, in every domain including
  -- payroll (owner decision, 3 September 2026 — see this file's header).
  if v_access_model = 'solo' then
    update public.approval_tasks set
      resolved_via = 'solo_self_resolved',
      assigned_membership_id = v_task.captured_by_membership_id,
      status = 'approved',
      decided_by_membership_id = v_task.captured_by_membership_id,
      decided_at = now(),
      self_approved_via_escape_valve = false
    where id = p_task_id
    returning * into v_task;
    return v_task;
  end if;

  select id into v_owner_membership_id
  from public.business_memberships
  where business_id = v_business_id
    and status = 'active'
    and role_id = '00000000-0000-0000-0000-000000000001';

  -- Vol 13_2 §4.1/§4.3: does SoD's maker-exclusion apply to this
  -- domain/amount right now?
  select * into v_policy
  from public.segregation_of_duties_policies
  where business_id = v_business_id and domain = v_task.domain;

  if found and v_policy.enforce_maker_checker
     and v_task.captured_by_membership_id is not null
     and (v_task.amount is null or v_policy.amount_threshold_myr is null
          or v_task.amount >= v_policy.amount_threshold_myr) then
    v_sod_applies := true;
    v_excluded_id := v_task.captured_by_membership_id;
  end if;

  -- Step 1: eligible-by-permission-and-limit set.
  select coalesce(array_agg(bm.id), array[]::uuid[]) into v_eligible_raw
  from public.business_memberships bm
  join public.role_permissions rp on rp.role_id = bm.role_id
  where bm.business_id = v_business_id
    and bm.status = 'active'
    and rp.domain = v_task.domain
    and rp.capability = 'approve'
    and (
      v_task.amount is null
      or coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) is null
      or coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) >= v_task.amount
    );

  if v_sod_applies then
    select coalesce(array_agg(x), array[]::uuid[]) into v_eligible_filtered
    from unnest(v_eligible_raw) as x where x <> v_excluded_id;
  else
    v_eligible_filtered := v_eligible_raw;
  end if;

  if array_length(v_eligible_filtered, 1) > 0 then
    v_resolved_via := 'direct_permission';
    v_candidates := v_eligible_filtered;
  elsif v_sod_applies and array_length(v_eligible_raw, 1) = 1 and v_eligible_raw[1] = v_excluded_id then
    -- Vol 13_2 §4.2/§4.3: the maker was the *only* eligible approver.
    -- The escape valve decides self-approval vs. block.
    if v_policy.allow_self_approval_if_sole_eligible then
      v_resolved_via := 'direct_permission';
      v_candidates := array[v_excluded_id];
      v_escape_valve_invoked := true;
    else
      v_resolved_via := 'blocked_awaiting_reviewer';
      v_candidates := array[]::uuid[];
      v_next_action := 'Blocked: excluding the capturer leaves no eligible approver for ' || v_task.domain ||
        '. Ask an Owner to add a second approver, raise the SoD threshold, or enable self-approval for this domain.';
    end if;
  else
    -- Step 2: delegation lookup among members ineligible purely by
    -- limit (they have approve on this domain, just not a high enough
    -- one) — Vol 13_1 §6.1 Step 2.
    select coalesce(array_agg(d.delegate_membership_id), array[]::uuid[]) into v_delegate_candidates
    from public.business_memberships bm
    join public.role_permissions rp on rp.role_id = bm.role_id
    join public.approval_delegations d
      on d.delegator_membership_id = bm.id
      and d.status = 'active'
      and now() >= d.starts_at
      and (d.ends_at is null or now() < d.ends_at)
      and (d.domain_scope is null or d.domain_scope = v_task.domain)
    -- The delegate is NOT required to independently hold `approve` on
    -- this domain via their own role — Vol 13_1 §5 is explicit that
    -- delegation moves *whose queue* a task lands in, exercising the
    -- delegator's own permission grant, narrowed only by domain_scope
    -- and by whichever of the two has the lower approval_limit_myr. A
    -- delegate who happens to also hold their own approve grant on the
    -- domain is not treated any differently.
    join public.business_memberships delegate_bm on delegate_bm.id = d.delegate_membership_id
    where bm.business_id = v_business_id
      and bm.status = 'active'
      and rp.domain = v_task.domain
      and rp.capability = 'approve'
      and v_task.amount is not null
      and coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) is not null
      and coalesce(bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = bm.role_id)) < v_task.amount
      and delegate_bm.status = 'active'
      and (
        v_task.amount is null
        or coalesce(delegate_bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = delegate_bm.role_id)) is null
        or coalesce(delegate_bm.approval_limit_myr, (select r.default_approval_limit_myr from public.roles r where r.id = delegate_bm.role_id)) >= v_task.amount
      )
      and (not v_sod_applies or d.delegate_membership_id <> v_excluded_id);

    if array_length(v_delegate_candidates, 1) > 0 then
      v_resolved_via := 'delegation';
      v_candidates := v_delegate_candidates;
      if array_length(v_delegate_candidates, 1) = 1 then
        select d.delegator_membership_id into v_delegated_from
        from public.approval_delegations d
        where d.delegate_membership_id = v_delegate_candidates[1]
          and d.status = 'active'
          and now() >= d.starts_at and (d.ends_at is null or now() < d.ends_at)
          and (d.domain_scope is null or d.domain_scope = v_task.domain)
        limit 1;
      end if;
    else
      -- Step 3: escalate to Owner — "never leave a task with nowhere
      -- to go" (Vol 13_1 §6.1 Step 3), exempt from SoD exclusion, since
      -- the Owner fallback is the guaranteed-to-exist last resort.
      if v_owner_membership_id is null then
        raise exception 'no_active_owner_membership_to_escalate_to: %', v_business_id;
      end if;
      v_resolved_via := 'escalation';
      v_candidates := array[v_owner_membership_id];
      if v_sod_applies and v_owner_membership_id = v_task.captured_by_membership_id then
        -- SoD wanted to exclude the maker, but the guaranteed Owner
        -- fallback (Step 3) landed right back on them — still an
        -- escape-valve outcome, just reached via escalation rather
        -- than the explicit sole-eligible branch above.
        v_escape_valve_invoked := true;
      end if;
    end if;
  end if;

  if array_length(v_candidates, 1) = 1 then
    v_assigned := v_candidates[1];
  else
    v_assigned := null;
  end if;

  update public.approval_tasks set
    resolved_via = v_resolved_via,
    assigned_membership_id = v_assigned,
    delegated_from_membership_id = case when v_resolved_via = 'delegation' then v_delegated_from else null end,
    next_action = v_next_action,
    -- Vol 13_2 §5: flag set only when the escape valve mechanism was
    -- actually what let this resolve to self-approval (SoD wanted to
    -- exclude the maker, and either the sole-eligible branch or the
    -- Owner-escalation fallback put it right back on them) — NOT for
    -- the ordinary case of a maker who is simply, unexceptionally,
    -- also a valid approver (e.g. below SoD's amount_threshold_myr, or
    -- no SoD policy in force for this domain at all), which is not an
    -- escape-valve outcome and would mislabel every routine below-
    -- threshold self-approval as a control exception if flagged blindly.
    self_approved_via_escape_valve = v_escape_valve_invoked
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;


ALTER FUNCTION "public"."resolve_approval_task"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_capture_triage_item"("p_id" "uuid", "p_status" "text") RETURNS "public"."capture_triage"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_row public.capture_triage;
  v_caller_membership_id uuid;
begin
  select ct.* into v_row from public.capture_triage ct where ct.id = p_id;
  if not found then
    raise exception 'capture_triage_item_not_found: %', p_id;
  end if;
  if p_status not in ('dismissed', 'resolved') then
    raise exception 'invalid_status: must be dismissed or resolved';
  end if;
  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_row.business_id and bm.user_id = auth.uid() and bm.status = 'active';
  if v_caller_membership_id is null then
    raise exception 'not_authorized: no active membership for this business';
  end if;

  update public.capture_triage set status = p_status where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."resolve_capture_triage_item"("p_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_price"("p_business_id" "uuid", "p_product_id" "uuid", "p_party_id" "uuid") RETURNS TABLE("unit_price" numeric, "price_type_id" "uuid", "price_list_entry_id" "uuid", "used_business_default" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_party_price_type_id uuid; v_default_price_type_id uuid; v_row record;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'view') then
    raise exception 'not_authorized: requires view on pricing';
  end if;

  if p_party_id is not null then
    select pty.price_type_id into v_party_price_type_id from public.parties pty
    where pty.id = p_party_id and pty.business_id = p_business_id;
  end if;
  if v_party_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id and ple.price_type_id = v_party_price_type_id
      and ple.effective_from <= current_date and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc limit 1;
    if found then return query select v_row.up, v_row.pt, v_row.id, false; return; end if;
  end if;
  select id into v_default_price_type_id from public.price_types where business_id = p_business_id and is_default;
  if v_default_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id and ple.price_type_id = v_default_price_type_id
      and ple.effective_from <= current_date and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc limit 1;
    if found then return query select v_row.up, v_row.pt, v_row.id, true; return; end if;
  end if;
  raise exception 'no_price_resolvable: no effective PriceListEntry for product % under the party''s price type or the business default', p_product_id;
end; $$;


ALTER FUNCTION "public"."resolve_price"("p_business_id" "uuid", "p_product_id" "uuid", "p_party_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revenue_vs_cost_dashboard"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") RETURNS TABLE("revenue" numeric, "payroll_cost" numeric, "commission_cost" numeric, "net" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_revenue numeric; v_payroll_cost numeric; v_commission_cost numeric;
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  select coalesce(sum(grand_total), 0) into v_revenue from public.invoices
  where business_id = p_business_id and status not in ('draft', 'cancelled')
    and issue_date >= p_date_from and issue_date <= p_date_to;

  select coalesce(sum(total_net_pay), 0) into v_payroll_cost from public.payroll_runs
  where business_id = p_business_id and status in ('approved', 'paid')
    and to_date(period, 'YYYY-MM') >= date_trunc('month', p_date_from)
    and to_date(period, 'YYYY-MM') <= date_trunc('month', p_date_to);

  select coalesce(sum(amount), 0) into v_commission_cost from public.commission_calculations
  where business_id = p_business_id and status in ('approved', 'paid')
    and created_at::date >= p_date_from and created_at::date <= p_date_to;

  return query select v_revenue, v_payroll_cost, v_commission_cost, v_revenue - v_payroll_cost - v_commission_cost;
end;
$$;


ALTER FUNCTION "public"."revenue_vs_cost_dashboard"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_approval_delegation"("p_delegation_id" "uuid") RETURNS "public"."approval_delegations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_delegation public.approval_delegations;
  v_caller_membership_id uuid;
  v_can_configure boolean;
begin
  select * into v_delegation from public.approval_delegations where id = p_delegation_id;
  if not found then
    raise exception 'delegation_not_found: %', p_delegation_id;
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = v_delegation.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller_membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  if v_caller_membership_id <> v_delegation.delegator_membership_id then
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = (select role_id from public.business_memberships where id = v_caller_membership_id)
        and rp.domain = 'settings' and rp.capability = 'configure'
    ) into v_can_configure;
    if not v_can_configure then
      raise exception 'not_authorized: can only revoke your own delegation, unless you have configure on settings';
    end if;
  end if;

  update public.approval_delegations set status = 'revoked'
  where id = p_delegation_id
  returning * into v_delegation;

  perform public.resolve_approval_task(t.id)
  from public.approval_tasks t
  where t.business_id = v_delegation.business_id
    and t.status = 'pending_approval'
    and (v_delegation.domain_scope is null or t.domain = v_delegation.domain_scope);

  return v_delegation;
end;
$$;


ALTER FUNCTION "public"."revoke_approval_delegation"("p_delegation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_device"("p_device_id" "text", "p_new_active_device_id" "text" DEFAULT NULL::"text", "p_new_primary_device_id" "text" DEFAULT NULL::"text") RETURNS "public"."devices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership record;
  v_target_membership_id uuid;
  v_can_configure_settings boolean;
  v_was_active boolean;
  v_was_primary boolean;
  v_new_lock_token uuid;
  v_row public.devices;
begin
  select bm.id as membership_id, bm.business_id as business_id, bm.role_id as role_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  select d.business_membership_id into v_target_membership_id
  from public.devices d
  where d.device_id = p_device_id and d.revoked_at is null;

  if v_target_membership_id is null then
    raise exception 'device_not_registered_or_revoked';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure_settings;

  if v_target_membership_id <> v_membership.membership_id and not v_can_configure_settings then
    raise exception 'not_authorized_to_revoke_this_device';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_target_membership_id::text));

  select
    exists (
      select 1 from public.active_device_lock
      where business_membership_id = v_target_membership_id and active_device_id = p_device_id
    ),
    is_primary
  into v_was_active, v_was_primary
  from public.devices
  where device_id = p_device_id and business_membership_id = v_target_membership_id;

  if v_was_active and p_new_active_device_id is null then
    raise exception 'must_designate_replacement_active_device';
  end if;

  if v_was_primary and p_new_primary_device_id is null then
    raise exception 'must_designate_new_primary_device';
  end if;

  if p_new_active_device_id is not null and not exists (
    select 1 from public.devices
    where device_id = p_new_active_device_id
      and business_membership_id = v_target_membership_id
      and revoked_at is null
      and device_id <> p_device_id
  ) then
    raise exception 'replacement_active_device_not_registered_or_revoked';
  end if;

  if p_new_primary_device_id is not null and not exists (
    select 1 from public.devices
    where device_id = p_new_primary_device_id
      and business_membership_id = v_target_membership_id
      and revoked_at is null
      and device_id <> p_device_id
  ) then
    raise exception 'replacement_primary_device_not_registered_or_revoked';
  end if;

  update public.devices
  set revoked_at = now()
  where device_id = p_device_id and business_membership_id = v_target_membership_id
  returning * into v_row;

  if p_new_active_device_id is not null then
    v_new_lock_token := gen_random_uuid();
    update public.active_device_lock
    set active_device_id = p_new_active_device_id,
        lock_token = v_new_lock_token,
        acquired_at = now()
    where business_membership_id = v_target_membership_id;
  end if;

  if p_new_primary_device_id is not null then
    update public.devices
    set is_primary = false
    where business_membership_id = v_target_membership_id and is_primary = true;

    update public.devices
    set is_primary = true
    where device_id = p_new_primary_device_id and business_membership_id = v_target_membership_id;
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."revoke_device"("p_device_id" "text", "p_new_active_device_id" "text", "p_new_primary_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_chart_of_accounts_on_business_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.seed_phase1_chart_of_accounts(new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."seed_chart_of_accounts_on_business_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_phase1_chart_of_accounts"("p_business_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_opex_id uuid;
begin
  insert into public.chart_of_accounts (business_id, account_code, account_name, account_type, is_system)
  values
    (p_business_id, '1000', 'Cash / Bank', 'asset', true),
    (p_business_id, '1100', 'Accounts Receivable', 'asset', true),
    (p_business_id, '2000', 'Accounts Payable', 'liability', true),
    (p_business_id, '2100', 'Statutory Contributions Payable', 'liability', true),
    (p_business_id, '3000', 'Owner''s Equity / Drawings', 'equity', true),
    (p_business_id, '4000', 'Sales Revenue', 'revenue', true),
    (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true)
  on conflict (business_id, account_code) do nothing;

  insert into public.chart_of_accounts (business_id, account_code, account_name, account_type, is_system)
  values (p_business_id, '6000', 'Operating Expenses', 'expense', true)
  on conflict (business_id, account_code) do nothing;

  select id into v_opex_id from public.chart_of_accounts
  where business_id = p_business_id and account_code = '6000';

  insert into public.chart_of_accounts (business_id, account_code, account_name, account_type, parent_account_id, is_system)
  values
    (p_business_id, '6100', 'Supplies', 'expense', v_opex_id, true),
    (p_business_id, '6200', 'Rent', 'expense', v_opex_id, true),
    (p_business_id, '6300', 'Utilities', 'expense', v_opex_id, true),
    (p_business_id, '6400', 'Marketing', 'expense', v_opex_id, true),
    (p_business_id, '6500', 'Salaries & Wages', 'expense', v_opex_id, true),
    (p_business_id, '6900', 'Other', 'expense', v_opex_id, true)
  on conflict (business_id, account_code) do nothing;
end;
$$;


ALTER FUNCTION "public"."seed_phase1_chart_of_accounts"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_sod_policies_on_first_team_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.transitioned_to = 'team' and not exists (
    select 1 from public.business_access_model_transitions
    where business_id = new.business_id
      and transitioned_to = 'team'
      and id <> new.id
  ) then
    insert into public.segregation_of_duties_policies (
      business_id, domain, enforce_maker_checker, amount_threshold_myr,
      allow_self_approval_if_sole_eligible
    )
    select new.business_id, v.domain, v.enforce, v.threshold, true
    from (values
      ('sales', true, 2000.00),
      ('expense', true, 500.00),
      ('payroll', true, null::numeric),
      ('legal_contract', true, null::numeric),
      ('hr_attendance_leave', false, null::numeric),
      ('inventory', false, null::numeric),
      ('pricing', true, null::numeric),
      ('accounting_reports', true, null::numeric),
      ('tax_compliance', true, null::numeric),
      ('commission', true, null::numeric),
      ('settings', true, null::numeric)
    ) as v(domain, enforce, threshold)
    on conflict (business_id, domain) do nothing;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."seed_sod_policies_on_first_team_transition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_access_model_override"("p_business_id" "uuid", "p_override" "text") RETURNS "public"."businesses"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership record;
  v_can_configure boolean;
  v_before text;
  v_row public.businesses;
begin
  if p_override is not null and p_override not in ('forced_solo', 'forced_team') then
    raise exception 'invalid_override_value: must be forced_solo, forced_team, or null';
  end if;

  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  v_before := public.effective_access_model(p_business_id);

  update public.businesses
  set access_model_override = p_override
  where id = p_business_id
  returning * into v_row;

  perform public.record_access_model_transition_if_changed(
    p_business_id, v_before,
    case when p_override is null then 'override_cleared' else 'override_set' end
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."set_access_model_override"("p_business_id" "uuid", "p_override" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_default_price_type"("p_business_id" "uuid", "p_price_type_id" "uuid") RETURNS "public"."price_types"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_row public.price_types;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if not exists (select 1 from public.price_types where id = p_price_type_id and business_id = p_business_id) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  update public.price_types set is_default = false where business_id = p_business_id and is_default;
  update public.price_types set is_default = true where id = p_price_type_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."set_default_price_type"("p_business_id" "uuid", "p_price_type_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_member_label"("p_membership_id" "uuid", "p_label" "text") RETURNS "public"."business_memberships"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$ declare v_target public.business_memberships; v_caller_membership record; v_can_configure boolean; v_row public.business_memberships; begin select * into v_target from public.business_memberships where id = p_membership_id; if not found then raise exception 'membership_not_found: %', p_membership_id; end if; select bm.id as membership_id, bm.role_id as role_id into v_caller_membership from public.business_memberships bm where bm.business_id = v_target.business_id and bm.user_id = auth.uid() and bm.status = 'active'; if v_caller_membership.membership_id is null then raise exception 'no_active_membership_for_this_business'; end if; select exists ( select 1 from public.role_permissions rp where rp.role_id = v_caller_membership.role_id and rp.domain = 'settings' and rp.capability = 'configure' ) into v_can_configure; if not v_can_configure then raise exception 'not_authorized: requires configure on settings'; end if; update public.business_memberships set owner_label = nullif(btrim(p_label), '') where id = p_membership_id returning * into v_row; return v_row; end; $$;


ALTER FUNCTION "public"."set_member_label"("p_membership_id" "uuid", "p_label" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "business_name" "text",
    "industry" "text",
    "pka_version" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_display_name"("p_display_name" "text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$ declare v_row public.profiles; begin if auth.uid() is null then raise exception 'not_authenticated'; end if; insert into public.profiles (id, display_name) values (auth.uid(), nullif(btrim(p_display_name), '')) on conflict (id) do update set display_name = excluded.display_name returning * into v_row; return v_row; end; $$;


ALTER FUNCTION "public"."set_my_display_name"("p_display_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_party_price_type"("p_party_id" "uuid", "p_price_type_id" "uuid") RETURNS "public"."parties"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_business_id uuid;
  v_row public.parties;
begin
  select business_id into v_business_id from public.parties where id = p_party_id;
  if v_business_id is null then
    raise exception 'party_not_found: %', p_party_id;
  end if;
  if not public.caller_has_capability(v_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if p_price_type_id is not null and not exists (
    select 1 from public.price_types where id = p_price_type_id and business_id = v_business_id
  ) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  update public.parties set price_type_id = p_price_type_id
  where id = p_party_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."set_party_price_type"("p_party_id" "uuid", "p_price_type_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_primary_device"("p_new_primary_device_id" "text") RETURNS "public"."devices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership record;
  v_row public.devices;
begin
  select bm.id as membership_id
    into v_membership
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_membership.membership_id::text));

  if not exists (
    select 1 from public.devices
    where device_id = p_new_primary_device_id
      and business_membership_id = v_membership.membership_id
      and revoked_at is null
  ) then
    raise exception 'device_not_registered_or_revoked';
  end if;

  update public.devices
  set is_primary = false
  where business_membership_id = v_membership.membership_id and is_primary = true;

  update public.devices
  set is_primary = true
  where device_id = p_new_primary_device_id and business_membership_id = v_membership.membership_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."set_primary_device"("p_new_primary_device_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."segregation_of_duties_policies" (
    "business_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "enforce_maker_checker" boolean DEFAULT true NOT NULL,
    "amount_threshold_myr" numeric(14,2),
    "allow_self_approval_if_sole_eligible" boolean DEFAULT true NOT NULL,
    CONSTRAINT "segregation_of_duties_policies_domain_check" CHECK (("domain" = ANY (ARRAY['sales'::"text", 'pricing'::"text", 'expense'::"text", 'inventory'::"text", 'accounting_reports'::"text", 'tax_compliance'::"text", 'payroll'::"text", 'hr_attendance_leave'::"text", 'commission'::"text", 'legal_contract'::"text", 'settings'::"text"])))
);


ALTER TABLE "public"."segregation_of_duties_policies" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_sod_policy"("p_business_id" "uuid", "p_domain" "text", "p_enforce_maker_checker" boolean, "p_amount_threshold_myr" numeric, "p_allow_self_approval_if_sole_eligible" boolean) RETURNS "public"."segregation_of_duties_policies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership record;
  v_can_configure boolean;
  v_row public.segregation_of_duties_policies;
begin
  select bm.id as membership_id, bm.role_id as role_id into v_membership
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if v_membership.membership_id is null then
    raise exception 'no_active_membership_for_this_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_membership.role_id
      and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure then
    raise exception 'not_authorized: requires configure on settings';
  end if;

  insert into public.segregation_of_duties_policies (
    business_id, domain, enforce_maker_checker, amount_threshold_myr,
    allow_self_approval_if_sole_eligible
  ) values (
    p_business_id, p_domain, p_enforce_maker_checker, p_amount_threshold_myr,
    p_allow_self_approval_if_sole_eligible
  )
  on conflict (business_id, domain) do update set
    enforce_maker_checker = excluded.enforce_maker_checker,
    amount_threshold_myr = excluded.amount_threshold_myr,
    allow_self_approval_if_sole_eligible = excluded.allow_self_approval_if_sole_eligible
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."set_sod_policy"("p_business_id" "uuid", "p_domain" "text", "p_enforce_maker_checker" boolean, "p_amount_threshold_myr" numeric, "p_allow_self_approval_if_sole_eligible" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stock_report"("p_business_id" "uuid", "p_warehouse_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("product_id" "uuid", "sku" "text", "product_name" "text", "warehouse_id" "uuid", "quantity_on_hand" numeric, "unit_cost" numeric, "valuation" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.caller_has_capability(p_business_id, 'inventory', 'view') then
    raise exception 'not_authorized: requires view on inventory';
  end if;

  return query
  select
    p.id, p.sku, p.name, sl.warehouse_id, sl.quantity_on_hand, p.default_cost,
    sl.quantity_on_hand * coalesce(p.default_cost, 0)
  from public.stock_levels sl
  join public.products p on p.id = sl.product_id
  where sl.business_id = p_business_id
    and (p_warehouse_id is null or sl.warehouse_id = p_warehouse_id)
  order by p.name;
end;
$$;


ALTER FUNCTION "public"."stock_report"("p_business_id" "uuid", "p_warehouse_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_einvoice"("p_submission_id" "uuid") RETURNS "public"."e_invoice_submissions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.e_invoice_submissions;
begin
  select * into v_row from public.e_invoice_submissions where id = p_submission_id for update;
  if not found then raise exception 'e_invoice_submission_not_found: %', p_submission_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'e_invoice_submission_not_in_draft_status: current status %', v_row.status;
  end if;

  update public.e_invoice_submissions set status = 'submitted', submitted_at = now()
  where id = p_submission_id returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."submit_einvoice"("p_submission_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_payroll_run"("p_payroll_run_id" "uuid") RETURNS "public"."payroll_runs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.payroll_runs; v_caller_membership_id uuid; v_payslip_count integer;
begin
  select * into v_row from public.payroll_runs where id = p_payroll_run_id for update;
  if not found then raise exception 'payroll_run_not_found: %', p_payroll_run_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'payroll', 'capture') then
    raise exception 'not_authorized: requires capture on payroll';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'payroll_run_not_in_draft_status: current status %', v_row.status;
  end if;
  select count(*) into v_payslip_count from public.payslips where payroll_run_id = p_payroll_run_id;
  if v_payslip_count = 0 then
    raise exception 'payroll_run_has_no_payslips: nothing to submit for approval';
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_row.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  update public.payroll_runs set status = 'pending_approval' where id = p_payroll_run_id returning * into v_row;

  perform public.create_approval_task(
    v_row.business_id, 'payroll', 'payroll_run', v_row.id, v_row.total_net_pay,
    'Payroll run for period ' || v_row.period || ', total net pay ' || v_row.total_net_pay,
    null, v_caller_membership_id, false, 'generate bulk payment file' -- p_auto_approved hardcoded false, not passed through
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."submit_payroll_run"("p_payroll_run_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_sst_return"("p_sst_return_id" "uuid") RETURNS "public"."sst_returns"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_row public.sst_returns;
begin
  select * into v_row from public.sst_returns where id = p_sst_return_id for update;
  if not found then raise exception 'sst_return_not_found: %', p_sst_return_id; end if;
  if not public.caller_has_capability(v_row.business_id, 'tax_compliance', 'capture') then
    raise exception 'not_authorized: requires capture on tax_compliance';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'sst_return_not_in_draft_status: current status %', v_row.status;
  end if;

  update public.sst_returns set status = 'submitted', submitted_at = now()
  where id = p_sst_return_id returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."submit_sst_return"("p_sst_return_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."suspend_membership"("p_target_membership_id" "uuid") RETURNS "public"."business_memberships"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_caller record;
  v_can_configure boolean;
  v_target record;
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_remaining_active_owners integer;
  v_row public.business_memberships;
begin
  select bm.id as membership_id, bm.business_id as business_id, bm.role_id as role_id into v_caller
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active';

  if v_caller.membership_id is null then
    raise exception 'no_active_membership';
  end if;

  select id, business_id, role_id into v_target
  from public.business_memberships
  where id = p_target_membership_id;

  if v_target.id is null or v_target.business_id <> v_caller.business_id then
    raise exception 'membership_not_found_in_your_business';
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_caller.role_id and rp.domain = 'settings' and rp.capability = 'configure'
  ) into v_can_configure;

  if not v_can_configure and v_target.id <> v_caller.membership_id then
    raise exception 'not_authorized: requires configure on settings to suspend another member';
  end if;

  if v_target.role_id = v_owner_role_id then
    select count(*) into v_remaining_active_owners
    from public.business_memberships
    where business_id = v_target.business_id and status = 'active'
      and role_id = v_owner_role_id and id <> v_target.id;
    if v_remaining_active_owners = 0 then
      raise exception 'cannot_suspend_sole_owner';
    end if;
  end if;

  update public.business_memberships
  set status = 'suspended'
  where id = p_target_membership_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."suspend_membership"("p_target_membership_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_claim_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type <> 'claim' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.claims set status = 'approved' where id = new.subject_id and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.claims set status = 'rejected' where id = new.subject_id and status = 'pending_approval';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_claim_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_commission_calculation_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type <> 'commission_calculation' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.commission_calculations set status = 'approved' where id = new.subject_id and status = 'computed';
  elsif new.status = 'rejected' then
    delete from public.commission_calculations where id = new.subject_id and status = 'computed'; -- see header note 6
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_commission_calculation_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_contract_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type <> 'contract' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.contracts set status = 'pending_signature' where id = new.subject_id and status = 'draft';
  elsif new.status = 'rejected' then
    delete from public.contracts where id = new.subject_id and status = 'draft'; -- see header note 3
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_contract_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_credit_note_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_credit_note public.credit_notes;
  v_revenue_account_id uuid;
  v_ar_account_id uuid;
begin
  if new.subject_type <> 'credit_note' or old.status is not distinct from new.status then
    return new;
  end if;

  select * into v_credit_note from public.credit_notes where id = new.subject_id and status = 'draft' for update;
  if not found then
    return new; -- already processed, or not a credit note task
  end if;

  if new.status in ('approved', 'auto_approved') then
    select id into v_revenue_account_id from public.chart_of_accounts
      where business_id = v_credit_note.business_id and account_code = '4000';
    select id into v_ar_account_id from public.chart_of_accounts
      where business_id = v_credit_note.business_id and account_code = '1100';
    if v_revenue_account_id is null or v_ar_account_id is null then
      raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing 4000/1100', v_credit_note.business_id;
    end if;

    insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
    values
      (v_credit_note.business_id, v_revenue_account_id, 'debit', v_credit_note.grand_total, v_credit_note.currency, new.decided_by_membership_id),
      (v_credit_note.business_id, v_ar_account_id, 'credit', v_credit_note.grand_total, v_credit_note.currency, new.decided_by_membership_id);

    update public.credit_notes set status = 'issued' where id = v_credit_note.id;
    perform public.recompute_invoice_balance(v_credit_note.source_invoice_id);
  elsif new.status = 'rejected' then
    update public.credit_notes set status = 'rejected' where id = v_credit_note.id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_credit_note_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_delivery_order_on_task_rejection"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type = 'delivery_order' and new.status = 'rejected' and old.status is distinct from new.status then
    update public.delivery_orders set status = 'rejected' where id = new.subject_id and status = 'draft';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_delivery_order_on_task_rejection"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_leave_application_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_app public.leave_applications; v_days numeric;
begin
  if new.subject_type <> 'leave_application' or old.status is not distinct from new.status then
    return new;
  end if;
  select * into v_app from public.leave_applications where id = new.subject_id and status = 'pending_approval';
  if not found then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    v_days := (v_app.end_date - v_app.start_date) + 1;
    update public.leave_balances set used_days = used_days + v_days
    where employee_party_id = v_app.employee_party_id and leave_type_id = v_app.leave_type_id
      and year = extract(year from v_app.start_date)::integer;
    update public.leave_applications set status = 'approved', approved_by = new.decided_by_membership_id
    where id = new.subject_id;
  elsif new.status = 'rejected' then
    update public.leave_applications set status = 'rejected', approved_by = new.decided_by_membership_id
    where id = new.subject_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_leave_application_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_overtime_record_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type <> 'overtime_record' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.overtime_records set status = 'approved' where id = new.subject_id and status = 'draft';
  elsif new.status = 'rejected' then
    delete from public.overtime_records where id = new.subject_id and status = 'draft'; -- see header note 6
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_overtime_record_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_payment_voucher_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type <> 'payment_voucher' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.payment_vouchers set status = 'approved' where id = new.subject_id and status = 'draft';
  elsif new.status = 'rejected' then
    update public.payment_vouchers set status = 'rejected' where id = new.subject_id and status = 'draft';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_payment_voucher_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_payroll_run_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type <> 'payroll_run' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status = 'approved' then -- deliberately excludes 'auto_approved': see header note 7, that path is hard-blocked upstream
    update public.payroll_runs set status = 'approved' where id = new.subject_id and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.payroll_runs set status = 'draft' where id = new.subject_id and status = 'pending_approval';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_payroll_run_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_quotation_status_on_task_rejection"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type = 'quotation' and new.status = 'rejected' and old.status is distinct from new.status then
    update public.quotations set status = 'rejected'
    where id = new.subject_id and status = 'draft';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_quotation_status_on_task_rejection"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_salary_advance_on_task_decision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.subject_type <> 'salary_advance' or old.status is not distinct from new.status then
    return new;
  end if;
  if new.status in ('approved', 'auto_approved') then
    update public.salary_advances set status = 'approved' where id = new.subject_id and status = 'pending_approval';
  elsif new.status = 'rejected' then
    update public.salary_advances set status = 'rejected' where id = new.subject_id and status = 'pending_approval';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_salary_advance_on_task_decision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tax_report_placeholder"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") RETURNS TABLE("date_from" "date", "date_to" "date", "output_tax_sst" numeric, "input_tax_sst" numeric, "note" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.caller_has_capability(p_business_id, 'tax_compliance', 'view') then
    raise exception 'not_authorized: requires view on tax_compliance';
  end if;

  return query select
    p_date_from, p_date_to, null::numeric, null::numeric,
    'Placeholder only — SST/e-Invoice figures are not computed yet; see Sprint 33 (Vol 13_0 §9).'::text;
end;
$$;


ALTER FUNCTION "public"."tax_report_placeholder"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_device_heartbeat"("p_device_id" "text", "p_last_synced_server_seq" bigint) RETURNS "public"."devices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_membership_id uuid;
  v_row public.devices;
begin
  select bm.id into v_membership_id
  from public.business_memberships bm
  where bm.user_id = auth.uid() and bm.status = 'active'
  limit 1;

  if v_membership_id is null then
    raise exception 'no_active_membership';
  end if;

  update public.devices
  set last_seen_at = now(),
      last_synced_server_seq = p_last_synced_server_seq
  where device_id = p_device_id
    and business_membership_id = v_membership_id
    and revoked_at is null
  returning * into v_row;

  if not found then
    raise exception 'device_not_registered_or_revoked';
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."touch_device_heartbeat"("p_device_id" "text", "p_last_synced_server_seq" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trial_balance"("p_business_id" "uuid", "p_as_of_date" "date") RETURNS TABLE("account_code" "text", "account_name" "text", "account_type" "text", "total_debit" numeric, "total_credit" numeric, "balance" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.caller_has_capability(p_business_id, 'accounting_reports', 'view') then
    raise exception 'not_authorized: requires view on accounting_reports';
  end if;

  return query
  select
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coalesce(sum(case when le.direction = 'debit' then le.amount else 0 end), 0) as total_debit,
    coalesce(sum(case when le.direction = 'credit' then le.amount else 0 end), 0) as total_credit,
    coalesce(sum(case when le.direction = 'debit' then le.amount else -le.amount end), 0) as balance
  from public.chart_of_accounts coa
  left join public.ledger_entries le
    on le.chart_of_accounts_id = coa.id and le.posted_at < (p_as_of_date + 1)
  where coa.business_id = p_business_id
  group by coa.id, coa.account_code, coa.account_name, coa.account_type
  order by coa.account_code;
end;
$$;


ALTER FUNCTION "public"."trial_balance"("p_business_id" "uuid", "p_as_of_date" "date") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."backups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_access_model_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "transitioned_to" "text" NOT NULL,
    "trigger_reason" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "business_access_model_transitions_transitioned_to_check" CHECK (("transitioned_to" = ANY (ARRAY['solo'::"text", 'team'::"text"]))),
    CONSTRAINT "business_access_model_transitions_trigger_reason_check" CHECK (("trigger_reason" = ANY (ARRAY['membership_accepted'::"text", 'membership_removed'::"text", 'override_set'::"text", 'override_cleared'::"text"])))
);


ALTER TABLE "public"."business_access_model_transitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_limit_override_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "party_id" "uuid" NOT NULL,
    "requested_amount" numeric(14,2) NOT NULL,
    "effective_credit_limit" numeric(14,2) NOT NULL,
    "outstanding_balance_before" numeric(14,2) NOT NULL,
    "overridden_by_membership_id" "uuid",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."credit_limit_override_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_order_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "delivery_order_id" "uuid" NOT NULL,
    "line_no" integer NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    CONSTRAINT "delivery_order_lines_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."delivery_order_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."e_invoice_submission_lines" (
    "submission_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL
);


ALTER TABLE "public"."e_invoice_submission_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "line_no" integer NOT NULL,
    "product_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_price" numeric(14,2) NOT NULL,
    "unit_cost" numeric(14,2),
    "tax_code" "text",
    "discount_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "line_total" numeric(14,2) NOT NULL,
    CONSTRAINT "invoice_lines_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "invoice_lines_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."invoice_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "domain" "text" NOT NULL,
    "capability" "text" NOT NULL,
    CONSTRAINT "permissions_capability_check" CHECK (("capability" = ANY (ARRAY['view'::"text", 'capture'::"text", 'approve'::"text", 'configure'::"text"]))),
    CONSTRAINT "permissions_domain_check" CHECK (("domain" = ANY (ARRAY['sales'::"text", 'pricing'::"text", 'expense'::"text", 'inventory'::"text", 'accounting_reports'::"text", 'tax_compliance'::"text", 'payroll'::"text", 'hr_attendance_leave'::"text", 'commission'::"text", 'legal_contract'::"text", 'settings'::"text"])))
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_import_rows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "row_no" integer NOT NULL,
    "raw_data" "jsonb" NOT NULL,
    "parsed_sku" "text",
    "parsed_name" "text",
    "parsed_unit_of_measure" "text",
    "parsed_default_cost" numeric(14,2),
    "parse_status" "text" NOT NULL,
    "error_message" "text",
    "created_product_id" "uuid",
    CONSTRAINT "product_import_rows_parse_status_check" CHECK (("parse_status" = ANY (ARRAY['ok'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."product_import_rows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotation_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "line_no" integer NOT NULL,
    "product_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_price" numeric(14,2) NOT NULL,
    "unit_cost" numeric(14,2),
    "tax_code" "text",
    "discount_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "line_total" numeric(14,2) NOT NULL,
    CONSTRAINT "quotation_lines_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "quotation_lines_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."quotation_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "capability" "text" NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "name" "text" NOT NULL,
    "is_system_template" boolean DEFAULT false NOT NULL,
    "description" "text",
    "default_approval_limit_myr" numeric(14,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sst_rates" (
    "sst_code" "text" NOT NULL,
    "tax_type" "text" NOT NULL,
    "rate" numeric(5,4) NOT NULL,
    "description" "text" NOT NULL,
    "rule_version" "text" DEFAULT '1.0.0'::"text" NOT NULL,
    CONSTRAINT "sst_rates_rate_check" CHECK ((("rate" >= (0)::numeric) AND ("rate" < (1)::numeric))),
    CONSTRAINT "sst_rates_tax_type_check" CHECK (("tax_type" = ANY (ARRAY['sales_tax'::"text", 'service_tax'::"text", 'exempt'::"text"])))
);


ALTER TABLE "public"."sst_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."statutory_rate_tables" (
    "scheme" "text" NOT NULL,
    "version" "text" NOT NULL,
    "effective_from" "date" NOT NULL,
    "rate_rules" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "statutory_rate_tables_scheme_check" CHECK (("scheme" = ANY (ARRAY['epf'::"text", 'socso'::"text", 'eis'::"text", 'pcb'::"text"])))
);


ALTER TABLE "public"."statutory_rate_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "warehouse_id" "uuid" NOT NULL,
    "movement_type" "text" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_cost" numeric(14,2),
    "source_document_type" "text",
    "source_document_id" "uuid",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['opening'::"text", 'purchase_receipt'::"text", 'delivery_out'::"text", 'adjustment_increase'::"text", 'adjustment_decrease'::"text"]))),
    CONSTRAINT "stock_movements_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "stock_movements_source_document_type_check" CHECK (("source_document_type" = ANY (ARRAY['delivery_order'::"text", 'purchase_invoice'::"text", 'stock_take'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_envelopes" (
    "envelope_id" "text" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "device_seq" bigint NOT NULL,
    "server_seq" bigint NOT NULL,
    "entity_type" "text" NOT NULL,
    "op" "text" NOT NULL,
    "payload_ciphertext" "bytea" NOT NULL,
    "payload_iv" "bytea" NOT NULL,
    "server_received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "captured_by_membership_id" "uuid",
    "capture_channel" "text",
    CONSTRAINT "sync_envelopes_capture_channel_check" CHECK (("capture_channel" = ANY (ARRAY['mobile_app'::"text", 'web_app'::"text", 'api'::"text"]))),
    CONSTRAINT "sync_envelopes_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['business_event'::"text", 'business_data'::"text", 'ledger_entry'::"text", 'document'::"text", 'ai_interpretation'::"text", 'business_event_status_transition'::"text", 'business_knowledge_entry'::"text", 'app_settings'::"text"]))),
    CONSTRAINT "sync_envelopes_op_check" CHECK (("op" = ANY (ARRAY['insert'::"text", 'status_transition'::"text", 'upsert'::"text"])))
);


ALTER TABLE "public"."sync_envelopes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sync_envelopes_server_seq_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sync_envelopes_server_seq_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sync_envelopes_server_seq_seq" OWNED BY "public"."sync_envelopes"."server_seq";



ALTER TABLE ONLY "public"."sync_envelopes" ALTER COLUMN "server_seq" SET DEFAULT "nextval"('"public"."sync_envelopes_server_seq_seq"'::"regclass");



ALTER TABLE ONLY "public"."active_device_lock"
    ADD CONSTRAINT "active_device_lock_pkey" PRIMARY KEY ("business_membership_id");



ALTER TABLE ONLY "public"."approval_delegations"
    ADD CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."approval_tasks"
    ADD CONSTRAINT "approval_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backups"
    ADD CONSTRAINT "backups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statement_lines"
    ADD CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bulk_payment_file_exports"
    ADD CONSTRAINT "bulk_payment_file_exports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_access_model_transitions"
    ADD CONSTRAINT "business_access_model_transitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_memberships"
    ADD CONSTRAINT "business_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."capture_triage"
    ADD CONSTRAINT "capture_triage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_business_id_account_code_key" UNIQUE ("business_id", "account_code");



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_calculations"
    ADD CONSTRAINT "commission_calculations_invoice_id_key" UNIQUE ("invoice_id");



ALTER TABLE ONLY "public"."commission_calculations"
    ADD CONSTRAINT "commission_calculations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_rules"
    ADD CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_alerts"
    ADD CONSTRAINT "contract_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_limit_override_log"
    ADD CONSTRAINT "credit_limit_override_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_business_id_credit_note_no_key" UNIQUE ("business_id", "credit_note_no");



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_order_lines"
    ADD CONSTRAINT "delivery_order_lines_delivery_order_id_line_no_key" UNIQUE ("delivery_order_id", "line_no");



ALTER TABLE ONLY "public"."delivery_order_lines"
    ADD CONSTRAINT "delivery_order_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_business_id_do_no_key" UNIQUE ("business_id", "do_no");



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("device_id");



ALTER TABLE ONLY "public"."document_number_sequences"
    ADD CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("business_id", "document_type");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."e_invoice_submission_lines"
    ADD CONSTRAINT "e_invoice_submission_lines_pkey" PRIMARY KEY ("submission_id", "invoice_id");



ALTER TABLE ONLY "public"."e_invoice_submissions"
    ADD CONSTRAINT "e_invoice_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."e_signature_envelopes"
    ADD CONSTRAINT "e_signature_envelopes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_party_id_key" UNIQUE ("party_id");



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_invoice_id_line_no_key" UNIQUE ("invoice_id", "line_no");



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_business_id_invoice_no_key" UNIQUE ("business_id", "invoice_no");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_applications"
    ADD CONSTRAINT "leave_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("employee_party_id", "leave_type_id", "year");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_business_id_name_key" UNIQUE ("business_id", "name");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overtime_records"
    ADD CONSTRAINT "overtime_records_employee_party_id_date_key" UNIQUE ("employee_party_id", "date");



ALTER TABLE ONLY "public"."overtime_records"
    ADD CONSTRAINT "overtime_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_business_id_party_no_key" UNIQUE ("business_id", "party_no");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_vouchers"
    ADD CONSTRAINT "payment_vouchers_business_id_pv_no_key" UNIQUE ("business_id", "pv_no");



ALTER TABLE ONLY "public"."payment_vouchers"
    ADD CONSTRAINT "payment_vouchers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_business_id_period_key" UNIQUE ("business_id", "period");



ALTER TABLE ONLY "public"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_payroll_run_id_employee_party_id_key" UNIQUE ("payroll_run_id", "employee_party_id");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("domain", "capability");



ALTER TABLE ONLY "public"."price_list_entries"
    ADD CONSTRAINT "price_list_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_types"
    ADD CONSTRAINT "price_types_business_id_name_key" UNIQUE ("business_id", "name");



ALTER TABLE ONLY "public"."price_types"
    ADD CONSTRAINT "price_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_import_batches"
    ADD CONSTRAINT "product_import_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_import_rows"
    ADD CONSTRAINT "product_import_rows_batch_id_row_no_key" UNIQUE ("batch_id", "row_no");



ALTER TABLE ONLY "public"."product_import_rows"
    ADD CONSTRAINT "product_import_rows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_business_id_sku_key" UNIQUE ("business_id", "sku");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_lines"
    ADD CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_lines"
    ADD CONSTRAINT "quotation_lines_quotation_id_line_no_key" UNIQUE ("quotation_id", "line_no");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_business_id_quotation_no_key" UNIQUE ("business_id", "quotation_no");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "domain", "capability");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salary_advances"
    ADD CONSTRAINT "salary_advances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."segregation_of_duties_policies"
    ADD CONSTRAINT "segregation_of_duties_policies_pkey" PRIMARY KEY ("business_id", "domain");



ALTER TABLE ONLY "public"."sst_rates"
    ADD CONSTRAINT "sst_rates_pkey" PRIMARY KEY ("sst_code");



ALTER TABLE ONLY "public"."sst_returns"
    ADD CONSTRAINT "sst_returns_business_id_period_key" UNIQUE ("business_id", "period");



ALTER TABLE ONLY "public"."sst_returns"
    ADD CONSTRAINT "sst_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sst_transactions"
    ADD CONSTRAINT "sst_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."statutory_rate_tables"
    ADD CONSTRAINT "statutory_rate_tables_pkey" PRIMARY KEY ("scheme", "version");



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("product_id", "warehouse_id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_take_lines"
    ADD CONSTRAINT "stock_take_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_take_lines"
    ADD CONSTRAINT "stock_take_lines_stock_take_id_product_id_key" UNIQUE ("stock_take_id", "product_id");



ALTER TABLE ONLY "public"."stock_takes"
    ADD CONSTRAINT "stock_takes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_envelopes"
    ADD CONSTRAINT "sync_envelopes_pkey" PRIMARY KEY ("envelope_id");



ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "business_memberships_one_active_owner" ON "public"."business_memberships" USING "btree" ("business_id") WHERE (("status" = 'active'::"text") AND ("role_id" = '00000000-0000-0000-0000-000000000001'::"uuid"));



CREATE UNIQUE INDEX "business_memberships_one_live_globally" ON "public"."business_memberships" USING "btree" ("user_id") WHERE ("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'suspended'::"text"]));



CREATE UNIQUE INDEX "business_memberships_one_pending_invite_per_email" ON "public"."business_memberships" USING "btree" ("lower"("invited_email")) WHERE (("status" = 'invited'::"text") AND ("user_id" IS NULL));



CREATE UNIQUE INDEX "devices_one_primary_per_membership" ON "public"."devices" USING "btree" ("business_membership_id") WHERE ("is_primary" = true);



CREATE INDEX "idx_access_model_transitions_business" ON "public"."business_access_model_transitions" USING "btree" ("business_id", "occurred_at");



CREATE INDEX "idx_approval_delegations_business" ON "public"."approval_delegations" USING "btree" ("business_id");



CREATE INDEX "idx_approval_delegations_delegator_active" ON "public"."approval_delegations" USING "btree" ("delegator_membership_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_approval_tasks_assigned" ON "public"."approval_tasks" USING "btree" ("assigned_membership_id") WHERE ("status" = 'pending_approval'::"text");



CREATE INDEX "idx_approval_tasks_business_status" ON "public"."approval_tasks" USING "btree" ("business_id", "status");



CREATE INDEX "idx_attendance_records_employee" ON "public"."attendance_records" USING "btree" ("employee_party_id", "recorded_at");



CREATE INDEX "idx_bank_statement_lines_account" ON "public"."bank_statement_lines" USING "btree" ("bank_account_id");



CREATE INDEX "idx_bulk_payment_file_exports_run" ON "public"."bulk_payment_file_exports" USING "btree" ("payroll_run_id");



CREATE INDEX "idx_business_memberships_business_active" ON "public"."business_memberships" USING "btree" ("business_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_business_memberships_user_active" ON "public"."business_memberships" USING "btree" ("user_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_capture_triage_business" ON "public"."capture_triage" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "idx_chart_of_accounts_business" ON "public"."chart_of_accounts" USING "btree" ("business_id");



CREATE INDEX "idx_claims_business" ON "public"."claims" USING "btree" ("business_id");



CREATE INDEX "idx_commission_calculations_business" ON "public"."commission_calculations" USING "btree" ("business_id");



CREATE INDEX "idx_commission_rules_business" ON "public"."commission_rules" USING "btree" ("business_id");



CREATE INDEX "idx_contract_alerts_contract" ON "public"."contract_alerts" USING "btree" ("contract_id");



CREATE INDEX "idx_contracts_business" ON "public"."contracts" USING "btree" ("business_id");



CREATE INDEX "idx_contracts_counterparty" ON "public"."contracts" USING "btree" ("counterparty_id");



CREATE INDEX "idx_credit_limit_override_log_business" ON "public"."credit_limit_override_log" USING "btree" ("business_id");



CREATE INDEX "idx_credit_notes_business" ON "public"."credit_notes" USING "btree" ("business_id");



CREATE INDEX "idx_credit_notes_invoice" ON "public"."credit_notes" USING "btree" ("source_invoice_id");



CREATE INDEX "idx_delivery_order_lines_do" ON "public"."delivery_order_lines" USING "btree" ("delivery_order_id");



CREATE INDEX "idx_delivery_orders_business" ON "public"."delivery_orders" USING "btree" ("business_id");



CREATE INDEX "idx_devices_business_id" ON "public"."devices" USING "btree" ("business_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "idx_devices_business_membership" ON "public"."devices" USING "btree" ("business_membership_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "idx_documents_business" ON "public"."documents" USING "btree" ("business_id");



CREATE INDEX "idx_e_invoice_submissions_business" ON "public"."e_invoice_submissions" USING "btree" ("business_id");



CREATE INDEX "idx_employee_profiles_business" ON "public"."employee_profiles" USING "btree" ("business_id");



CREATE INDEX "idx_esign_envelopes_business" ON "public"."e_signature_envelopes" USING "btree" ("business_id");



CREATE INDEX "idx_invoice_lines_invoice" ON "public"."invoice_lines" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoices_business" ON "public"."invoices" USING "btree" ("business_id");



CREATE INDEX "idx_leave_applications_business" ON "public"."leave_applications" USING "btree" ("business_id");



CREATE INDEX "idx_ledger_entries_business_account" ON "public"."ledger_entries" USING "btree" ("business_id", "chart_of_accounts_id");



CREATE INDEX "idx_ledger_entries_business_data" ON "public"."ledger_entries" USING "btree" ("business_data_id") WHERE ("business_data_id" IS NOT NULL);



CREATE INDEX "idx_overtime_records_business" ON "public"."overtime_records" USING "btree" ("business_id");



CREATE INDEX "idx_parties_business" ON "public"."parties" USING "btree" ("business_id");



CREATE INDEX "idx_payment_vouchers_business" ON "public"."payment_vouchers" USING "btree" ("business_id");



CREATE INDEX "idx_payments_business" ON "public"."payments" USING "btree" ("business_id");



CREATE INDEX "idx_payments_invoice" ON "public"."payments" USING "btree" ("invoice_id");



CREATE INDEX "idx_payroll_runs_business" ON "public"."payroll_runs" USING "btree" ("business_id");



CREATE INDEX "idx_payslips_payroll_run" ON "public"."payslips" USING "btree" ("payroll_run_id");



CREATE INDEX "idx_price_list_entries_product_type" ON "public"."price_list_entries" USING "btree" ("product_id", "price_type_id", "effective_from");



CREATE INDEX "idx_product_import_rows_batch" ON "public"."product_import_rows" USING "btree" ("batch_id");



CREATE INDEX "idx_products_business" ON "public"."products" USING "btree" ("business_id");



CREATE INDEX "idx_quotation_lines_quotation" ON "public"."quotation_lines" USING "btree" ("quotation_id");



CREATE INDEX "idx_quotations_business" ON "public"."quotations" USING "btree" ("business_id");



CREATE INDEX "idx_salary_advances_business" ON "public"."salary_advances" USING "btree" ("business_id");



CREATE INDEX "idx_sst_transactions_business" ON "public"."sst_transactions" USING "btree" ("business_id");



CREATE INDEX "idx_sst_transactions_invoice" ON "public"."sst_transactions" USING "btree" ("invoice_id") WHERE ("invoice_id" IS NOT NULL);



CREATE INDEX "idx_stock_levels_business" ON "public"."stock_levels" USING "btree" ("business_id");



CREATE INDEX "idx_stock_movements_business" ON "public"."stock_movements" USING "btree" ("business_id");



CREATE INDEX "idx_stock_movements_product_warehouse" ON "public"."stock_movements" USING "btree" ("product_id", "warehouse_id");



CREATE INDEX "idx_stock_take_lines_stock_take" ON "public"."stock_take_lines" USING "btree" ("stock_take_id");



CREATE INDEX "idx_stock_takes_business" ON "public"."stock_takes" USING "btree" ("business_id");



CREATE INDEX "idx_sync_envelopes_business_device_seq" ON "public"."sync_envelopes" USING "btree" ("business_id", "device_id", "device_seq");



CREATE INDEX "idx_sync_envelopes_business_server_seq" ON "public"."sync_envelopes" USING "btree" ("business_id", "server_seq");



CREATE INDEX "idx_sync_envelopes_captured_by" ON "public"."sync_envelopes" USING "btree" ("captured_by_membership_id") WHERE ("captured_by_membership_id" IS NOT NULL);



CREATE INDEX "idx_warehouses_business" ON "public"."warehouses" USING "btree" ("business_id");



CREATE UNIQUE INDEX "price_types_one_default_per_business" ON "public"."price_types" USING "btree" ("business_id") WHERE "is_default";



CREATE UNIQUE INDEX "roles_unique_business_role_name" ON "public"."roles" USING "btree" ("business_id", "name") WHERE ("business_id" IS NOT NULL);



CREATE UNIQUE INDEX "roles_unique_template_name" ON "public"."roles" USING "btree" ("name") WHERE ("business_id" IS NULL);



CREATE OR REPLACE TRIGGER "trg_enforce_own_capture_attribution" BEFORE INSERT ON "public"."sync_envelopes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_own_capture_attribution"();



CREATE OR REPLACE TRIGGER "trg_enforce_sole_owner_membership" BEFORE UPDATE ON "public"."business_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_sole_owner_membership"();



CREATE OR REPLACE TRIGGER "trg_enforce_system_account_immutability" BEFORE DELETE OR UPDATE ON "public"."chart_of_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_system_account_immutability"();



CREATE OR REPLACE TRIGGER "trg_seed_chart_of_accounts_on_business_insert" AFTER INSERT ON "public"."businesses" FOR EACH ROW EXECUTE FUNCTION "public"."seed_chart_of_accounts_on_business_insert"();



CREATE OR REPLACE TRIGGER "trg_seed_sod_policies_on_first_team_transition" AFTER INSERT ON "public"."business_access_model_transitions" FOR EACH ROW EXECUTE FUNCTION "public"."seed_sod_policies_on_first_team_transition"();



CREATE OR REPLACE TRIGGER "trg_sync_claim_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_claim_on_task_decision"();



CREATE OR REPLACE TRIGGER "trg_sync_commission_calculation_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_commission_calculation_on_task_decision"();



CREATE OR REPLACE TRIGGER "trg_sync_contract_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_contract_on_task_decision"();



CREATE OR REPLACE TRIGGER "trg_sync_credit_note_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_credit_note_on_task_decision"();



CREATE OR REPLACE TRIGGER "trg_sync_delivery_order_on_task_rejection" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_delivery_order_on_task_rejection"();



CREATE OR REPLACE TRIGGER "trg_sync_leave_application_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_leave_application_on_task_decision"();



CREATE OR REPLACE TRIGGER "trg_sync_overtime_record_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_overtime_record_on_task_decision"();



CREATE OR REPLACE TRIGGER "trg_sync_payment_voucher_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_payment_voucher_on_task_decision"();



CREATE OR REPLACE TRIGGER "trg_sync_payroll_run_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_payroll_run_on_task_decision"();



CREATE OR REPLACE TRIGGER "trg_sync_quotation_status_on_task_rejection" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_quotation_status_on_task_rejection"();



CREATE OR REPLACE TRIGGER "trg_sync_salary_advance_on_task_decision" AFTER UPDATE ON "public"."approval_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_salary_advance_on_task_decision"();



ALTER TABLE ONLY "public"."active_device_lock"
    ADD CONSTRAINT "active_device_lock_active_device_id_fkey" FOREIGN KEY ("active_device_id") REFERENCES "public"."devices"("device_id");



ALTER TABLE ONLY "public"."active_device_lock"
    ADD CONSTRAINT "active_device_lock_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."active_device_lock"
    ADD CONSTRAINT "active_device_lock_business_membership_id_fkey" FOREIGN KEY ("business_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."approval_delegations"
    ADD CONSTRAINT "approval_delegations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."approval_delegations"
    ADD CONSTRAINT "approval_delegations_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."approval_delegations"
    ADD CONSTRAINT "approval_delegations_delegate_membership_id_fkey" FOREIGN KEY ("delegate_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."approval_delegations"
    ADD CONSTRAINT "approval_delegations_delegator_membership_id_fkey" FOREIGN KEY ("delegator_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."approval_tasks"
    ADD CONSTRAINT "approval_tasks_assigned_membership_id_fkey" FOREIGN KEY ("assigned_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."approval_tasks"
    ADD CONSTRAINT "approval_tasks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."approval_tasks"
    ADD CONSTRAINT "approval_tasks_captured_by_membership_id_fkey" FOREIGN KEY ("captured_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."approval_tasks"
    ADD CONSTRAINT "approval_tasks_decided_by_membership_id_fkey" FOREIGN KEY ("decided_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."approval_tasks"
    ADD CONSTRAINT "approval_tasks_delegated_from_membership_id_fkey" FOREIGN KEY ("delegated_from_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_employee_party_id_fkey" FOREIGN KEY ("employee_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."backups"
    ADD CONSTRAINT "backups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."chart_of_accounts"("id");



ALTER TABLE ONLY "public"."bank_statement_lines"
    ADD CONSTRAINT "bank_statement_lines_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_statement_lines"
    ADD CONSTRAINT "bank_statement_lines_matched_ledger_entry_id_fkey" FOREIGN KEY ("matched_ledger_entry_id") REFERENCES "public"."ledger_entries"("id");



ALTER TABLE ONLY "public"."bulk_payment_file_exports"
    ADD CONSTRAINT "bulk_payment_file_exports_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."bulk_payment_file_exports"
    ADD CONSTRAINT "bulk_payment_file_exports_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id");



ALTER TABLE ONLY "public"."business_access_model_transitions"
    ADD CONSTRAINT "business_access_model_transitions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_memberships"
    ADD CONSTRAINT "business_memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_memberships"
    ADD CONSTRAINT "business_memberships_invited_by_membership_id_fkey" FOREIGN KEY ("invited_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."business_memberships"
    ADD CONSTRAINT "business_memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."business_memberships"
    ADD CONSTRAINT "business_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."capture_triage"
    ADD CONSTRAINT "capture_triage_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."capture_triage"
    ADD CONSTRAINT "capture_triage_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chart_of_accounts"
    ADD CONSTRAINT "chart_of_accounts_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "public"."chart_of_accounts"("id");



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_document_id_receipt_fkey" FOREIGN KEY ("document_id_receipt") REFERENCES "public"."documents"("id");



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_employee_party_id_fkey" FOREIGN KEY ("employee_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."commission_calculations"
    ADD CONSTRAINT "commission_calculations_agent_party_id_fkey" FOREIGN KEY ("agent_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."commission_calculations"
    ADD CONSTRAINT "commission_calculations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_calculations"
    ADD CONSTRAINT "commission_calculations_commission_rule_id_fkey" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id");



ALTER TABLE ONLY "public"."commission_calculations"
    ADD CONSTRAINT "commission_calculations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."commission_rules"
    ADD CONSTRAINT "commission_rules_applies_to_party_id_fkey" FOREIGN KEY ("applies_to_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."commission_rules"
    ADD CONSTRAINT "commission_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_alerts"
    ADD CONSTRAINT "contract_alerts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id");



ALTER TABLE ONLY "public"."credit_limit_override_log"
    ADD CONSTRAINT "credit_limit_override_log_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_limit_override_log"
    ADD CONSTRAINT "credit_limit_override_log_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."credit_limit_override_log"
    ADD CONSTRAINT "credit_limit_override_log_overridden_by_membership_id_fkey" FOREIGN KEY ("overridden_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."credit_limit_override_log"
    ADD CONSTRAINT "credit_limit_override_log_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_captured_by_membership_id_fkey" FOREIGN KEY ("captured_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_source_invoice_id_fkey" FOREIGN KEY ("source_invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."delivery_order_lines"
    ADD CONSTRAINT "delivery_order_lines_delivery_order_id_fkey" FOREIGN KEY ("delivery_order_id") REFERENCES "public"."delivery_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_order_lines"
    ADD CONSTRAINT "delivery_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_captured_by_membership_id_fkey" FOREIGN KEY ("captured_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."delivery_orders"
    ADD CONSTRAINT "delivery_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_business_membership_id_fkey" FOREIGN KEY ("business_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."document_number_sequences"
    ADD CONSTRAINT "document_number_sequences_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_uploaded_by_membership_id_fkey" FOREIGN KEY ("uploaded_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."e_invoice_submission_lines"
    ADD CONSTRAINT "e_invoice_submission_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."e_invoice_submission_lines"
    ADD CONSTRAINT "e_invoice_submission_lines_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."e_invoice_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."e_invoice_submissions"
    ADD CONSTRAINT "e_invoice_submissions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."e_invoice_submissions"
    ADD CONSTRAINT "e_invoice_submissions_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."e_invoice_submissions"
    ADD CONSTRAINT "e_invoice_submissions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."e_signature_envelopes"
    ADD CONSTRAINT "e_signature_envelopes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."e_signature_envelopes"
    ADD CONSTRAINT "e_signature_envelopes_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id");



ALTER TABLE ONLY "public"."e_signature_envelopes"
    ADD CONSTRAINT "e_signature_envelopes_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."e_signature_envelopes"
    ADD CONSTRAINT "e_signature_envelopes_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id");



ALTER TABLE ONLY "public"."e_signature_envelopes"
    ADD CONSTRAINT "e_signature_envelopes_signed_document_id_fkey" FOREIGN KEY ("signed_document_id") REFERENCES "public"."documents"("id");



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."employee_profiles"
    ADD CONSTRAINT "employee_profiles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_agent_party_id_fkey" FOREIGN KEY ("agent_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_captured_by_membership_id_fkey" FOREIGN KEY ("captured_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_delivery_order_id_fkey" FOREIGN KEY ("delivery_order_id") REFERENCES "public"."delivery_orders"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_source_quotation_id_fkey" FOREIGN KEY ("source_quotation_id") REFERENCES "public"."quotations"("id");



ALTER TABLE ONLY "public"."leave_applications"
    ADD CONSTRAINT "leave_applications_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."leave_applications"
    ADD CONSTRAINT "leave_applications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_applications"
    ADD CONSTRAINT "leave_applications_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."leave_applications"
    ADD CONSTRAINT "leave_applications_employee_party_id_fkey" FOREIGN KEY ("employee_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."leave_applications"
    ADD CONSTRAINT "leave_applications_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_employee_party_id_fkey" FOREIGN KEY ("employee_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_chart_of_accounts_id_fkey" FOREIGN KEY ("chart_of_accounts_id") REFERENCES "public"."chart_of_accounts"("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_posted_by_membership_id_fkey" FOREIGN KEY ("posted_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_reversal_of_fkey" FOREIGN KEY ("reversal_of") REFERENCES "public"."ledger_entries"("id");



ALTER TABLE ONLY "public"."overtime_records"
    ADD CONSTRAINT "overtime_records_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overtime_records"
    ADD CONSTRAINT "overtime_records_employee_party_id_fkey" FOREIGN KEY ("employee_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_price_type_id_fkey" FOREIGN KEY ("price_type_id") REFERENCES "public"."price_types"("id");



ALTER TABLE ONLY "public"."payment_vouchers"
    ADD CONSTRAINT "payment_vouchers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_vouchers"
    ADD CONSTRAINT "payment_vouchers_captured_by_membership_id_fkey" FOREIGN KEY ("captured_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."payment_vouchers"
    ADD CONSTRAINT "payment_vouchers_document_id_receipt_fkey" FOREIGN KEY ("document_id_receipt") REFERENCES "public"."documents"("id");



ALTER TABLE ONLY "public"."payment_vouchers"
    ADD CONSTRAINT "payment_vouchers_payee_party_id_fkey" FOREIGN KEY ("payee_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_recorded_by_membership_id_fkey" FOREIGN KEY ("recorded_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_employee_party_id_fkey" FOREIGN KEY ("employee_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_list_entries"
    ADD CONSTRAINT "price_list_entries_price_type_id_fkey" FOREIGN KEY ("price_type_id") REFERENCES "public"."price_types"("id");



ALTER TABLE ONLY "public"."price_list_entries"
    ADD CONSTRAINT "price_list_entries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_types"
    ADD CONSTRAINT "price_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_import_batches"
    ADD CONSTRAINT "product_import_batches_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_import_batches"
    ADD CONSTRAINT "product_import_batches_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."product_import_rows"
    ADD CONSTRAINT "product_import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."product_import_batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_import_rows"
    ADD CONSTRAINT "product_import_rows_created_product_id_fkey" FOREIGN KEY ("created_product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotation_lines"
    ADD CONSTRAINT "quotation_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."quotation_lines"
    ADD CONSTRAINT "quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_captured_by_membership_id_fkey" FOREIGN KEY ("captured_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_converted_invoice_id_fkey" FOREIGN KEY ("converted_invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_domain_capability_fkey" FOREIGN KEY ("domain", "capability") REFERENCES "public"."permissions"("domain", "capability");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salary_advances"
    ADD CONSTRAINT "salary_advances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salary_advances"
    ADD CONSTRAINT "salary_advances_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."salary_advances"
    ADD CONSTRAINT "salary_advances_employee_party_id_fkey" FOREIGN KEY ("employee_party_id") REFERENCES "public"."parties"("id");



ALTER TABLE ONLY "public"."segregation_of_duties_policies"
    ADD CONSTRAINT "segregation_of_duties_policies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sst_returns"
    ADD CONSTRAINT "sst_returns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sst_returns"
    ADD CONSTRAINT "sst_returns_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."sst_transactions"
    ADD CONSTRAINT "sst_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sst_transactions"
    ADD CONSTRAINT "sst_transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."sst_transactions"
    ADD CONSTRAINT "sst_transactions_payment_voucher_id_fkey" FOREIGN KEY ("payment_voucher_id") REFERENCES "public"."payment_vouchers"("id");



ALTER TABLE ONLY "public"."sst_transactions"
    ADD CONSTRAINT "sst_transactions_sst_code_fkey" FOREIGN KEY ("sst_code") REFERENCES "public"."sst_rates"("sst_code");



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id");



ALTER TABLE ONLY "public"."stock_take_lines"
    ADD CONSTRAINT "stock_take_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."stock_take_lines"
    ADD CONSTRAINT "stock_take_lines_stock_take_id_fkey" FOREIGN KEY ("stock_take_id") REFERENCES "public"."stock_takes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_takes"
    ADD CONSTRAINT "stock_takes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_takes"
    ADD CONSTRAINT "stock_takes_captured_by_membership_id_fkey" FOREIGN KEY ("captured_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."stock_takes"
    ADD CONSTRAINT "stock_takes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id");



ALTER TABLE ONLY "public"."sync_envelopes"
    ADD CONSTRAINT "sync_envelopes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_envelopes"
    ADD CONSTRAINT "sync_envelopes_captured_by_membership_id_fkey" FOREIGN KEY ("captured_by_membership_id") REFERENCES "public"."business_memberships"("id");



ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



CREATE POLICY "Active members can insert their business's envelopes" ON "public"."sync_envelopes" FOR INSERT WITH CHECK ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's SoD policies" ON "public"."segregation_of_duties_policies" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's access model history" ON "public"."business_access_model_transitions" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's active device locks" ON "public"."active_device_lock" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's approval tasks" ON "public"."approval_tasks" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's bank accounts" ON "public"."bank_accounts" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's bank statement lines" ON "public"."bank_statement_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_statement_lines"."bank_account_id") AND "public"."is_active_member"("ba"."business_id")))));



CREATE POLICY "Active members can view their business's capture triage" ON "public"."capture_triage" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."business_memberships" "bm"
  WHERE (("bm"."business_id" = "capture_triage"."business_id") AND ("bm"."user_id" = "auth"."uid"()) AND ("bm"."status" = 'active'::"text")))));



CREATE POLICY "Active members can view their business's chart of accounts" ON "public"."chart_of_accounts" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's delegations" ON "public"."approval_delegations" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's devices" ON "public"."devices" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's document sequences" ON "public"."document_number_sequences" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members can view their business's envelopes" ON "public"."sync_envelopes" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Active members with commission view can see commission calcs" ON "public"."commission_calculations" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'commission'::"text", 'view'::"text"));



CREATE POLICY "Active members with commission view can see commission rules" ON "public"."commission_rules" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'commission'::"text", 'view'::"text"));



CREATE POLICY "Active members with expense view can see documents" ON "public"."documents" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'expense'::"text", 'view'::"text"));



CREATE POLICY "Active members with expense view can see payment vouchers" ON "public"."payment_vouchers" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'expense'::"text", 'view'::"text"));



CREATE POLICY "Active members with hr_attendance_leave view can see attendance" ON "public"."attendance_records" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'hr_attendance_leave'::"text", 'view'::"text"));



CREATE POLICY "Active members with hr_attendance_leave view can see leave apps" ON "public"."leave_applications" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'hr_attendance_leave'::"text", 'view'::"text"));



CREATE POLICY "Active members with hr_attendance_leave view can see leave bal" ON "public"."leave_balances" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leave_types" "lt"
  WHERE (("lt"."id" = "leave_balances"."leave_type_id") AND "public"."caller_has_capability"("lt"."business_id", 'hr_attendance_leave'::"text", 'view'::"text")))));



CREATE POLICY "Active members with hr_attendance_leave view can see leave typ" ON "public"."leave_types" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'hr_attendance_leave'::"text", 'view'::"text"));



CREATE POLICY "Active members with hr_attendance_leave view can see overtime" ON "public"."overtime_records" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'hr_attendance_leave'::"text", 'view'::"text"));



CREATE POLICY "Active members with inventory view can see delivery order lines" ON "public"."delivery_order_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."delivery_orders" "d"
  WHERE (("d"."id" = "delivery_order_lines"."delivery_order_id") AND "public"."caller_has_capability"("d"."business_id", 'inventory'::"text", 'view'::"text")))));



CREATE POLICY "Active members with inventory view can see delivery orders" ON "public"."delivery_orders" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'inventory'::"text", 'view'::"text"));



CREATE POLICY "Active members with inventory view can see stock levels" ON "public"."stock_levels" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'inventory'::"text", 'view'::"text"));



CREATE POLICY "Active members with inventory view can see stock movements" ON "public"."stock_movements" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'inventory'::"text", 'view'::"text"));



CREATE POLICY "Active members with inventory view can see stock take lines" ON "public"."stock_take_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."stock_takes" "st"
  WHERE (("st"."id" = "stock_take_lines"."stock_take_id") AND "public"."caller_has_capability"("st"."business_id", 'inventory'::"text", 'view'::"text")))));



CREATE POLICY "Active members with inventory view can see stock takes" ON "public"."stock_takes" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'inventory'::"text", 'view'::"text"));



CREATE POLICY "Active members with inventory view can see warehouses" ON "public"."warehouses" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'inventory'::"text", 'view'::"text"));



CREATE POLICY "Active members with legal/sales view can see e-sig envelopes" ON "public"."e_signature_envelopes" FOR SELECT USING (("public"."caller_has_capability"("business_id", 'legal_contract'::"text", 'view'::"text") OR "public"."caller_has_capability"("business_id", 'sales'::"text", 'view'::"text")));



CREATE POLICY "Active members with legal_contract view can see contract alerts" ON "public"."contract_alerts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."contracts" "c"
  WHERE (("c"."id" = "contract_alerts"."contract_id") AND "public"."caller_has_capability"("c"."business_id", 'legal_contract'::"text", 'view'::"text")))));



CREATE POLICY "Active members with legal_contract view can see contracts" ON "public"."contracts" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'legal_contract'::"text", 'view'::"text"));



CREATE POLICY "Active members with payroll view can see bulk payment file exp" ON "public"."bulk_payment_file_exports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."payroll_runs" "pr"
  WHERE (("pr"."id" = "bulk_payment_file_exports"."payroll_run_id") AND "public"."caller_has_capability"("pr"."business_id", 'payroll'::"text", 'view'::"text")))));



CREATE POLICY "Active members with payroll view can see claims" ON "public"."claims" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'payroll'::"text", 'view'::"text"));



CREATE POLICY "Active members with payroll view can see employee profiles" ON "public"."employee_profiles" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'payroll'::"text", 'view'::"text"));



CREATE POLICY "Active members with payroll view can see payroll runs" ON "public"."payroll_runs" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'payroll'::"text", 'view'::"text"));



CREATE POLICY "Active members with payroll view can see payslips" ON "public"."payslips" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."payroll_runs" "pr"
  WHERE (("pr"."id" = "payslips"."payroll_run_id") AND "public"."caller_has_capability"("pr"."business_id", 'payroll'::"text", 'view'::"text")))));



CREATE POLICY "Active members with payroll view can see salary advances" ON "public"."salary_advances" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'payroll'::"text", 'view'::"text"));



CREATE POLICY "Active members with pricing view can see import batches" ON "public"."product_import_batches" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'pricing'::"text", 'view'::"text"));



CREATE POLICY "Active members with pricing view can see import rows" ON "public"."product_import_rows" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."product_import_batches" "b"
  WHERE (("b"."id" = "product_import_rows"."batch_id") AND "public"."caller_has_capability"("b"."business_id", 'pricing'::"text", 'view'::"text")))));



CREATE POLICY "Active members with pricing view can see price list entries" ON "public"."price_list_entries" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."products" "p"
  WHERE (("p"."id" = "price_list_entries"."product_id") AND "public"."caller_has_capability"("p"."business_id", 'pricing'::"text", 'view'::"text")))));



CREATE POLICY "Active members with pricing view can see price types" ON "public"."price_types" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'pricing'::"text", 'view'::"text"));



CREATE POLICY "Active members with pricing view can see products" ON "public"."products" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'pricing'::"text", 'view'::"text"));



CREATE POLICY "Active members with sales view can see credit notes" ON "public"."credit_notes" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'sales'::"text", 'view'::"text"));



CREATE POLICY "Active members with sales view can see invoice lines" ON "public"."invoice_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE (("i"."id" = "invoice_lines"."invoice_id") AND "public"."caller_has_capability"("i"."business_id", 'sales'::"text", 'view'::"text")))));



CREATE POLICY "Active members with sales view can see invoices" ON "public"."invoices" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'sales'::"text", 'view'::"text"));



CREATE POLICY "Active members with sales view can see payments" ON "public"."payments" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'sales'::"text", 'view'::"text"));



CREATE POLICY "Active members with sales view can see quotation lines" ON "public"."quotation_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."quotations" "q"
  WHERE (("q"."id" = "quotation_lines"."quotation_id") AND "public"."caller_has_capability"("q"."business_id", 'sales'::"text", 'view'::"text")))));



CREATE POLICY "Active members with sales view can see quotations" ON "public"."quotations" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'sales'::"text", 'view'::"text"));



CREATE POLICY "Active members with settings/accounting see the override log" ON "public"."credit_limit_override_log" FOR SELECT USING (("public"."caller_has_capability"("business_id", 'settings'::"text", 'configure'::"text") OR "public"."caller_has_capability"("business_id", 'accounting_reports'::"text", 'view'::"text")));



CREATE POLICY "Active members with tax_compliance view can see SST returns" ON "public"."sst_returns" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'tax_compliance'::"text", 'view'::"text"));



CREATE POLICY "Active members with tax_compliance view can see SST txns" ON "public"."sst_transactions" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'tax_compliance'::"text", 'view'::"text"));



CREATE POLICY "Active members with tax_compliance view can see e-invoice subs" ON "public"."e_invoice_submissions" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'tax_compliance'::"text", 'view'::"text"));



CREATE POLICY "Active members with tax_compliance view can see sub lines" ON "public"."e_invoice_submission_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."e_invoice_submissions" "s"
  WHERE (("s"."id" = "e_invoice_submission_lines"."submission_id") AND "public"."caller_has_capability"("s"."business_id", 'tax_compliance'::"text", 'view'::"text")))));



CREATE POLICY "Any authenticated user can view system role templates" ON "public"."roles" FOR SELECT USING (("business_id" IS NULL));



CREATE POLICY "Any authenticated user can view template role_permissions" ON "public"."role_permissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "role_permissions"."role_id") AND ("r"."business_id" IS NULL)))));



CREATE POLICY "Any authenticated user can view the fixed SST rate catalog" ON "public"."sst_rates" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Any authenticated user can view the fixed permission catalog" ON "public"."permissions" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Any authenticated user can view the statutory rate catalog" ON "public"."statutory_rate_tables" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Members can view their own business" ON "public"."businesses" FOR SELECT USING ("public"."is_active_member"("id"));



CREATE POLICY "Members can view their own business's custom role_permissions" ON "public"."role_permissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "role_permissions"."role_id") AND ("r"."business_id" IS NOT NULL) AND "public"."is_active_member"("r"."business_id")))));



CREATE POLICY "Members can view their own business's custom roles" ON "public"."roles" FOR SELECT USING ((("business_id" IS NOT NULL) AND "public"."is_active_member"("business_id")));



CREATE POLICY "Members can view their own business's memberships" ON "public"."business_memberships" FOR SELECT USING ("public"."is_active_member"("business_id"));



CREATE POLICY "Members see parties per their sales/hr view grant" ON "public"."parties" FOR SELECT USING (("public"."is_active_member"("business_id") AND ("public"."caller_has_capability"("business_id", 'settings'::"text", 'configure'::"text") OR (('employee'::"text" = ANY ("party_types")) AND "public"."caller_has_capability"("business_id", 'hr_attendance_leave'::"text", 'view'::"text")) OR (("party_types" && ARRAY['customer'::"text", 'supplier'::"text", 'agent'::"text", 'dropship_partner'::"text"]) AND "public"."caller_has_capability"("business_id", 'sales'::"text", 'view'::"text")))));



CREATE POLICY "Members with accounting_reports view can see the ledger" ON "public"."ledger_entries" FOR SELECT USING ("public"."caller_has_capability"("business_id", 'accounting_reports'::"text", 'view'::"text"));



CREATE POLICY "Users can insert their own backups" ON "public"."backups" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own backups" ON "public"."backups" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."active_device_lock" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."approval_delegations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."approval_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_statement_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bulk_payment_file_exports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_access_model_transitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."capture_triage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chart_of_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_calculations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contract_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contracts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_limit_override_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_order_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_number_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."e_invoice_submission_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."e_invoice_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."e_signature_envelopes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_balances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."overtime_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_vouchers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payslips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."price_list_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."price_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_import_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_import_rows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotation_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salary_advances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."segregation_of_duties_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sst_rates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sst_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sst_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."statutory_rate_tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_take_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_takes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_envelopes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."warehouses" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




























































































































































GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoices" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoices" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoices" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."business_memberships" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."business_memberships" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."business_memberships" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_membership_invitation"("p_business_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_alerts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_alerts" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contract_alerts" TO "service_role";



GRANT ALL ON FUNCTION "public"."acknowledge_contract_alert"("p_alert_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_import_batches" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_import_batches" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_import_batches" TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_product_import_batch"("p_batch_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."ar_ageing_detail"("p_business_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."assign_invoice_agent"("p_invoice_id" "uuid", "p_agent_party_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_vouchers" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_vouchers" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_vouchers" TO "service_role";



GRANT ALL ON FUNCTION "public"."attach_payment_voucher_receipt"("p_payment_voucher_id" "uuid", "p_document_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."balance_sheet_summary"("p_business_id" "uuid", "p_as_of_date" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."build_whatsapp_quotation_link"("p_quotation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."caller_has_capability"("p_business_id" "uuid", "p_domain" "text", "p_capability" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."cash_book_detail"("p_business_id" "uuid", "p_bank_account_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."check_capture_permission"("p_business_id" "uuid", "p_domain_hint" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_takes" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_takes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_takes" TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_stock_take"("p_stock_take_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."commission_calculations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."commission_calculations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."commission_calculations" TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_commission_for_invoice"("p_invoice_id" "uuid", "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_transactions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_transactions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_transactions" TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_sst_for_invoice"("p_invoice_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."compute_sst_for_payment_voucher"("p_payment_voucher_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."compute_statutory_deductions"("p_gross_pay" numeric, "p_as_of" "date") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."document_number_sequences" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."document_number_sequences" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."document_number_sequences" TO "service_role";



GRANT ALL ON FUNCTION "public"."configure_document_sequence"("p_business_id" "uuid", "p_document_type" "text", "p_prefix" "text", "p_reset_period" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."convert_quotation_to_invoice"("p_quotation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."convert_quotation_to_invoice_with_credit_override"("p_quotation_id" "uuid", "p_override_reason" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_delegations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_delegations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_delegations" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_approval_delegation"("p_business_id" "uuid", "p_delegator_membership_id" "uuid", "p_delegate_membership_id" "uuid", "p_domain_scope" "text", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_reason" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_tasks" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_tasks" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_tasks" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_approval_task"("p_business_id" "uuid", "p_domain" "text", "p_subject_type" "text", "p_subject_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text", "p_ai_confidence" numeric, "p_captured_by_membership_id" "uuid", "p_auto_approved" boolean) TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_approval_task"("p_business_id" "uuid", "p_domain" "text", "p_subject_type" "text", "p_subject_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text", "p_ai_confidence" numeric, "p_captured_by_membership_id" "uuid", "p_auto_approved" boolean, "p_on_approval_action" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."attendance_records" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."attendance_records" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."attendance_records" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_attendance_record"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_clock_type" "text", "p_recorded_at" timestamp with time zone, "p_gps_lat" numeric, "p_gps_lng" numeric, "p_gps_accuracy_m" numeric, "p_source" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_accounts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_accounts" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_accounts" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_bank_account"("p_business_id" "uuid", "p_account_name" "text", "p_ledger_account_id" "uuid", "p_opening_balance" numeric) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."businesses" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."businesses" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."businesses" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_business"("p_legal_name" "text", "p_industry" "text", "p_ssm_registration_number" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."capture_triage" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."capture_triage" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."capture_triage" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_capture_triage_item"("p_business_id" "uuid", "p_raw_text" "text", "p_detected_domain" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chart_of_accounts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chart_of_accounts" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chart_of_accounts" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_chart_of_account"("p_business_id" "uuid", "p_account_code" "text", "p_account_name" "text", "p_account_type" "text", "p_parent_account_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."claims" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."claims" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."claims" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_claim"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_amount" numeric, "p_category" "text", "p_document_id_receipt" "uuid", "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."commission_rules" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."commission_rules" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."commission_rules" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_commission_rule"("p_business_id" "uuid", "p_basis" "text", "p_rate" numeric, "p_applies_to_party_id" "uuid", "p_product_scope" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contracts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contracts" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."contracts" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_contract"("p_business_id" "uuid", "p_counterparty_id" "uuid", "p_contract_type" "text", "p_start_date" "date", "p_end_date" "date", "p_auto_renew" boolean, "p_renewal_notice_days" integer, "p_document_id" "uuid", "p_credit_limit_override" numeric, "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_notes" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_notes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_notes" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_credit_note"("p_business_id" "uuid", "p_source_invoice_id" "uuid", "p_grand_total" numeric, "p_reason" "text", "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_orders" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_orders" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_orders" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_delivery_order"("p_business_id" "uuid", "p_invoice_id" "uuid", "p_warehouse_id" "uuid", "p_lines" "jsonb", "p_notes" "text", "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."documents" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."documents" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_document"("p_business_id" "uuid", "p_storage_ref" "text", "p_content_type" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_invoice_submissions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_invoice_submissions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_invoice_submissions" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_einvoice_submission"("p_business_id" "uuid", "p_invoice_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_profiles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_profiles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_profiles" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_employee_profile"("p_business_id" "uuid", "p_party_id" "uuid", "p_ic_number" "text", "p_epf_number" "text", "p_socso_number" "text", "p_income_tax_no" "text", "p_bank_name" "text", "p_bank_account_no" "text", "p_basic_salary" numeric, "p_employment_type" "text", "p_hire_date" "date", "p_encryption_key" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_signature_envelopes" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_signature_envelopes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_signature_envelopes" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_esignature_envelope"("p_contract_id" "uuid", "p_quotation_id" "uuid", "p_provider" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_applications" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_applications" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_applications" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_leave_application"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_leave_type_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_types" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_types" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_types" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_leave_type"("p_business_id" "uuid", "p_name" "text", "p_default_entitlement_days" numeric) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."parties" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."parties" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."parties" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_party"("p_business_id" "uuid", "p_display_name" "text", "p_legal_name" "text", "p_party_types" "text"[], "p_registration_no" "text", "p_tin" "text", "p_sst_reg_no" "text", "p_contact_phone" "text", "p_contact_email" "text", "p_billing_address" "text", "p_credit_limit" numeric, "p_credit_terms_days" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_payment_voucher"("p_business_id" "uuid", "p_payee_party_id" "uuid", "p_expense_category" "text", "p_payment_method" "text", "p_grand_total" numeric, "p_notes" "text", "p_document_id_receipt" "uuid", "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payroll_runs" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payroll_runs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payroll_runs" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_payroll_run"("p_business_id" "uuid", "p_period" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."price_list_entries" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."price_list_entries" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."price_list_entries" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_price_list_entry"("p_product_id" "uuid", "p_price_type_id" "uuid", "p_unit_price" numeric, "p_effective_from" "date", "p_effective_to" "date", "p_promo_note" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."price_types" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."price_types" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."price_types" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_price_type"("p_business_id" "uuid", "p_name" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_product"("p_business_id" "uuid", "p_sku" "text", "p_name" "text", "p_unit_of_measure" "text", "p_default_cost" numeric, "p_cost_source" "text", "p_track_inventory" boolean) TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_product_import_batch"("p_business_id" "uuid", "p_source_file_ref" "text", "p_rows" "jsonb") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."quotations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."quotations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."quotations" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_quotation"("p_business_id" "uuid", "p_party_id" "uuid", "p_valid_until" "date", "p_notes" "text", "p_lines" "jsonb", "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."salary_advances" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."salary_advances" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."salary_advances" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_salary_advance"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_amount" numeric, "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_returns" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_returns" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_returns" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_sst_return"("p_business_id" "uuid", "p_period" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_stock_take"("p_business_id" "uuid", "p_warehouse_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."warehouses" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."warehouses" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."warehouses" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_warehouse"("p_business_id" "uuid", "p_name" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."decide_approval_task"("p_task_id" "uuid", "p_decision" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."overtime_records" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."overtime_records" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."overtime_records" TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_overtime_for_date"("p_business_id" "uuid", "p_employee_party_id" "uuid", "p_date" "date", "p_scheduled_hours" numeric, "p_ai_draft_summary" "text", "p_auto_approved" boolean) TO "authenticated";



GRANT ALL ON FUNCTION "public"."dispatch_delivery_order"("p_delivery_order_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."effective_access_model"("p_business_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."expense_category_breakdown"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."general_ledger_detail"("p_business_id" "uuid", "p_account_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bulk_payment_file_exports" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bulk_payment_file_exports" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bulk_payment_file_exports" TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_bulk_payment_file_export"("p_payroll_run_id" "uuid", "p_encryption_key" "text", "p_bank_format" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."generate_consolidated_einvoice_batch"("p_business_id" "uuid", "p_consolidated_period" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_employee_profile_decrypted"("p_employee_profile_id" "uuid", "p_encryption_key" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_balances" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_balances" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_balances" TO "service_role";



GRANT ALL ON FUNCTION "public"."grant_leave_balance"("p_employee_party_id" "uuid", "p_leave_type_id" "uuid", "p_year" integer, "p_entitled_days" numeric) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_statement_lines" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_statement_lines" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_statement_lines" TO "service_role";



GRANT ALL ON FUNCTION "public"."ignore_bank_statement_line"("p_statement_line_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."import_bank_statement_lines"("p_bank_account_id" "uuid", "p_lines" "jsonb") TO "authenticated";



GRANT ALL ON FUNCTION "public"."invite_member"("p_business_id" "uuid", "p_invited_email" "text", "p_role_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."invoice_effective_status"("p_invoice_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_active_member"("p_business_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."list_due_contract_alerts"("p_business_id" "uuid", "p_as_of" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."list_member_identities"("p_business_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."map_domain_hint"("p_domain_hint" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_commission_paid"("p_commission_calculation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_delivery_order_delivered"("p_delivery_order_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_esignature_envelope_declined"("p_envelope_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_esignature_envelope_signed"("p_envelope_id" "uuid", "p_signed_document_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_esignature_envelope_viewed"("p_envelope_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_payment_voucher_paid"("p_payment_voucher_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_payroll_run_paid"("p_payroll_run_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payslips" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payslips" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payslips" TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_payslip_sent"("p_payslip_id" "uuid", "p_channel" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_quotation_accepted"("p_quotation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_quotation_rejected"("p_quotation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."mark_quotation_sent"("p_quotation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."match_bank_statement_line"("p_statement_line_id" "uuid", "p_ledger_entry_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."next_document_number"("p_business_id" "uuid", "p_document_type" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ledger_entries" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ledger_entries" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ledger_entries" TO "service_role";



GRANT ALL ON FUNCTION "public"."post_ledger_entries"("p_business_id" "uuid", "p_business_data_id" "uuid", "p_entries" "jsonb") TO "authenticated";



GRANT ALL ON FUNCTION "public"."profit_and_loss_summary"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."recompute_invoice_balance"("p_invoice_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."record_einvoice_submission_result"("p_submission_id" "uuid", "p_status" "text", "p_lhdn_uuid" "text", "p_qr_code_ref" "text", "p_irb_response_ref" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_levels" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_levels" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_levels" TO "service_role";



GRANT ALL ON FUNCTION "public"."record_opening_stock"("p_business_id" "uuid", "p_product_id" "uuid", "p_warehouse_id" "uuid", "p_quantity" numeric, "p_unit_cost" numeric) TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON FUNCTION "public"."record_payment"("p_business_id" "uuid", "p_invoice_id" "uuid", "p_amount" numeric, "p_method" "text", "p_received_at" "date", "p_reference" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_take_lines" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_take_lines" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_take_lines" TO "service_role";



GRANT ALL ON FUNCTION "public"."record_stock_take_counts"("p_stock_take_id" "uuid", "p_counts" "jsonb") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devices" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devices" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devices" TO "service_role";



GRANT ALL ON FUNCTION "public"."register_device"("p_device_id" "text", "p_platform" "text", "p_device_label" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."remove_membership"("p_target_membership_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."rename_device"("p_device_id" "text", "p_new_device_label" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_device_lock" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_device_lock" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_device_lock" TO "service_role";



GRANT ALL ON FUNCTION "public"."request_activation"("p_device_id" "text", "p_last_applied_server_seq" bigint, "p_expected_lock_token" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."request_primary_takeover"("p_device_id" "text", "p_last_applied_server_seq" bigint) TO "authenticated";



GRANT ALL ON FUNCTION "public"."resolve_approval_task"("p_task_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."resolve_capture_triage_item"("p_id" "uuid", "p_status" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."resolve_price"("p_business_id" "uuid", "p_product_id" "uuid", "p_party_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."revenue_vs_cost_dashboard"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."revoke_approval_delegation"("p_delegation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."revoke_device"("p_device_id" "text", "p_new_active_device_id" "text", "p_new_primary_device_id" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_access_model_override"("p_business_id" "uuid", "p_override" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_default_price_type"("p_business_id" "uuid", "p_price_type_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_member_label"("p_membership_id" "uuid", "p_label" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON FUNCTION "public"."set_my_display_name"("p_display_name" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_party_price_type"("p_party_id" "uuid", "p_price_type_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_primary_device"("p_new_primary_device_id" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."segregation_of_duties_policies" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."segregation_of_duties_policies" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."segregation_of_duties_policies" TO "service_role";



GRANT ALL ON FUNCTION "public"."set_sod_policy"("p_business_id" "uuid", "p_domain" "text", "p_enforce_maker_checker" boolean, "p_amount_threshold_myr" numeric, "p_allow_self_approval_if_sole_eligible" boolean) TO "authenticated";



GRANT ALL ON FUNCTION "public"."stock_report"("p_business_id" "uuid", "p_warehouse_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."submit_einvoice"("p_submission_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."submit_payroll_run"("p_payroll_run_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."submit_sst_return"("p_sst_return_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."suspend_membership"("p_target_membership_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."tax_report_placeholder"("p_business_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."touch_device_heartbeat"("p_device_id" "text", "p_last_synced_server_seq" bigint) TO "authenticated";



GRANT ALL ON FUNCTION "public"."trial_balance"("p_business_id" "uuid", "p_as_of_date" "date") TO "authenticated";


















GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."backups" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."backups" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."backups" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."business_access_model_transitions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."business_access_model_transitions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."business_access_model_transitions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_limit_override_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_limit_override_log" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credit_limit_override_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_order_lines" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_order_lines" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_order_lines" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_invoice_submission_lines" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_invoice_submission_lines" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."e_invoice_submission_lines" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoice_lines" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoice_lines" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoice_lines" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_import_rows" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_import_rows" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_import_rows" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."quotation_lines" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."quotation_lines" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."quotation_lines" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."role_permissions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."role_permissions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."role_permissions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_rates" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_rates" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sst_rates" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."statutory_rate_tables" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."statutory_rate_tables" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."statutory_rate_tables" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sync_envelopes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sync_envelopes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sync_envelopes" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."sync_envelopes_server_seq_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."sync_envelopes_server_seq_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."sync_envelopes_server_seq_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";

































-- END_TXN_WRAPPER_ADDED
commit;
