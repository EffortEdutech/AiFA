# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-31's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 32's Full Accounting
# Reports claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23-31) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# every prior sprint's test script used).
#
# What this proves (Sprint 32 Definition of Done):
#   A. Trial Balance nets to zero for a real test business's data —
#      real postings across Sprint 28 (sales), Sprint 29 (payment),
#      and Sprint 30 (payment voucher) are all exercised first, then
#      trial_balance's own sum(total_debit) == sum(total_credit)
#      identity is checked, plus specific account balances verified
#      against hand computation.
#   B. Balance Sheet totals match a manually-computed reference for
#      the same period (and the deliberate absence of a retained-
#      earnings roll-up — see migration header note 2 — is verified
#      directly: assets do NOT equal liabilities+equity once revenue/
#      expense activity exists).
#   C. General Ledger export matches a manually-computed running
#      balance, including a backdated entry correctly folded into the
#      opening balance.
#   D. Bank Reconciliation correctly matches statement lines against
#      ledger entries through the full unmatched -> matched / ignored
#      workflow, including the data-integrity guards (wrong-account
#      match rejected, double-match rejected).
#   Plus: Stock report (Sprint 31 data), Tax report placeholder shape,
#   and role gating throughout (accounting_reports: view required).

import uuid
import psycopg2
import psycopg2.extras

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint32_test user=postgres password=testpass123"

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


def make_invoice(cur, conn, salesagent_user, biz, party_id, product_id, quantity, owner_user):
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

    biz, owner, om_owner = seed_business(cur, "ownerX@test.com")
    conn.commit()
    bookkeeper_user, om_bookkeeper = invite_and_accept(cur, conn, owner, biz, BOOKKEEPER_ROLE, "bkX@test.com")
    salesagent_user, om_salesagent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "saX@test.com")
    warehouse_user, om_warehouse = invite_and_accept(cur, conn, owner, biz, WAREHOUSE_ROLE, "whX@test.com")

    # ------- fixtures --------------------------------------------------
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_type(%s,'Retail')", (biz,))
    pt_retail = cur.fetchone()[0]
    cur.execute("select id from public.create_product(%s,'SKU-X1','Reported Widget','pcs',6.00,'manual',true)", (biz,))
    product_id = cur.fetchone()[0]
    conn.commit()
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_list_entry(%s,%s,100.00,current_date - 1,null,null)", (product_id, pt_retail))
    conn.commit()
    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_party(%s,'Reporting Co',null,%s,null,null,null,'+60133333333',null,null,null,0)",
        (biz, ["customer"]),
    )
    customer_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_party(%s,'Landlord Sdn Bhd',null,%s,null,null,null,null,null,null,null,null)",
        (biz, ["supplier"]),
    )
    payee_id = cur.fetchone()[0]
    conn.commit()

    as_user(cur, owner)
    cur.execute("select id from public.create_warehouse(%s,'Main Warehouse')", (biz,))
    warehouse_id = cur.fetchone()[0]
    conn.commit()
    as_user(cur, warehouse_user)
    cur.execute("select public.record_opening_stock(%s,%s,%s,50,6.00)", (biz, product_id, warehouse_id))
    conn.commit()

    # ------- real postings across modules (sales, payment, expense) ----
    invoice_id, grand_total = make_invoice(cur, conn, salesagent_user, biz, customer_id, product_id, 10, owner)
    all_passed &= (float(grand_total) == 1000.00)  # 10 * 100.00

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.record_payment(%s,%s,600.00,'bank_transfer',current_date,'partial payment')",
        (biz, invoice_id),
    )
    conn.commit()

    as_user(cur, owner)
    cur.execute(
        "select id from public.create_payment_voucher(%s,%s,'Rent','bank_transfer',300.00,'monthly rent')",
        (biz, payee_id),
    )
    pv_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'payment_voucher', pv_id, bookkeeper_user, 'approved')
    as_user(cur, owner)
    cur.execute("select public.mark_payment_voucher_paid(%s)", (pv_id,))
    conn.commit()

    # Manually-tracked expected ledger state as of today:
    #   AR (1100):        debit 1000 (invoice) - credit 600 (payment)  = 400
    #   Sales Rev (4000):  credit 1000 (invoice)                        = -1000 (credit balance)
    #   Cash/Bank (1000):  debit 600 (payment) - credit 300 (PV paid)   = 300
    #   Rent (6200):       debit 300 (PV paid)                          = 300

    # ================= A: Trial Balance =====================================
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "A: Sales Agent (no accounting_reports view) cannot call trial_balance", cur, conn,
        lambda: cur.execute("select * from public.trial_balance(%s,current_date)", (biz,)),
    )

    as_user(cur, owner)
    cur.execute(
        "select account_code, total_debit, total_credit, balance from public.trial_balance(%s,current_date)", (biz,)
    )
    tb_rows = cur.fetchall()
    conn.commit()
    tb_by_code = {r[0]: (float(r[1]), float(r[2]), float(r[3])) for r in tb_rows}
    sum_debit = sum(float(r[1]) for r in tb_rows)
    sum_credit = sum(float(r[2]) for r in tb_rows)
    ok = abs(sum_debit - sum_credit) < 0.005
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: trial_balance nets to zero — "
          f"sum(total_debit)={sum_debit}, sum(total_credit)={sum_credit}")

    ok = (
        tb_by_code.get('1100', (None, None, None))[2] == 400.00
        and tb_by_code.get('4000', (None, None, None))[2] == -1000.00
        and tb_by_code.get('1000', (None, None, None))[2] == 300.00
        and tb_by_code.get('6200', (None, None, None))[2] == 300.00
    )
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: specific account balances match hand computation "
          f"(AR=400, Sales Rev=-1000, Cash/Bank=300, Rent=300) — got {tb_by_code}")

    # ================= B: Balance Sheet ======================================
    as_user(cur, owner)
    cur.execute("select total_assets, total_liabilities, total_equity from public.balance_sheet_summary(%s,current_date)", (biz,))
    total_assets, total_liabilities, total_equity = cur.fetchone()
    conn.commit()
    # Manually computed: assets = AR(400) + Cash/Bank(300) = 700; liabilities = 0; equity = 0
    ok = float(total_assets) == 700.00 and float(total_liabilities) == 0.00 and float(total_equity) == 0.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: balance_sheet_summary matches hand computation "
          f"(assets=700.00, liabilities=0.00, equity=0.00) — got assets={total_assets}, "
          f"liabilities={total_liabilities}, equity={total_equity}")

    ok = float(total_assets) != float(total_liabilities) + float(total_equity)
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: assets deliberately do NOT equal liabilities+equity "
          f"(no retained-earnings roll-up exists yet — see migration header note 2) — "
          f"{total_assets} != {total_liabilities} + {total_equity}")

    # ================= C: General Ledger export ==============================
    as_user(cur, owner)
    cur.execute("select id from public.chart_of_accounts where business_id=%s and account_code='1000'", (biz,))
    cash_account_id = cur.fetchone()[0]
    conn.commit()

    # Post a backdated entry (5 days ago) to prove the opening-balance
    # computation correctly folds in activity before date_from.
    as_superuser(cur)
    cur.execute(
        "insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_at) "
        "values (%s,%s,'debit',150.00,'MYR', now() - interval '5 days')",
        (biz, cash_account_id),
    )
    conn.commit()

    as_user(cur, owner)
    cur.execute(
        "select amount, direction, running_balance from public.general_ledger_detail(%s,%s,current_date,current_date) order by posted_at asc",
        (biz, cash_account_id),
    )
    gl_rows = cur.fetchall()
    conn.commit()
    # Opening balance as of today = the backdated 150 debit (5 days ago, before today's range).
    # Then today's own entries: debit 600 (payment), credit 300 (PV paid).
    # Expected final running balance = 150 + 600 - 300 = 450.
    ok = len(gl_rows) > 0 and float(gl_rows[-1][2]) == 450.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: general_ledger_detail's final running_balance matches hand "
          f"computation (backdated opening 150 + 600 - 300 = 450) — got {gl_rows[-1][2] if gl_rows else None}")

    # ================= D: Stock report =======================================
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "D: Sales Agent (no inventory view) cannot call stock_report", cur, conn,
        lambda: cur.execute("select * from public.stock_report(%s,%s)", (biz, warehouse_id)),
    )

    as_user(cur, owner)
    cur.execute("select quantity_on_hand, valuation from public.stock_report(%s,%s)", (biz, warehouse_id))
    stock_qty, stock_valuation = cur.fetchone()
    conn.commit()
    ok = float(stock_qty) == 50.00 and float(stock_valuation) == 300.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: stock_report shows quantity 50 and valuation 300.00 (50 * 6.00 default_cost)"
          f" — got quantity={stock_qty}, valuation={stock_valuation}")

    # ================= E: Tax report placeholder ==============================
    as_user(cur, owner)
    cur.execute(
        "select output_tax_sst, input_tax_sst, note from public.tax_report_placeholder(%s,current_date-30,current_date)",
        (biz,),
    )
    output_tax, input_tax, note = cur.fetchone()
    conn.commit()
    ok = output_tax is None and input_tax is None and note is not None and len(note) > 0
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] E: tax_report_placeholder returns null figures and an explanatory note "
          f"— got output_tax={output_tax}, input_tax={input_tax}, note={note!r}")

    # ================= F: Bank Reconciliation =================================
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_bank_account(%s,'Main Bank',%s,0)", (biz, cash_account_id)
    )
    bank_account_id = cur.fetchone()[0]
    conn.commit()

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "F: Warehouse Staff (no accounting_reports configure) cannot import bank statement lines", cur, conn,
        lambda: cur.execute(
            "select public.import_bank_statement_lines(%s,%s)",
            (bank_account_id, psycopg2.extras.Json([{"statement_date": "2026-09-01", "amount": 1}])),
        ),
    )

    as_user(cur, owner)
    cur.execute(
        "select id, amount, match_status from public.import_bank_statement_lines(%s,%s)",
        (bank_account_id, psycopg2.extras.Json([
            {"statement_date": "2026-09-01", "description": "Customer payment", "amount": 600.00},
            {"statement_date": "2026-09-01", "description": "Rent payment", "amount": -300.00},
            {"statement_date": "2026-09-01", "description": "Unrelated bank fee", "amount": -5.00},
        ])),
    )
    imported = cur.fetchall()
    conn.commit()
    ok = len(imported) == 3 and all(r[2] == 'unmatched' for r in imported)
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] F: import_bank_statement_lines inserts 3 lines, all starting 'unmatched'")

    line_by_amount = {float(r[1]): r[0] for r in imported}
    payment_line_id = line_by_amount[600.00]
    rent_line_id = line_by_amount[-300.00]
    fee_line_id = line_by_amount[-5.00]

    as_user(cur, owner)
    cur.execute(
        "select id from public.ledger_entries where business_id=%s and chart_of_accounts_id=%s "
        "and direction='debit' and amount=600.00 order by created_at desc limit 1", (biz, cash_account_id),
    )
    payment_ledger_entry_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.ledger_entries where business_id=%s and chart_of_accounts_id=%s "
        "and direction='credit' and amount=300.00 order by created_at desc limit 1", (biz, cash_account_id),
    )
    rent_ledger_entry_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.chart_of_accounts where business_id=%s and account_code='4000'", (biz,)
    )
    sales_revenue_account_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.ledger_entries where business_id=%s and chart_of_accounts_id=%s "
        "order by created_at desc limit 1", (biz, sales_revenue_account_id),
    )
    unrelated_ledger_entry_id = cur.fetchone()[0]
    conn.commit()

    as_user(cur, owner)
    all_passed &= expect_error(
        "F: match_bank_statement_line rejects a ledger entry from an unrelated chart-of-accounts row", cur, conn,
        lambda: cur.execute("select public.match_bank_statement_line(%s,%s)", (payment_line_id, unrelated_ledger_entry_id)),
    )

    as_user(cur, bookkeeper_user)
    cur.execute("select match_status from public.match_bank_statement_line(%s,%s)", (payment_line_id, payment_ledger_entry_id))
    match_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (match_status == 'matched')
    print(f"[{'PASS' if match_status == 'matched' else 'FAIL'}] F: Bookkeeper (accounting_reports configure) can match a statement line to its ledger entry")

    as_user(cur, owner)
    all_passed &= expect_error(
        "F: matching an already-matched ledger entry to a second statement line is rejected", cur, conn,
        lambda: cur.execute("select public.match_bank_statement_line(%s,%s)", (rent_line_id, payment_ledger_entry_id)),
    )
    all_passed &= expect_error(
        "F: re-matching an already-matched statement line is rejected", cur, conn,
        lambda: cur.execute("select public.match_bank_statement_line(%s,%s)", (payment_line_id, rent_ledger_entry_id)),
    )

    as_user(cur, owner)
    cur.execute("select match_status from public.match_bank_statement_line(%s,%s)", (rent_line_id, rent_ledger_entry_id))
    rent_match_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (rent_match_status == 'matched')

    as_user(cur, owner)
    cur.execute("select match_status from public.ignore_bank_statement_line(%s)", (fee_line_id,))
    fee_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (fee_status == 'ignored')
    print(f"[{'PASS' if fee_status == 'ignored' else 'FAIL'}] F: ignore_bank_statement_line moves the unrelated fee line to 'ignored'")

    as_user(cur, owner)
    all_passed &= expect_error(
        "F: ignore_bank_statement_line refused on an already-matched line", cur, conn,
        lambda: cur.execute("select public.ignore_bank_statement_line(%s)", (payment_line_id,)),
    )

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
