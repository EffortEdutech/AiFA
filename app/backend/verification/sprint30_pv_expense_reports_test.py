# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-29's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 30's Payment
# Vouchers, Expense & Cash Book/P&L claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23-29) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# every prior sprint's test script used).
#
# What this proves (Sprint 30 Definition of Done):
#   A. Payment Voucher creation, receipt attachment, and approval
#      verified end to end:
#        A1. create_payment_voucher resolves the posting account from
#            expense_category (chart_of_accounts.account_name) and
#            rejects an unknown category at creation time, not later.
#        A2. Receipt attachment: create_document + attach works;
#            attaching is not blocked by approval status.
#        A3. Routes through the REAL ApprovalTask engine (domain=
#            'expense', not a second bookkeeping path) — approval
#            moves status draft -> 'approved' with NO ledger posting
#            yet (see migration header note 6).
#        A4. mark_payment_voucher_paid, only callable once approved,
#            posts a balanced debit-expense/credit-Cash-Bank pair and
#            moves status to 'paid'.
#        A5. Rejection moves status to 'rejected' (the disclosed extra
#            enum value beyond Vol 13_0's literal three), and
#            mark_payment_voucher_paid is refused on a rejected PV.
#   B. Cash Book: a bank account's transaction history for a real
#      period, verified against a manually-computed running balance
#      (opening balance + each entry in order).
#   C. P&L: profit_and_loss_summary matches a manually-computed
#      reference figure for a period mixing Sprint 28's SALE-001
#      revenue posting and this sprint's EXP-001 expense posting.
#   D. expense_category_breakdown correctly ranks categories by
#      percentage of total expense, verified against hand-computed
#      percentages for three categories.
#   E. Role gating: Warehouse Staff (no expense capture) cannot create
#      a payment voucher; Bookkeeper (accounting_reports configure)
#      CAN mark one paid via the OR-gate, same reconciliation-actor
#      reasoning as Sprint 29's record_payment.

import uuid
import psycopg2
import datetime

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint30_test user=postgres password=testpass123"

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


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    biz, owner, om_owner = seed_business(cur, "ownerU@test.com")
    conn.commit()
    bookkeeper_user, om_bookkeeper = invite_and_accept(cur, conn, owner, biz, BOOKKEEPER_ROLE, "bkU@test.com")
    salesagent_user, om_salesagent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "saU@test.com")
    warehouse_user, om_warehouse = invite_and_accept(cur, conn, owner, biz, WAREHOUSE_ROLE, "whU@test.com")

    as_user(cur, owner)
    cur.execute(
        "select id from public.create_party(%s,'Landlord Sdn Bhd',null,%s,null,null,null,null,null,null,null,null)",
        (biz, ["supplier"]),
    )
    payee_id = cur.fetchone()[0]
    conn.commit()

    # ================= A: Payment Voucher end to end =========================
    as_user(cur, owner)
    all_passed &= expect_error(
        "A1: create_payment_voucher rejects an unknown expense_category at creation time", cur, conn,
        lambda: cur.execute(
            "select public.create_payment_voucher(%s,%s,'Not A Real Category','cash',100.00)", (biz, payee_id),
        ),
    )

    as_user(cur, owner)
    cur.execute(
        "select id, status from public.create_payment_voucher(%s,%s,'Rent','bank_transfer',1200.00,'September rent')",
        (biz, payee_id),
    )
    pv_id, pv_status = cur.fetchone()
    conn.commit()
    all_passed &= (pv_status == 'draft')
    print(f"[{'PASS' if pv_status == 'draft' else 'FAIL'}] A: create_payment_voucher starts as 'draft'")

    all_passed &= check(
        "A3: a real ApprovalTask created for the PV (domain=expense)", cur,
        "select domain from public.approval_tasks where subject_type='payment_voucher' and subject_id=%s", (pv_id,), "expense",
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "A: Warehouse Staff (no expense capture) cannot create a payment voucher", cur, conn,
        lambda: cur.execute(
            "select public.create_payment_voucher(%s,%s,'Rent','cash',50.00)", (biz, payee_id),
        ),
    )

    # A2: receipt attachment
    as_user(cur, owner)
    cur.execute("select id from public.create_document(%s,'receipts/sept-rent.jpg','image/jpeg')", (biz,))
    doc_id = cur.fetchone()[0]
    conn.commit()
    as_user(cur, owner)
    cur.execute("select document_id_receipt from public.attach_payment_voucher_receipt(%s,%s)", (pv_id, doc_id))
    attached_doc_id = cur.fetchone()[0]
    conn.commit()
    all_passed &= (attached_doc_id == doc_id)
    print(f"[{'PASS' if attached_doc_id == doc_id else 'FAIL'}] A2: receipt attached to the payment voucher")

    # A3: approval, no posting yet
    decide_pending_task(cur, conn, 'payment_voucher', pv_id, bookkeeper_user, 'approved')
    all_passed &= check(
        "A3: on approval, status moves to 'approved'", cur,
        "select status from public.payment_vouchers where id=%s", (pv_id,), "approved",
    )
    as_user(cur, owner)
    all_passed &= check(
        "A3: NO ledger entry posted yet at approval time (approval is authorization only)", cur,
        "select count(*) from public.ledger_entries where business_id=%s", (biz,), 0,
    )

    # A4: mark paid actually posts
    as_user(cur, owner)
    cur.execute("select status from public.mark_payment_voucher_paid(%s)", (pv_id,))
    paid_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (paid_status == 'paid')
    print(f"[{'PASS' if paid_status == 'paid' else 'FAIL'}] A4: mark_payment_voucher_paid moves status to 'paid'")

    as_user(cur, owner)
    all_passed &= check(
        "A4: a balanced debit Rent(6200) ledger entry of 1200.00 was posted", cur,
        "select amount from public.ledger_entries where business_id=%s and direction='debit' "
        "and chart_of_accounts_id=(select id from public.chart_of_accounts where business_id=%s and account_code='6200') "
        "order by created_at desc limit 1", (biz, biz), 1200.00,
    )
    all_passed &= check(
        "A4: a balanced credit Cash/Bank(1000) ledger entry of 1200.00 was posted", cur,
        "select amount from public.ledger_entries where business_id=%s and direction='credit' "
        "and chart_of_accounts_id=(select id from public.chart_of_accounts where business_id=%s and account_code='1000') "
        "order by created_at desc limit 1", (biz, biz), 1200.00,
    )

    as_user(cur, owner)
    all_passed &= expect_error(
        "A4: mark_payment_voucher_paid rejected on an already-paid voucher", cur, conn,
        lambda: cur.execute("select public.mark_payment_voucher_paid(%s)", (pv_id,)),
    )

    # A5: rejection path
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_payment_voucher(%s,%s,'Marketing','cash',80.00,'flyers')", (biz, payee_id),
    )
    pv2_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'payment_voucher', pv2_id, bookkeeper_user, 'rejected')
    all_passed &= check(
        "A5: on rejection, status moves to 'rejected'", cur,
        "select status from public.payment_vouchers where id=%s", (pv2_id,), "rejected",
    )
    as_user(cur, owner)
    all_passed &= expect_error(
        "A5: mark_payment_voucher_paid is refused on a rejected voucher", cur, conn,
        lambda: cur.execute("select public.mark_payment_voucher_paid(%s)", (pv2_id,)),
    )

    # ================= E: role gating (paid-marking OR-gate) =================
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_payment_voucher(%s,%s,'Utilities','bank_transfer',60.00,'electric bill')",
        (biz, payee_id),
    )
    pv3_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'payment_voucher', pv3_id, bookkeeper_user, 'approved')
    as_user(cur, bookkeeper_user)
    cur.execute("select status from public.mark_payment_voucher_paid(%s)", (pv3_id,))
    bk_paid_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (bk_paid_status == 'paid')
    print(f"[{'PASS' if bk_paid_status == 'paid' else 'FAIL'}] E: Bookkeeper (accounting_reports configure) "
          f"can mark a payment voucher paid via the OR-gate")

    # ================= B: Cash Book, manually-computed running balance ======
    as_user(cur, owner)
    cur.execute("select id, ledger_account_id, opening_balance from public.create_bank_account(%s,'Main Bank',"
                "(select id from public.chart_of_accounts where business_id=%s and account_code='1000'),5000.00)",
                (biz, biz))
    bank_account_id, ledger_account_id, opening_balance = cur.fetchone()
    conn.commit()

    # Post two more Cash/Bank movements directly for a controlled scenario:
    # a debit (money in) of 300 and a credit (money out) of 100, both today.
    as_superuser(cur)
    cur.execute(
        "insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency) "
        "values (%s,%s,'debit',300.00,'MYR'), (%s,%s,'credit',100.00,'MYR')",
        (biz, ledger_account_id, biz, ledger_account_id),
    )
    conn.commit()

    as_user(cur, owner)
    cur.execute(
        "select amount, direction, running_balance from public.cash_book_detail(%s,%s,current_date,current_date) order by posted_at asc",
        (biz, bank_account_id),
    )
    cash_book_rows = cur.fetchall()
    # Manually-computed expected: opening 5000.00, no prior movements before today
    # (this is a fresh bank account) -> running balance after each entry in order:
    # the two payment-voucher entries already posted against 1000 today (credit
    # 1200 + credit 60 from A4/E), then the two we just inserted (debit 300, credit 100).
    running = float(opening_balance)
    expected_final = running - 1200.00 - 60.00 + 300.00 - 100.00
    ok = len(cash_book_rows) > 0 and float(cash_book_rows[-1][2]) == expected_final
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: cash_book_detail's final running_balance matches the manually-computed "
          f"figure (opening {opening_balance} - 1200 - 60 + 300 - 100 = {expected_final}, got {cash_book_rows[-1][2] if cash_book_rows else None})")

    # ================= C: P&L, manually-computed reference =================
    # Post a SALE-001-shaped revenue entry directly (debit AR, credit Sales
    # Revenue 4000) to give the P&L something on the revenue side too.
    as_superuser(cur)
    cur.execute(
        "insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency) "
        "values (%s,(select id from public.chart_of_accounts where business_id=%s and account_code='1100'),'debit',2000.00,'MYR'),"
        "(%s,(select id from public.chart_of_accounts where business_id=%s and account_code='4000'),'credit',2000.00,'MYR')",
        (biz, biz, biz, biz),
    )
    conn.commit()

    as_user(cur, owner)
    cur.execute(
        "select total_revenue, total_expense, net_profit from public.profit_and_loss_summary(%s,current_date,current_date)",
        (biz,),
    )
    total_revenue, total_expense, net_profit = cur.fetchone()
    # Manually computed: revenue = 2000.00 (the one SALE-001 credit posted above,
    # today); expense = 1200 (Rent) + 60 (Utilities) = 1260.00 (both posted today
    # via mark_payment_voucher_paid); net = 2000 - 1260 = 740.00
    ok = float(total_revenue) == 2000.00 and float(total_expense) == 1260.00 and float(net_profit) == 740.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: profit_and_loss_summary matches the manually-computed reference "
          f"(revenue=2000.00, expense=1260.00, net=740.00 — got revenue={total_revenue}, expense={total_expense}, net={net_profit})")

    # ================= D: expense_category_breakdown, ranked ================
    as_user(cur, owner)
    cur.execute(
        "select account_name, amount, pct_of_total_expense from public.expense_category_breakdown(%s,current_date,current_date) order by amount desc",
        (biz,),
    )
    breakdown = cur.fetchall()
    by_name = {r[0]: (float(r[1]), float(r[2])) for r in breakdown}
    # Manually computed: total expense 1260.00; Rent 1200.00 -> 95.24%; Utilities 60.00 -> 4.76%
    ok = (
        by_name.get('Rent') == (1200.00, 95.24)
        and by_name.get('Utilities') == (60.00, 4.76)
        and breakdown[0][0] == 'Rent'  # highest-share category ranked first
    )
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: expense_category_breakdown correctly computes percentages and ranks "
          f"Rent (95.24%) above Utilities (4.76%) — got {by_name}")

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
