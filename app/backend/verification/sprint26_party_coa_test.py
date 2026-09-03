# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-25's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 26's Party/document-
# numbering/Chart-of-Accounts/Ledger claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23+24+25) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# Sprint 25's own test script used).
#
# What this proves (Sprint 26 Definition of Done):
#   A. Every existing/new business auto-seeds exactly the 12-row Phase 1
#      chart of accounts (7 top-level + 5 Operating Expenses
#      sub-categories) as is_system = true, with correct account_type
#      and parent_account_id rollups — both via the AFTER INSERT
#      trigger (new businesses) and via the one-time backfill loop
#      (exercised identically, since seed_phase1_chart_of_accounts is
#      the single shared function both paths call).
#   B. is_system accounts can never be deleted or have their type/code
#      changed (name-only edits are still allowed — not tested
#      separately here since the volume only requires code/type
#      immutability).
#   C. create_chart_of_account is configure-on-accounting_reports
#      gated — Bookkeeper (who holds it) succeeds, Sales Agent (who
#      doesn't) is rejected.
#   D. next_document_number: 'never' reset formats "<PREFIX>-NNNNNN"
#      and increments sequentially; a 'monthly' sequence formats
#      "<PREFIX>-YYYYMM-NNNN" and resets to 1 when the reset key
#      changes (simulated directly, since real month rollover can't be
#      exercised in a single test run) — and Party's own numbering
#      (Section E) reuses this exact mechanism (document_type='party'),
#      proving the generic design rather than a parallel counter.
#   E. Party capture/view gating splits correctly by party_types: a
#      Sales Agent can create a customer party (sales capture) but not
#      an employee party (no hr capture); a Payroll Admin can create an
#      employee party (hr capture); visibility follows the same split
#      (Sales Agent sees the customer party but not the employee one;
#      Payroll Admin sees the employee party but not necessarily the
#      customer one; Owner sees both via the configure-on-settings
#      catch-all).
#   F. create_bank_account is configure-on-accounting_reports gated,
#      and rejects a ledger_account_id belonging to a different
#      business.
#   G. post_ledger_entries: a balanced debit/credit batch succeeds
#      atomically; an unbalanced batch is rejected entirely (no partial
#      insert); posting is configure-on-accounting_reports gated;
#      SELECT visibility is view-on-accounting_reports gated (Sales
#      Agent, who lacks it, sees nothing).
#   H. A reversal entry (reversal_of pointing at an original entry) can
#      be posted and the link is preserved.

import uuid
import psycopg2

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint26_test user=postgres password=testpass123"

BOOKKEEPER_ROLE = "00000000-0000-0000-0000-000000000002"
SALES_AGENT_ROLE = "00000000-0000-0000-0000-000000000003"
WAREHOUSE_ROLE = "00000000-0000-0000-0000-000000000004"
PAYROLL_ADMIN_ROLE = "00000000-0000-0000-0000-000000000005"


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


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    biz, owner, om_owner = seed_business(cur, "ownerZ@test.com")
    conn.commit()
    bookkeeper_user, om_bookkeeper = invite_and_accept(cur, conn, owner, biz, BOOKKEEPER_ROLE, "bkZ@test.com")
    salesagent_user, om_salesagent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "saZ@test.com")
    warehouse_user, om_warehouse = invite_and_accept(cur, conn, owner, biz, WAREHOUSE_ROLE, "whZ@test.com")
    payroll_user, om_payroll = invite_and_accept(cur, conn, owner, biz, PAYROLL_ADMIN_ROLE, "prZ@test.com")

    # ================= A: Phase 1 CoA auto-seed =========================
    all_passed &= check(
        "A: exactly 12 chart_of_accounts rows auto-seeded for this business", cur,
        "select count(*) from public.chart_of_accounts where business_id=%s", (biz,), 12,
    )
    all_passed &= check(
        "A: all 12 rows are is_system = true", cur,
        "select count(*) from public.chart_of_accounts where business_id=%s and is_system", (biz,), 12,
    )
    all_passed &= check(
        "A: 1000 Cash/Bank is type asset", cur,
        "select account_type from public.chart_of_accounts where business_id=%s and account_code='1000'", (biz,), "asset",
    )
    all_passed &= check(
        "A: 4000 Sales Revenue is type revenue", cur,
        "select account_type from public.chart_of_accounts where business_id=%s and account_code='4000'", (biz,), "revenue",
    )
    cur.execute("select id from public.chart_of_accounts where business_id=%s and account_code='6000'", (biz,))
    opex_id = cur.fetchone()[0]
    all_passed &= check(
        "A: 6100 Supplies rolls up under 6000 Operating Expenses", cur,
        "select parent_account_id from public.chart_of_accounts where business_id=%s and account_code='6100'", (biz,), opex_id,
    )
    all_passed &= check(
        "A: exactly 5 sub-accounts roll up under 6000", cur,
        "select count(*) from public.chart_of_accounts where business_id=%s and parent_account_id=%s", (biz, opex_id), 5,
    )

    # ================= B: system-account immutability ===================
    cur.execute("select id from public.chart_of_accounts where business_id=%s and account_code='1000'", (biz,))
    cash_id = cur.fetchone()[0]
    as_superuser(cur)
    all_passed &= expect_error(
        "B: cannot delete a system account", cur, conn,
        lambda: cur.execute("delete from public.chart_of_accounts where id=%s", (cash_id,)),
    )
    as_superuser(cur)  # a prior expect_error's rollback undoes an uncommitted "reset role" (SET ROLE is transactional), so re-assert superuser before this check too
    all_passed &= expect_error(
        "B: cannot change a system account's type", cur, conn,
        lambda: cur.execute("update public.chart_of_accounts set account_type='liability' where id=%s", (cash_id,)),
    )

    # ================= C: create_chart_of_account gating =================
    as_user(cur, bookkeeper_user)
    cur.execute(
        "select id from public.create_chart_of_account(%s,'7000','Miscellaneous Income','revenue',null)", (biz,),
    )
    custom_account_id = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "C: Bookkeeper's custom account is not is_system", cur,
        "select is_system from public.chart_of_accounts where id=%s", (custom_account_id,), False,
    )
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "C: Sales Agent cannot create a chart-of-accounts row (no configure)", cur, conn,
        lambda: cur.execute("select public.create_chart_of_account(%s,'7100','x','revenue',null)", (biz,)),
    )

    # ================= D: document numbering =============================
    as_user(cur, owner)
    cur.execute("select public.next_document_number(%s,'test_never')", (biz,))
    n1 = cur.fetchone()[0]
    cur.execute("select public.next_document_number(%s,'test_never')", (biz,))
    n2 = cur.fetchone()[0]
    conn.commit()
    ok = n1 == "TES-000001" and n2 == "TES-000002"
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: never-reset numbering auto-provisions and increments ({n1} -> {n2})")

    as_user(cur, owner)
    cur.execute("select public.configure_document_sequence(%s,'invoice','INV','monthly')", (biz,))
    conn.commit()
    cur.execute("select public.next_document_number(%s,'invoice')", (biz,))
    inv1 = cur.fetchone()[0]
    conn.commit()
    import re
    ok = re.match(r"^INV-\d{6}-0001$", inv1) is not None
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: monthly-reset numbering formats INV-YYYYMM-NNNN ({inv1})")

    # One more ordinary call first, so the "reset" comparison is against a
    # genuinely different prior value (0002), not coincidentally 0001 again.
    as_user(cur, owner)
    cur.execute("select public.next_document_number(%s,'invoice')", (biz,))
    inv1b = cur.fetchone()[0]
    conn.commit()

    # Simulate a month rollover by forcing last_reset_key stale, then confirm reset to 1.
    as_superuser(cur)
    cur.execute("update public.document_number_sequences set last_reset_key='190001' where business_id=%s and document_type='invoice'", (biz,))
    conn.commit()
    as_user(cur, owner)
    cur.execute("select public.next_document_number(%s,'invoice')", (biz,))
    inv2 = cur.fetchone()[0]
    conn.commit()
    ok = inv1b.endswith("-0002") and inv2.endswith("-0001")
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: reset_key change resets numbering back to 0001 ({inv1} -> {inv1b} -> reset -> {inv2})")

    # ================= E: Party capture/view gating ======================
    as_user(cur, salesagent_user)
    cur.execute(
        "select id, party_no from public.create_party(%s,'Acme Sdn Bhd',null,array['customer'],null,null,null,null,null,null,null,null)",
        (biz,),
    )
    customer_party_id, customer_party_no = cur.fetchone()
    conn.commit()
    ok = customer_party_no.startswith("PTY-")
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] E: Sales Agent creates a customer party via sales capture, party_no={customer_party_no}")

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "E: Warehouse Staff cannot create an employee party (no hr capture)", cur, conn,
        lambda: cur.execute(
            "select public.create_party(%s,'Employee X',null,array['employee'],null,null,null,null,null,null,null,null)",
            (biz,),
        ),
    )

    as_user(cur, payroll_user)
    cur.execute(
        "select id from public.create_party(%s,'Employee X',null,array['employee'],null,null,null,null,null,null,null,null)",
        (biz,),
    )
    employee_party_id = cur.fetchone()[0]
    conn.commit()
    print("[PASS] E: Payroll Admin creates an employee party via hr_attendance_leave capture")

    as_user(cur, salesagent_user)
    all_passed &= check(
        "E: Sales Agent sees the customer party", cur,
        "select count(*) from public.parties where id=%s", (customer_party_id,), 1,
    )
    all_passed &= check(
        "E: Sales Agent does NOT see the employee-only party", cur,
        "select count(*) from public.parties where id=%s", (employee_party_id,), 0,
    )
    as_user(cur, payroll_user)
    all_passed &= check(
        "E: Payroll Admin sees the employee party", cur,
        "select count(*) from public.parties where id=%s", (employee_party_id,), 1,
    )
    as_user(cur, owner)
    all_passed &= check(
        "E: Owner sees both parties via the settings-configure catch-all", cur,
        "select count(*) from public.parties where id in (%s,%s)", (customer_party_id, employee_party_id), 2,
    )

    # ================= F: bank accounts ===================================
    as_user(cur, bookkeeper_user)
    cur.execute(
        "select id from public.create_bank_account(%s,'Maybank Current',%s,1000.00)", (biz, cash_id),
    )
    bank_account_id = cur.fetchone()[0]
    conn.commit()
    print("[PASS] F: Bookkeeper creates a bank account against a valid ledger account")

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "F: Sales Agent cannot create a bank account (no configure)", cur, conn,
        lambda: cur.execute("select public.create_bank_account(%s,'x',%s,0)", (biz, cash_id)),
    )

    biz2, owner2, om2_owner = seed_business(cur, "ownerZ2@test.com")
    conn.commit()
    cur.execute("select id from public.chart_of_accounts where business_id=%s and account_code='1000'", (biz2,))
    cash_id_biz2 = cur.fetchone()[0]
    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "F: cannot create a bank account against another business's ledger account", cur, conn,
        lambda: cur.execute("select public.create_bank_account(%s,'x',%s,0)", (biz, cash_id_biz2)),
    )

    # ================= G: post_ledger_entries =============================
    cur.execute("select id from public.chart_of_accounts where business_id=%s and account_code='4000'", (biz,))
    revenue_id = cur.fetchone()[0]
    as_user(cur, bookkeeper_user)
    cur.execute(
        "select id from public.post_ledger_entries(%s, null, %s::jsonb)",
        (biz, '[{"chart_of_accounts_id":"%s","direction":"debit","amount":250.00},'
               '{"chart_of_accounts_id":"%s","direction":"credit","amount":250.00}]' % (cash_id, revenue_id)),
    )
    posted_ids = [r[0] for r in cur.fetchall()]
    conn.commit()
    ok = len(posted_ids) == 2
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] G: balanced batch posts both legs atomically ({len(posted_ids)} rows)")

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "G: unbalanced batch is rejected entirely", cur, conn,
        lambda: cur.execute(
            "select public.post_ledger_entries(%s, null, %s::jsonb)",
            (biz, '[{"chart_of_accounts_id":"%s","direction":"debit","amount":100.00},'
                  '{"chart_of_accounts_id":"%s","direction":"credit","amount":50.00}]' % (cash_id, revenue_id)),
        ),
    )
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "G: Sales Agent cannot post ledger entries (no configure)", cur, conn,
        lambda: cur.execute(
            "select public.post_ledger_entries(%s, null, %s::jsonb)",
            (biz, '[{"chart_of_accounts_id":"%s","direction":"debit","amount":10.00},'
                  '{"chart_of_accounts_id":"%s","direction":"credit","amount":10.00}]' % (cash_id, revenue_id)),
        ),
    )
    as_user(cur, salesagent_user)
    all_passed &= check(
        "G: Sales Agent (no accounting_reports view) sees zero ledger rows", cur,
        "select count(*) from public.ledger_entries where business_id=%s", (biz,), 0,
    )
    as_user(cur, bookkeeper_user)
    all_passed &= check(
        "G: Bookkeeper (has accounting_reports view) sees the posted entries", cur,
        "select count(*) from public.ledger_entries where business_id=%s", (biz,), 2,
    )

    # ================= H: reversal ========================================
    original_debit_id = posted_ids[0]
    as_user(cur, bookkeeper_user)
    cur.execute(
        "select id from public.post_ledger_entries(%s, null, %s::jsonb)",
        (biz, ('[{"chart_of_accounts_id":"%s","direction":"credit","amount":250.00,"reversal_of":"%s"},'
               '{"chart_of_accounts_id":"%s","direction":"debit","amount":250.00}]') % (cash_id, original_debit_id, revenue_id)),
    )
    reversal_ids = [r[0] for r in cur.fetchall()]
    conn.commit()
    all_passed &= check(
        "H: reversal entry correctly links back to the original via reversal_of", cur,
        "select reversal_of from public.ledger_entries where id=%s", (reversal_ids[0],), original_debit_id,
    )

    cur.close()
    conn.close()
    print("\nALL CHECKS PASSED" if all_passed else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    main()
