# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-35's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 36's contracts/
# alerts/e-signature/credit-limit work was verified. Final sprint of
# the Phase 3 sprint plan.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 21-35) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script.
#
# ============================================================
# NOTE ON e-SIGNATURE PROVIDER: per the owner's own explicit choice
# (asked via AskUserQuestion this sprint), e_signature_envelopes is a
# provider-agnostic STUB — the sent->viewed->signed lifecycle below is
# simulated entirely server-side. Nothing here calls a real vendor API
# (DocuSign, Dropbox Sign, or otherwise). DoD item 2 ("verified against
# the chosen provider") stays open — see the Sprint 36 doc's Outcomes.
# What IS verified: the full status machine, and that envelope status
# correctly reflects back onto the parent Contract/Quotation.
# ============================================================
#
# What this proves (Sprint 36 Definition of Done):
#   A. Contract renewal alert fires at the correct configured LEAD TIME
#      (trigger_date = end_date - renewal_notice_days), not on the
#      exact expiry date — verified by checking list_due_contract_
#      alerts is empty one day before trigger_date and non-empty on
#      trigger_date, while end_date is still weeks away.
#   B. A full e-signature sign cycle (sent -> viewed -> signed) is
#      verified for BOTH a Contract and a Quotation, correctly
#      reflecting status back onto the parent record — against the
#      provider-agnostic stub, not a real vendor (see above).
#   C. The credit limit gate correctly BLOCKS a real over-limit
#      invoice with a clear, explained reason, and the explicit owner
#      override path works, is role-gated, and is logged (not silent).
#   D. Contract.credit_limit_override correctly takes PRECEDENCE over
#      Party.credit_limit when an active Contract carries one.
#   Plus: role gating on every new legal_contract-gated action,
#   rejection-deletes-the-draft-contract-row (no invented status),
#   and the outstanding-balance-plus-new-invoice arithmetic checked
#   against an independently-computed reference.

import uuid
import psycopg2
import psycopg2.extras

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint36_test user=postgres password=testpass123"

OWNER_ROLE = "00000000-0000-0000-0000-000000000001"
SALES_AGENT_ROLE = "00000000-0000-0000-0000-000000000003"


def u():
    return str(uuid.uuid4())


def as_user(cur, user_id):
    cur.execute("set role authenticated")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))


def as_superuser(cur):
    cur.execute("reset role")


def check(label, actual, expected):
    ok = actual == expected
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" (expected {expected!r}, got {actual!r})"))
    return ok


def expect_error(label, cur, conn, fn, contains=None):
    try:
        fn()
        print(f"[FAIL] {label} (no error raised)")
        conn.rollback()
        return False
    except psycopg2.Error as e:
        msg = str(e).strip().splitlines()[0]
        ok = contains is None or contains in msg
        print(f"[{'PASS' if ok else 'FAIL'}] {label} ({msg})")
        conn.rollback()
        return ok


def seed_business(cur, owner_email):
    owner_user = u()
    business_id = owner_user
    as_superuser(cur)
    cur.execute("insert into auth.users (id, email) values (%s, %s)", (owner_user, owner_email))
    cur.execute(
        "insert into public.businesses (id, owner_user_id, legal_name) values (%s, %s, %s)",
        (business_id, owner_user, owner_email),
    )
    cur.execute(
        "insert into public.business_memberships (business_id, user_id, role_id, status, invited_at, accepted_at) "
        "values (%s, %s, %s, 'active', now(), now()) returning id",
        (business_id, owner_user, OWNER_ROLE),
    )
    owner_membership_id = cur.fetchone()[0]
    return business_id, owner_user, owner_membership_id


def invite_and_accept(cur, conn, owner_user, business_id, role_id, email):
    as_user(cur, owner_user)
    cur.execute("select id from public.invite_member(%s, %s, %s)", (business_id, email, role_id))
    conn.commit()
    new_user = u()
    as_superuser(cur)
    cur.execute("insert into auth.users (id, email) values (%s, %s)", (new_user, email))
    conn.commit()
    as_user(cur, new_user)
    cur.execute("select id from public.accept_membership_invitation(%s)", (business_id,))
    membership_id = cur.fetchone()[0]
    conn.commit()
    return new_user, membership_id


def decide_pending_task(cur, conn, subject_type, subject_id, decider_user, decision):
    as_superuser(cur)
    cur.execute(
        "select id from public.approval_tasks where subject_type=%s and subject_id=%s "
        "order by created_at desc limit 1", (subject_type, subject_id),
    )
    task_id = cur.fetchone()[0]
    as_user(cur, decider_user)
    cur.execute("select public.decide_approval_task(%s,%s)", (task_id, decision))
    conn.commit()
    return task_id


def make_accepted_quotation(cur, conn, owner_user, biz, party_id, grand_total):
    """Builds a quotation for exactly `grand_total` (one line, qty=1) and walks it to 'accepted'."""
    as_user(cur, owner_user)
    line = {"description": "fixture line", "quantity": 1, "unit_price": grand_total}
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+30,'fixture', %s)",
        (biz, party_id, psycopg2.extras.Json([line])),
    )
    quotation_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'quotation', quotation_id, owner_user, 'approved')
    as_user(cur, owner_user)
    cur.execute("select public.mark_quotation_sent(%s)", (quotation_id,))
    cur.execute("select public.mark_quotation_accepted(%s)", (quotation_id,))
    conn.commit()
    return quotation_id


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    biz, owner, om_owner = seed_business(cur, "owner36@test.com")
    conn.commit()
    sales_agent_user, om_sales_agent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "sa36@test.com")

    as_user(cur, owner)
    cur.execute(
        "select id from public.create_party(%s,'Contract Counterparty Sdn Bhd',null,%s,null,null,null,"
        "'+60167777777',null,null,1000.00,30)",
        (biz, ["customer"]),
    )
    counterparty_id = cur.fetchone()[0]
    conn.commit()

    # =================================================================
    # A. Contract lifecycle: role gating, approval -> pending_signature,
    # rejection deletes the draft row (no invented status).
    # =================================================================
    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "A: Sales Agent (no legal_contract grants) cannot create a contract", cur, conn,
        lambda: cur.execute(
            "select public.create_contract(%s,%s,'nda',null,null,false,null)", (biz, counterparty_id),
        ),
        contains="not_authorized",
    )

    as_user(cur, owner)
    # end_date 40 days out, 30-day notice -> trigger_date = today+10 —
    # well before end_date, so section B can prove lead-time firing.
    cur.execute(
        "select id, status from public.create_contract(%s,%s,'distributor_agreement',null,"
        "current_date+40,true,30)", (biz, counterparty_id),
    )
    contract1_id, contract1_status = cur.fetchone()
    conn.commit()
    ok = contract1_status == 'draft'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: contract starts 'draft'")

    as_superuser(cur)
    cur.execute(
        "select alert_type, trigger_date from public.contract_alerts where contract_id=%s", (contract1_id,),
    )
    alert_type, trigger_date = cur.fetchone()
    conn.commit()
    ok = alert_type == 'renewal_upcoming'  # auto_renew=true
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: ContractAlert auto-generated at creation, alert_type='renewal_upcoming' "
          f"(auto_renew=true), trigger_date={trigger_date} (end_date-30)")

    decide_pending_task(cur, conn, 'contract', contract1_id, owner, 'approved')
    as_superuser(cur)
    cur.execute("select status from public.contracts where id=%s", (contract1_id,))
    ok = cur.fetchone()[0] == 'pending_signature'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: approval flips contract 'draft' -> 'pending_signature'")

    as_user(cur, owner)
    cur.execute(
        "select id from public.create_contract(%s,%s,'other',null,null,false,null)", (biz, counterparty_id),
    )
    contract2_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'contract', contract2_id, owner, 'rejected')
    as_superuser(cur)
    cur.execute("select count(*) from public.contracts where id=%s", (contract2_id,))
    ok = cur.fetchone()[0] == 0
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: a rejected Contract is DELETED, not given an invented 'rejected' "
          f"status value not present in Vol 13_0 §12's own enum")

    # =================================================================
    # B. ContractAlert fires at the configured LEAD TIME, not the exact
    # expiry date — end_date is still 30+ days away when this fires.
    # =================================================================
    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "B: Sales Agent cannot list contract alerts (no legal_contract view)", cur, conn,
        lambda: cur.execute("select * from public.list_due_contract_alerts(%s)", (biz,)),
        contains="not_authorized",
    )

    as_user(cur, owner)
    cur.execute(
        "select count(*) from public.list_due_contract_alerts(%s, (current_date + 9)::date)", (biz,),
    )
    count_before = cur.fetchone()[0]
    conn.commit()
    ok = count_before == 0
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: one day BEFORE trigger_date (today+9, end_date still 31 days away), "
          f"the alert is NOT yet due — got {count_before} due alerts")

    cur.execute(
        "select id, notified_at from public.list_due_contract_alerts(%s, (current_date + 10)::date)", (biz,),
    )
    due_rows = cur.fetchall()
    conn.commit()
    ok = len(due_rows) == 1 and due_rows[0][1] is not None
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: on trigger_date (today+10) the alert IS due — 30-day lead time fired "
          f"correctly, 30 days before end_date (today+40), not on the exact expiry date. notified_at stamped: "
          f"{due_rows[0][1] if due_rows else None}")

    alert1_id = due_rows[0][0]
    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "B: Sales Agent cannot acknowledge a contract alert", cur, conn,
        lambda: cur.execute("select public.acknowledge_contract_alert(%s)", (alert1_id,)),
        contains="not_authorized",
    )
    as_user(cur, owner)
    cur.execute("select status from public.acknowledge_contract_alert(%s)", (alert1_id,))
    ok = cur.fetchone()[0] == 'acknowledged'
    all_passed &= ok
    conn.commit()
    print(f"[{'PASS' if ok else 'FAIL'}] B: acknowledge_contract_alert flips 'pending' -> 'acknowledged'")

    # =================================================================
    # C. e-Signature: full sent -> viewed -> signed cycle for BOTH a
    # Contract and a Quotation, correctly reflected back onto each
    # parent. Provider-agnostic stub — see this file's own header note.
    # =================================================================
    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "C: Sales Agent cannot open an e-signature envelope for a Contract (no legal_contract capture)",
        cur, conn,
        lambda: cur.execute("select public.create_esignature_envelope(%s,null,'generic')", (contract1_id,)),
        contains="not_authorized",
    )

    as_user(cur, owner)
    cur.execute("select id, status, provider from public.create_esignature_envelope(%s,null,'generic')", (contract1_id,))
    env1_id, env1_status, env1_provider = cur.fetchone()
    conn.commit()
    ok = env1_status == 'sent' and env1_provider == 'generic'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: e-signature envelope opened for the Contract, status='sent', "
          f"provider='generic' (provider-agnostic stub, per the owner's own choice)")

    cur.execute("select status from public.mark_esignature_envelope_viewed(%s)", (env1_id,))
    ok = cur.fetchone()[0] == 'viewed'
    all_passed &= ok
    conn.commit()
    print(f"[{'PASS' if ok else 'FAIL'}] C: envelope moves 'sent' -> 'viewed'")

    cur.execute("select status from public.mark_esignature_envelope_signed(%s)", (env1_id,))
    ok = cur.fetchone()[0] == 'signed'
    all_passed &= ok
    conn.commit()
    print(f"[{'PASS' if ok else 'FAIL'}] C: envelope moves 'viewed' -> 'signed' (full sent->viewed->signed cycle)")

    as_superuser(cur)
    cur.execute("select status, start_date from public.contracts where id=%s", (contract1_id,))
    c_status, c_start = cur.fetchone()
    ok = c_status == 'active' and c_start is not None
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: signing the envelope correctly reflects back onto the parent Contract "
          f"— status 'pending_signature' -> 'active', start_date set — got status={c_status!r}, start_date={c_start}")

    as_user(cur, owner)
    all_passed &= expect_error(
        "C: signing an already-signed envelope is rejected, not silently re-signed", cur, conn,
        lambda: cur.execute("select public.mark_esignature_envelope_signed(%s)", (env1_id,)),
        contains="envelope_not_signable",
    )

    # Quotation signature cycle.
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+30,'fixture', %s)",
        (biz, counterparty_id, psycopg2.extras.Json([{"description": "sign-cycle line", "quantity": 1, "unit_price": 100}])),
    )
    q_sign_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'quotation', q_sign_id, owner, 'approved')
    as_user(cur, owner)
    cur.execute("select public.mark_quotation_sent(%s)", (q_sign_id,))
    conn.commit()

    cur.execute("select id from public.create_esignature_envelope(null,%s,'generic')", (q_sign_id,))
    env2_id = cur.fetchone()[0]
    conn.commit()
    cur.execute("select public.mark_esignature_envelope_viewed(%s)", (env2_id,))
    cur.execute("select public.mark_esignature_envelope_signed(%s)", (env2_id,))
    conn.commit()
    as_superuser(cur)
    cur.execute("select status from public.quotations where id=%s", (q_sign_id,))
    ok = cur.fetchone()[0] == 'accepted'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: signing a Quotation's envelope correctly reflects back onto the "
          f"parent Quotation — status 'sent' -> 'accepted'")

    # Decline path — no cascading change to the parent (disclosed).
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+30,'fixture', %s)",
        (biz, counterparty_id, psycopg2.extras.Json([{"description": "decline-cycle line", "quantity": 1, "unit_price": 50}])),
    )
    q_decline_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'quotation', q_decline_id, owner, 'approved')
    as_user(cur, owner)
    cur.execute("select public.mark_quotation_sent(%s)", (q_decline_id,))
    cur.execute("select id from public.create_esignature_envelope(null,%s,'generic')", (q_decline_id,))
    env3_id = cur.fetchone()[0]
    conn.commit()
    cur.execute("select status from public.mark_esignature_envelope_declined(%s)", (env3_id,))
    ok = cur.fetchone()[0] == 'declined'
    all_passed &= ok
    conn.commit()
    as_superuser(cur)
    cur.execute("select status from public.quotations where id=%s", (q_decline_id,))
    ok = ok and cur.fetchone()[0] == 'sent'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: declining an envelope moves it to 'declined' without silently "
          f"changing the parent Quotation's own status")

    # =================================================================
    # D. Credit limit gate: the hard blocking gate, a real over-limit
    # invoice correctly blocked with a clear reason, the explicit
    # owner override path (role-gated, logged), and Contract.credit_
    # limit_override taking precedence over Party.credit_limit.
    # =================================================================
    q1_id = make_accepted_quotation(cur, conn, owner, biz, counterparty_id, 800.00)
    as_user(cur, owner)
    cur.execute("select id, outstanding_balance from public.convert_quotation_to_invoice(%s)", (q1_id,))
    inv1_id, inv1_outstanding = cur.fetchone()
    conn.commit()
    ok = float(inv1_outstanding) == 800.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: an RM800 invoice against a RM1000 limit (0 prior outstanding) "
          f"succeeds normally — got outstanding={inv1_outstanding}")

    q2_id = make_accepted_quotation(cur, conn, owner, biz, counterparty_id, 500.00)
    as_user(cur, owner)
    all_passed &= expect_error(
        "D: an RM500 invoice on top of RM800 outstanding (RM1300 > RM1000 limit) is BLOCKED with a clear reason",
        cur, conn,
        lambda: cur.execute("select public.convert_quotation_to_invoice(%s)", (q2_id,)),
        contains="credit_limit_exceeded",
    )

    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "D: Sales Agent (no settings/configure) cannot use the owner override path", cur, conn,
        lambda: cur.execute(
            "select public.convert_quotation_to_invoice_with_credit_override(%s,'test')", (q2_id,),
        ),
        contains="not_authorized",
    )

    as_user(cur, owner)
    cur.execute(
        "select id from public.convert_quotation_to_invoice_with_credit_override(%s,'owner override: loyal customer')",
        (q2_id,),
    )
    inv2_id = cur.fetchone()[0]
    conn.commit()
    as_superuser(cur)
    cur.execute(
        "select requested_amount, effective_credit_limit, outstanding_balance_before, reason, "
        "overridden_by_membership_id from public.credit_limit_override_log where invoice_id=%s", (inv2_id,),
    )
    log_amount, log_limit, log_outstanding, log_reason, log_by = cur.fetchone()
    ok = (
        float(log_amount) == 500.00 and float(log_limit) == 1000.00 and float(log_outstanding) == 800.00
        and log_reason == 'owner override: loyal customer' and log_by == om_owner
    )
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: the owner override succeeds AND is logged (not silent) — "
          f"requested={log_amount}, limit={log_limit}, outstanding_before={log_outstanding}, reason={log_reason!r}")

    # Contract.credit_limit_override precedence over Party.credit_limit.
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_party(%s,'Contract-Override Customer',null,%s,null,null,null,"
        "'+60168888888',null,null,1000.00,30)",
        (biz, ["customer"]),
    )
    party2_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_contract(%s,%s,'distributor_agreement',null,null,false,null,null,5000.00)",
        (biz, party2_id),
    )
    contract3_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'contract', contract3_id, owner, 'approved')
    as_user(cur, owner)
    cur.execute("select id from public.create_esignature_envelope(%s,null,'generic')", (contract3_id,))
    env4_id = cur.fetchone()[0]
    cur.execute("select public.mark_esignature_envelope_signed(%s)", (env4_id,))
    conn.commit()
    as_superuser(cur)
    cur.execute("select status, credit_limit_override from public.contracts where id=%s", (contract3_id,))
    c3_status, c3_limit = cur.fetchone()
    ok = c3_status == 'active' and float(c3_limit) == 5000.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: the credit-override Contract is now 'active' with credit_limit_"
          f"override=5000.00 (Party's own credit_limit stays 1000.00)")

    q3_id = make_accepted_quotation(cur, conn, owner, biz, party2_id, 3000.00)
    as_user(cur, owner)
    cur.execute("select id, outstanding_balance from public.convert_quotation_to_invoice(%s)", (q3_id,))
    inv3_id, inv3_outstanding = cur.fetchone()
    conn.commit()
    ok = float(inv3_outstanding) == 3000.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: an RM3000 invoice for this party succeeds against the Contract's "
          f"RM5000 override — would have been BLOCKED against the Party's own RM1000 limit, proving the "
          f"Contract override takes precedence — got outstanding={inv3_outstanding}")

    q4_id = make_accepted_quotation(cur, conn, owner, biz, party2_id, 2500.00)
    as_user(cur, owner)
    all_passed &= expect_error(
        "D: a further RM2500 invoice (RM3000+RM2500=RM5500 > the RM5000 CONTRACT limit) is still correctly "
        "blocked — the override limit is enforced, not unlimited", cur, conn,
        lambda: cur.execute("select public.convert_quotation_to_invoice(%s)", (q4_id,)),
        contains="credit_limit_exceeded",
    )

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    print()
    print("REMINDER: e_signature_envelopes is a provider-agnostic STUB per the owner's own explicit choice —")
    print("no real vendor API was called. DoD item 2 ('verified against the chosen provider') stays open.")
    print("See the migration's own header notes and the Sprint 36 doc's Outcomes.")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
