# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-32's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 33's e-Invoice & SST
# claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23-32) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# every prior sprint's test script used).
#
# ============================================================
# IMPORTANT — READ BEFORE TRUSTING THIS AS "DONE":
# This sprint's own Definition of Done items 1 and 4 require a REAL
# submission against LHDN's live MyInvois sandbox (a real UUID/QR
# code back, and a real IRB rejection reason for a malformed one).
# This session has no LHDN sandbox API credentials and cannot
# fabricate a live connection to a government sandbox. The owner was
# asked directly (via AskUserQuestion) how to proceed and chose to
# have this sprint's schema, Finance PKA rule sets, SST computation,
# and the full submission STATE MACHINE built now, with the actual
# MyInvois HTTP call simulated by a stub client
# (StubMyInvoisClient in eInvoiceSstTransport.ts).
#
# What this script proves is that the STATE MACHINE and SST
# computation are correct: draft -> submitted -> validated/rejected
# transitions, the data-integrity guards, and SST arithmetic against
# three different rates. It does NOT and CANNOT prove DoD items 1 and
# 4's literal "against the real LHDN MyInvois sandbox" requirement —
# those stay explicitly open in the Sprint 33 doc's Outcomes section,
# pending real credentials.
# ============================================================
#
# What this proves (Sprint 33 Definition of Done — with the above
# caveat on items 1 and 4):
#   A. e-Invoice submission state machine: create (draft) -> submit
#      (submitted) -> record result (validated, with UUID + QR) is
#      exercised end to end against a real Sprint 28 invoice, using
#      the simulated MyInvois response shape.
#   B. Consolidated invoice batch generation: a period with a mix of
#      B2B (has TIN) and B2C (no TIN) invoices generates one batch
#      containing ONLY the B2C ones.
#   C. SST computed correctly against three different codes/rates
#      (SR-10, SV-8, EX), verified against hand computation.
#   D. A deliberately malformed/rejected submission is handled with
#      the (simulated) IRB rejection reason surfaced, not swallowed —
#      see the caveat above on "real IRB" vs. simulated.
#   Plus: role gating throughout (tax_compliance: capture/view
#   required), and the data-integrity guards on duplicate submissions
#   and duplicate SST computation.

import uuid
import psycopg2
import psycopg2.extras

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint33_test user=postgres password=testpass123"

BOOKKEEPER_ROLE = "00000000-0000-0000-0000-000000000002"
SALES_AGENT_ROLE = "00000000-0000-0000-0000-000000000003"
WAREHOUSE_ROLE = "00000000-0000-0000-0000-000000000004"


def u():
    return str(uuid.uuid4())


def as_user(cur, user_id):
    cur.execute("set role authenticated")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))


def as_superuser(cur):
    cur.execute("reset role")


def check(label, cur, sql, params, expected):
    cur.execute(sql, params)
    row = cur.fetchone()
    actual = row[0] if row else None
    status = "PASS" if actual == expected else f"FAIL (expected {expected!r}, got {actual!r})"
    print(f"[{status}] {label}")
    return actual == expected


def expect_error(label, cur, conn, fn):
    try:
        fn()
        print(f"[FAIL] {label} (no error raised)")
        return False
    except psycopg2.Error as e:
        print(f"[PASS] {label} ({str(e).strip().splitlines()[0]})")
        return True
    finally:
        conn.rollback()


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
        "values (%s, %s, '00000000-0000-0000-0000-000000000001', 'active', now(), now()) returning id",
        (business_id, owner_user),
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
    cur.execute(
        "select id from public.approval_tasks where subject_type=%s and subject_id=%s "
        "order by created_at desc limit 1", (subject_type, subject_id),
    )
    task_id = cur.fetchone()[0]
    as_user(cur, decider_user)
    cur.execute("select public.decide_approval_task(%s,%s)", (task_id, decision))
    conn.commit()
    return task_id


def make_invoice(cur, conn, salesagent_user, biz, party_id, product_id, quantity, owner_user, tax_code=None):
    as_user(cur, salesagent_user)
    line = {"product_id": product_id, "description": "fixture line", "quantity": quantity}
    if tax_code:
        line["tax_code"] = tax_code
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+7,'fixture', %s)",
        (biz, party_id, psycopg2.extras.Json([line])),
    )
    quotation_id = cur.fetchone()[0]
    conn.commit()
    cur.execute("select id from public.approval_tasks where subject_type='quotation' and subject_id=%s", (quotation_id,))
    task_id = cur.fetchone()[0]
    as_user(cur, owner_user)
    cur.execute("select public.decide_approval_task(%s,'approved')", (task_id,))
    conn.commit()
    as_user(cur, salesagent_user)
    cur.execute("select public.mark_quotation_sent(%s)", (quotation_id,))
    cur.execute("select public.mark_quotation_accepted(%s)", (quotation_id,))
    cur.execute("select id, grand_total from public.convert_quotation_to_invoice(%s)", (quotation_id,))
    invoice_id, grand_total = cur.fetchone()
    conn.commit()
    return invoice_id, grand_total


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    biz, owner, om_owner = seed_business(cur, "ownerY@test.com")
    conn.commit()
    bookkeeper_user, om_bookkeeper = invite_and_accept(cur, conn, owner, biz, BOOKKEEPER_ROLE, "bkY@test.com")
    salesagent_user, om_salesagent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "saY@test.com")
    warehouse_user, om_warehouse = invite_and_accept(cur, conn, owner, biz, WAREHOUSE_ROLE, "whY@test.com")

    # ------- fixtures --------------------------------------------------
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_type(%s,'Retail')", (biz,))
    pt_retail = cur.fetchone()[0]
    cur.execute("select id from public.create_product(%s,'SKU-Y1','Taxable Widget','pcs',5.00,'manual',false)", (biz,))
    product_id = cur.fetchone()[0]
    conn.commit()
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_list_entry(%s,%s,100.00,current_date - 1,null,null)", (product_id, pt_retail))
    conn.commit()

    # A B2C party (no TIN) and a B2B party (has TIN).
    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_party(%s,'Consumer Co',null,%s,null,null,null,'+60144444444',null,null,null,0)",
        (biz, ["customer"]),
    )
    b2c_party_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_party(%s,'Business Buyer Sdn Bhd','Business Buyer Sdn Bhd',%s,'REG-001','C1234567890',null,'+60155555555',null,null,null,0)",
        (biz, ["customer"]),
    )
    b2b_party_id = cur.fetchone()[0]
    payee_id = b2b_party_id
    conn.commit()

    # ================= A: e-Invoice submission state machine =================
    invoice_id, grand_total = make_invoice(cur, conn, salesagent_user, biz, b2c_party_id, product_id, 5, owner, tax_code='SR-10')

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "A: Sales Agent (no tax_compliance capture) cannot create an e-invoice submission", cur, conn,
        lambda: cur.execute("select public.create_einvoice_submission(%s,%s)", (biz, invoice_id)),
    )

    as_user(cur, bookkeeper_user)
    cur.execute("select id, status from public.create_einvoice_submission(%s,%s)", (biz, invoice_id))
    submission_id, submission_status = cur.fetchone()
    conn.commit()
    all_passed &= (submission_status == 'draft')
    print(f"[{'PASS' if submission_status == 'draft' else 'FAIL'}] A: create_einvoice_submission starts as 'draft'")

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "A: a second submission for the same still-active invoice is rejected", cur, conn,
        lambda: cur.execute("select public.create_einvoice_submission(%s,%s)", (biz, invoice_id)),
    )
    all_passed &= expect_error(
        "A: record_einvoice_submission_result refused before submit_einvoice", cur, conn,
        lambda: cur.execute(
            "select public.record_einvoice_submission_result(%s,'validated','UUID-1','qr/ref-1',null)", (submission_id,),
        ),
    )

    as_user(cur, bookkeeper_user)
    cur.execute("select status from public.submit_einvoice(%s)", (submission_id,))
    submitted_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (submitted_status == 'submitted')

    # Simulated MyInvois response (see this file's header) — a successful validation.
    as_user(cur, bookkeeper_user)
    cur.execute(
        "select status, lhdn_uuid, qr_code_ref from public.record_einvoice_submission_result(%s,'validated',%s,%s,%s)",
        (submission_id, 'SIMULATED-UUID-0001', 'qr/simulated-0001.png', '{"simulated": true, "irbResponseCode": "OK"}'),
    )
    final_status, lhdn_uuid, qr_ref = cur.fetchone()
    conn.commit()
    ok = final_status == 'validated' and lhdn_uuid == 'SIMULATED-UUID-0001' and qr_ref == 'qr/simulated-0001.png'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: record_einvoice_submission_result('validated', ...) stores the "
          f"(simulated) UUID and QR code ref and moves status to 'validated'")

    # ================= D: rejection path (simulated IRB response) ============
    invoice2_id, _ = make_invoice(cur, conn, salesagent_user, biz, b2c_party_id, product_id, 1, owner, tax_code='EX')
    as_user(cur, bookkeeper_user)
    cur.execute("select id from public.create_einvoice_submission(%s,%s)", (biz, invoice2_id))
    submission2_id = cur.fetchone()[0]
    cur.execute("select public.submit_einvoice(%s)", (submission2_id,))
    conn.commit()

    simulated_irb_rejection = (
        '{"simulated": true, "irbResponseCode": "SIN01", '
        '"irbResponseMessage": "Buyer TIN format invalid — expected format C1234567890"}'
    )
    as_user(cur, bookkeeper_user)
    cur.execute(
        "select status, irb_response_ref from public.record_einvoice_submission_result(%s,'rejected',null,null,%s)",
        (submission2_id, simulated_irb_rejection),
    )
    rejected_status, irb_ref = cur.fetchone()
    conn.commit()
    ok = rejected_status == 'rejected' and 'Buyer TIN format invalid' in irb_ref
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: a rejected submission surfaces the (simulated) IRB rejection reason "
          f"verbatim in irb_response_ref, not a generic error — got {irb_ref!r}")

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "D: record_einvoice_submission_result refused on an already-decided (rejected) submission", cur, conn,
        lambda: cur.execute(
            "select public.record_einvoice_submission_result(%s,'validated','X','Y',null)", (submission2_id,),
        ),
    )
    # A fresh submission can now legitimately be created for invoice2 since the prior one is 'rejected'.
    as_user(cur, bookkeeper_user)
    cur.execute("select status from public.create_einvoice_submission(%s,%s)", (biz, invoice2_id))
    resubmit_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (resubmit_status == 'draft')
    print(f"[{'PASS' if resubmit_status == 'draft' else 'FAIL'}] D: a new e-invoice submission can be created "
          f"for an invoice whose prior submission was rejected")

    # ================= B: Consolidated invoice batch ==========================
    # NOTE: invoice_id and invoice2_id (used in sections A/D above) already have
    # an active (non-rejected/cancelled) individual e-invoice submission each by
    # this point, so generate_consolidated_einvoice_batch's own
    # "not exists (... es.status not in ('rejected','cancelled'))" guard
    # correctly excludes them from consolidation (an invoice already submitted
    # individually should not also be folded into a consolidated batch). So this
    # section uses two FRESH B2C invoices, untouched by sections A/D, to test
    # consolidated eligibility cleanly — plus a B2B invoice (party has a TIN),
    # which must be excluded, for the actual thing being tested here.
    b2c_invoice3_id, _ = make_invoice(cur, conn, salesagent_user, biz, b2c_party_id, product_id, 3, owner, tax_code='SR-10')
    b2c_invoice4_id, _ = make_invoice(cur, conn, salesagent_user, biz, b2c_party_id, product_id, 1, owner, tax_code='EX')
    b2b_invoice_id, _ = make_invoice(cur, conn, salesagent_user, biz, b2b_party_id, product_id, 2, owner, tax_code='SV-8')

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "B: Sales Agent (no tax_compliance capture) cannot generate a consolidated batch", cur, conn,
        lambda: cur.execute("select public.generate_consolidated_einvoice_batch(%s,%s)", (biz, '2026-09')),
    )

    as_user(cur, bookkeeper_user)
    cur.execute("select id, status, submission_type from public.generate_consolidated_einvoice_batch(%s,%s)", (biz, '2026-09'))
    batch_id, batch_status, batch_type = cur.fetchone()
    conn.commit()
    ok = batch_status == 'draft' and batch_type == 'consolidated'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: generate_consolidated_einvoice_batch creates a draft consolidated submission")

    as_user(cur, bookkeeper_user)
    cur.execute("select invoice_id from public.e_invoice_submission_lines where submission_id=%s", (batch_id,))
    batch_invoice_ids = {r[0] for r in cur.fetchall()}
    conn.commit()
    ok = (
        b2c_invoice3_id in batch_invoice_ids
        and b2c_invoice4_id in batch_invoice_ids
        and b2b_invoice_id not in batch_invoice_ids
        and invoice_id not in batch_invoice_ids  # already individually submitted (validated) — correctly excluded
        and invoice2_id not in batch_invoice_ids  # already individually re-submitted (draft) — correctly excluded
    )
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: the batch includes the two fresh B2C invoices and EXCLUDES the B2B one "
          f"(party has a TIN) and the two already-individually-submitted B2C invoices — got {len(batch_invoice_ids)} invoice(s) in batch")

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "B: a second consolidated batch for the same period is rejected", cur, conn,
        lambda: cur.execute("select public.generate_consolidated_einvoice_batch(%s,%s)", (biz, '2026-09')),
    )
    all_passed &= expect_error(
        "B: generate_consolidated_einvoice_batch rejects a period with no eligible invoices", cur, conn,
        lambda: cur.execute("select public.generate_consolidated_einvoice_batch(%s,%s)", (biz, '2099-01')),
    )

    # ================= C: SST computation, three different rates ==============
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "C: Sales Agent (no tax_compliance capture) cannot compute SST", cur, conn,
        lambda: cur.execute("select * from public.compute_sst_for_invoice(%s)", (invoice_id,)),
    )

    as_user(cur, bookkeeper_user)
    cur.execute("select sst_code, rate, taxable_amount, sst_amount from public.compute_sst_for_invoice(%s)", (invoice_id,))
    sst_rows = cur.fetchall()
    conn.commit()
    # invoice_id: 5 * 100.00 = 500.00 taxable, tax_code SR-10 (10%) -> sst_amount 50.00
    ok = len(sst_rows) == 1 and sst_rows[0][0] == 'SR-10' and float(sst_rows[0][3]) == 50.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: SR-10 (10%) on invoice1's 500.00 taxable amount computes sst_amount=50.00 — got {sst_rows}")

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "C: computing SST twice for the same invoice is rejected", cur, conn,
        lambda: cur.execute("select * from public.compute_sst_for_invoice(%s)", (invoice_id,)),
    )

    as_user(cur, bookkeeper_user)
    cur.execute("select sst_code, sst_amount from public.compute_sst_for_invoice(%s)", (invoice2_id,))
    sst2_rows = cur.fetchall()
    conn.commit()
    # invoice2: 1 * 100.00 = 100.00 taxable, tax_code EX (0%) -> sst_amount 0.00
    ok = len(sst2_rows) == 1 and sst2_rows[0][0] == 'EX' and float(sst2_rows[0][1]) == 0.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: EX (0%) on invoice2's 100.00 taxable amount computes sst_amount=0.00 — got {sst2_rows}")

    # Payment Voucher side: SV-8 (8%) on a 300.00 PV.
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_payment_voucher(%s,%s,'Marketing','bank_transfer',300.00,'ad campaign')",
        (biz, payee_id),
    )
    pv_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'payment_voucher', pv_id, bookkeeper_user, 'approved')

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "C: compute_sst_for_payment_voucher refused before sst_code is set on the PV", cur, conn,
        lambda: cur.execute("select public.compute_sst_for_payment_voucher(%s)", (pv_id,)),
    )

    as_superuser(cur)
    cur.execute("update public.payment_vouchers set sst_code='SV-8' where id=%s", (pv_id,))
    conn.commit()

    as_user(cur, bookkeeper_user)
    cur.execute("select sst_code, sst_amount from public.compute_sst_for_payment_voucher(%s)", (pv_id,))
    pv_sst_code, pv_sst_amount = cur.fetchone()
    conn.commit()
    ok = pv_sst_code == 'SV-8' and float(pv_sst_amount) == 24.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: SV-8 (8%) on a 300.00 payment voucher computes sst_amount=24.00 — got {pv_sst_code}, {pv_sst_amount}")

    # ================= SST Return =============================================
    as_user(cur, bookkeeper_user)
    cur.execute("select total_output_tax from public.create_sst_return(%s,'2026-09')", (biz,))
    return_total = cur.fetchone()[0]
    conn.commit()
    # Total for period 2026-09: invoice1 (50.00) + invoice2 (0.00) + PV (24.00) = 74.00
    ok = float(return_total) == 74.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: create_sst_return aggregates total_output_tax=74.00 for period 2026-09 "
          f"(50.00 + 0.00 + 24.00) — got {return_total}")

    as_user(cur, bookkeeper_user)
    cur.execute("select id from public.sst_returns where business_id=%s and period='2026-09'", (biz,))
    sst_return_id = cur.fetchone()[0]
    cur.execute("select status from public.submit_sst_return(%s)", (sst_return_id,))
    submit_return_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (submit_return_status == 'submitted')
    print(f"[{'PASS' if submit_return_status == 'submitted' else 'FAIL'}] C: submit_sst_return moves status to 'submitted'")

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    print()
    print("REMINDER: DoD items 1 and 4 (real LHDN MyInvois sandbox submission, real IRB")
    print("rejection reason) are NOT verified by this script — see this file's own header")
    print("and the Sprint 33 doc's Outcomes section for why, and what's still open.")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
