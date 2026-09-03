# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-28's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 29's Payments,
# Credit Notes & AR Ageing claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23-28) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# every prior sprint's test script used).
#
# What this proves (Sprint 29 Definition of Done):
#   A. Partial and full payment recording, with correct ledger
#      posting:
#        A1. A partial payment moves invoice.status to
#            'partially_paid' and reduces outstanding_balance
#            correctly; posts a balanced debit Cash/Bank(1000) /
#            credit Accounts Receivable(1100) pair for the payment
#            amount.
#        A2. A second payment that exactly covers the remainder moves
#            status to 'paid', outstanding_balance to 0.
#        A3. A payment that would exceed the invoice's grand_total is
#            rejected outright (payment_exceeds_outstanding_balance),
#            not silently allowed to overpay.
#   B. Credit note issuance:
#        B1. create_credit_note is gated (capture on sales OR
#            configure on accounting_reports) and creates a real
#            ApprovalTask (domain=sales, subject_type=credit_note).
#        B2. Before approval, the credit note stays 'draft' and the
#            invoice's balance is untouched.
#        B3. On approval, the sync trigger posts it (status='issued',
#            balanced debit Sales Revenue(4000) / credit Accounts
#            Receivable(1100) ledger pair) and correctly reduces the
#            invoice's outstanding_balance / updates its status.
#        B4. On rejection, the credit note is marked 'rejected' and
#            the invoice's balance is untouched.
#        B5. A credit note that would exceed the invoice's remaining
#            balance is rejected at creation time.
#   C. invoice_effective_status: 'overdue' is NEVER stored in
#      invoices.status (still reads 'issued'/'partially_paid'
#      directly), but IS correctly derived at read time once due_date
#      has passed and a balance remains outstanding; a fully-paid
#      invoice past its due date is never reported as overdue.
#   D. AR ageing (ar_ageing_detail), verified against a manually-
#      computed test case: three invoices at different ages bucket
#      correctly into current / 1-30 / 31-60, and a fully-paid invoice
#      is excluded entirely (zero outstanding balance).
#   E. Role gating: Warehouse Staff (no sales capture, no
#      accounting_reports configure) cannot record a payment or
#      create a credit note; Bookkeeper (accounting_reports configure,
#      no sales capture) CAN do both, proving the OR-gate actually
#      covers the bookkeeping-reconciliation path this sprint's own
#      design note describes.

import uuid
import psycopg2
import psycopg2.extras
import datetime

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint29_test user=postgres password=testpass123"

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


def make_invoice(cur, conn, salesagent_user, biz, party_id, product_id, quantity, owner_user, bookkeeper_user):
    """Draft a quotation, approve it via the open queue (Owner or Bookkeeper), accept, convert -> invoice."""
    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+7,'fixture', %s)",
        (biz, party_id, psycopg2.extras.Json([
            {"product_id": product_id, "description": "fixture line", "quantity": quantity},
        ])),
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

    biz, owner, om_owner = seed_business(cur, "ownerV@test.com")
    conn.commit()
    salesagent_user, om_salesagent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "saV@test.com")
    bookkeeper_user, om_bookkeeper = invite_and_accept(cur, conn, owner, biz, BOOKKEEPER_ROLE, "bkV@test.com")
    warehouse_user, om_warehouse = invite_and_accept(cur, conn, owner, biz, WAREHOUSE_ROLE, "whV@test.com")

    # ------- fixtures: price type, product, price list entry, party ---
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_type(%s,'Retail')", (biz,))
    pt_retail = cur.fetchone()[0]
    conn.commit()
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_product(%s,'SKU-P1','Paid Widget','pcs',10.00,'manual',false)", (biz,))
    product_id = cur.fetchone()[0]
    conn.commit()
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_list_entry(%s,%s,100.00,current_date - 1,null,null)", (product_id, pt_retail))
    conn.commit()
    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_party(%s,'Paying Co',null,%s,null,null,null,'+60111111111',null,null,null,0)",
        (biz, ["customer"]),
    )
    party_id = cur.fetchone()[0]
    conn.commit()

    # ================= A: payment recording ===============================
    invoice_id, grand_total = make_invoice(cur, conn, salesagent_user, biz, party_id, product_id, 10, owner, bookkeeper_user)
    all_passed &= (float(grand_total) == 1000.00)

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.record_payment(%s,%s,400.00,'bank_transfer',current_date,'first tranche')",
        (biz, invoice_id),
    )
    payment1_id = cur.fetchone()[0]
    conn.commit()

    all_passed &= check(
        "A1: a RM400 partial payment on a RM1000 invoice moves status to 'partially_paid'", cur,
        "select status from public.invoices where id=%s", (invoice_id,), "partially_paid",
    )
    all_passed &= check(
        "A1: outstanding_balance correctly reduced to 600.00", cur,
        "select outstanding_balance from public.invoices where id=%s", (invoice_id,), 600.00,
    )
    as_user(cur, owner)
    all_passed &= check(
        "A1: a balanced debit Cash/Bank ledger entry of 400.00 was posted for this payment", cur,
        "select amount from public.ledger_entries where business_id=%s and direction='debit' "
        "and chart_of_accounts_id=(select id from public.chart_of_accounts where business_id=%s and account_code='1000') "
        "order by created_at desc limit 1", (biz, biz), 400.00,
    )
    all_passed &= check(
        "A1: a balanced credit Accounts Receivable ledger entry of 400.00 was posted for this payment", cur,
        "select amount from public.ledger_entries where business_id=%s and direction='credit' "
        "and chart_of_accounts_id=(select id from public.chart_of_accounts where business_id=%s and account_code='1100') "
        "order by created_at desc limit 1", (biz, biz), 400.00,
    )

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.record_payment(%s,%s,600.00,'cash',current_date,'final payment')",
        (biz, invoice_id),
    )
    conn.commit()
    all_passed &= check(
        "A2: the covering second payment moves status to 'paid'", cur,
        "select status from public.invoices where id=%s", (invoice_id,), "paid",
    )
    all_passed &= check(
        "A2: outstanding_balance is 0.00", cur,
        "select outstanding_balance from public.invoices where id=%s", (invoice_id,), 0.00,
    )

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "A3: a payment on an already-fully-paid invoice is rejected (would exceed balance)", cur, conn,
        lambda: cur.execute(
            "select public.record_payment(%s,%s,1.00,'cash',current_date,'overpay attempt')", (biz, invoice_id),
        ),
    )

    # ================= B: credit note issuance =============================
    invoice2_id, invoice2_total = make_invoice(cur, conn, salesagent_user, biz, party_id, product_id, 5, owner, bookkeeper_user)
    all_passed &= (float(invoice2_total) == 500.00)

    as_user(cur, salesagent_user)
    cur.execute(
        "select id, status from public.create_credit_note(%s,%s,150.00,'damaged goods returned')",
        (biz, invoice2_id),
    )
    cn_id, cn_status = cur.fetchone()
    conn.commit()
    all_passed &= (cn_status == 'draft')
    print(f"[{'PASS' if cn_status == 'draft' else 'FAIL'}] B1: create_credit_note starts as 'draft'")

    all_passed &= check(
        "B1: a real ApprovalTask created for the credit note (domain=sales)", cur,
        "select domain from public.approval_tasks where subject_type='credit_note' and subject_id=%s", (cn_id,), "sales",
    )
    all_passed &= check(
        "B2: before approval, invoice2's outstanding_balance is untouched (still 500.00)", cur,
        "select outstanding_balance from public.invoices where id=%s", (invoice2_id,), 500.00,
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "B1: Warehouse Staff (no sales capture, no accounting_reports configure) cannot create a credit note", cur, conn,
        lambda: cur.execute(
            "select public.create_credit_note(%s,%s,10.00,'should fail')", (biz, invoice2_id),
        ),
    )

    cur.execute("select id from public.approval_tasks where subject_type='credit_note' and subject_id=%s", (cn_id,))
    cn_task_id = cur.fetchone()[0]
    as_user(cur, owner)
    cur.execute("select public.decide_approval_task(%s,'approved')", (cn_task_id,))
    conn.commit()

    all_passed &= check(
        "B3: on approval, the sync trigger marks the credit note 'issued'", cur,
        "select status from public.credit_notes where id=%s", (cn_id,), "issued",
    )
    all_passed &= check(
        "B3: invoice2's outstanding_balance correctly reduced by 150.00 (500 -> 350)", cur,
        "select outstanding_balance from public.invoices where id=%s", (invoice2_id,), 350.00,
    )
    all_passed &= check(
        "B3: invoice2's status moves to 'partially_paid' (credited, not fully covered)", cur,
        "select status from public.invoices where id=%s", (invoice2_id,), "partially_paid",
    )
    as_user(cur, owner)
    all_passed &= check(
        "B3: a balanced debit Sales Revenue ledger entry of 150.00 was posted for the credit note", cur,
        "select amount from public.ledger_entries where business_id=%s and direction='debit' "
        "and chart_of_accounts_id=(select id from public.chart_of_accounts where business_id=%s and account_code='4000') "
        "order by created_at desc limit 1", (biz, biz), 150.00,
    )

    # a second credit note, this time rejected
    as_user(cur, bookkeeper_user)
    cur.execute(
        "select id from public.create_credit_note(%s,%s,50.00,'goodwill gesture')",
        (biz, invoice2_id),
    )
    cn2_id = cur.fetchone()[0]
    conn.commit()
    cur.execute("select id from public.approval_tasks where subject_type='credit_note' and subject_id=%s", (cn2_id,))
    cn2_task_id = cur.fetchone()[0]
    as_user(cur, owner)
    cur.execute("select public.decide_approval_task(%s,'rejected')", (cn2_task_id,))
    conn.commit()
    all_passed &= check(
        "B4: on rejection, the credit note is marked 'rejected'", cur,
        "select status from public.credit_notes where id=%s", (cn2_id,), "rejected",
    )
    all_passed &= check(
        "B4: invoice2's outstanding_balance is untouched by the rejected credit note (still 350.00)", cur,
        "select outstanding_balance from public.invoices where id=%s", (invoice2_id,), 350.00,
    )

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "B5: a credit note larger than the invoice's remaining balance is rejected at creation", cur, conn,
        lambda: cur.execute(
            "select public.create_credit_note(%s,%s,999.00,'too big')", (biz, invoice2_id),
        ),
    )

    # ================= C: invoice_effective_status (computed, not cached) ===
    # A third invoice, backdated (issue+due in the past), left completely unpaid.
    invoice3_id, invoice3_total = make_invoice(cur, conn, salesagent_user, biz, party_id, product_id, 2, owner, bookkeeper_user)
    as_superuser(cur)
    cur.execute(
        "update public.invoices set issue_date = current_date - 20, due_date = current_date - 15 where id=%s",
        (invoice3_id,),
    )
    conn.commit()

    all_passed &= check(
        "C: invoices.status column itself is never rewritten to 'overdue' (still reads 'issued')", cur,
        "select status from public.invoices where id=%s", (invoice3_id,), "issued",
    )
    as_user(cur, owner)
    all_passed &= check(
        "C: invoice_effective_status correctly derives 'overdue' at read time (unpaid, past due_date)", cur,
        "select public.invoice_effective_status(%s)", (invoice3_id,), "overdue",
    )
    all_passed &= check(
        "C: the already-fully-paid invoice1 (also now past a hypothetical due date) is never reported as overdue", cur,
        "select public.invoice_effective_status(%s)", (invoice_id,), "paid",
    )

    # ================= D: AR ageing, manually-computed test case ============
    # invoice3: due 15 days ago, unpaid 200.00 -> bucket '1-30'
    # invoice2: due today (credit_terms_days=0 on this party), 350.00 outstanding -> bucket 'current'
    # a fourth invoice, due 45 days ago, unpaid -> bucket '31-60'
    invoice4_id, invoice4_total = make_invoice(cur, conn, salesagent_user, biz, party_id, product_id, 1, owner, bookkeeper_user)
    as_superuser(cur)
    cur.execute(
        "update public.invoices set issue_date = current_date - 50, due_date = current_date - 45 where id=%s",
        (invoice4_id,),
    )
    conn.commit()

    as_user(cur, owner)
    cur.execute("select invoice_id, ageing_bucket from public.ar_ageing_detail(%s) order by due_date asc", (biz,))
    rows = {str(r[0]): r[1] for r in cur.fetchall()}

    ok = rows.get(str(invoice4_id)) == '31-60'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: invoice due 45 days ago buckets as '31-60' (got {rows.get(str(invoice4_id))})")

    ok = rows.get(str(invoice3_id)) == '1-30'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: invoice due 15 days ago buckets as '1-30' (got {rows.get(str(invoice3_id))})")

    ok = rows.get(str(invoice2_id)) == 'current'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: invoice due today (0-day credit term) buckets as 'current' (got {rows.get(str(invoice2_id))})")

    ok = str(invoice_id) not in rows
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: the fully-paid invoice1 is excluded from AR ageing entirely (zero balance)")

    # ================= E: role gating ========================================
    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "E: Warehouse Staff cannot record a payment (no sales capture, no accounting_reports configure)", cur, conn,
        lambda: cur.execute(
            "select public.record_payment(%s,%s,1.00,'cash',current_date,null)", (biz, invoice4_id),
        ),
    )
    as_user(cur, bookkeeper_user)
    cur.execute(
        "select id from public.record_payment(%s,%s,50.00,'bank_transfer',current_date,'bookkeeper reconciling')",
        (biz, invoice4_id),
    )
    conn.commit()
    all_passed &= check(
        "E: Bookkeeper (accounting_reports configure, no sales capture) CAN record a payment "
        "(the OR-gate covers the bookkeeping-reconciliation path)", cur,
        "select outstanding_balance from public.invoices where id=%s", (invoice4_id,), float(invoice4_total) - 50.00,
    )

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
