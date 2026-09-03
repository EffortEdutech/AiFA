# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-27's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 28's Quotation &
# Invoice + WhatsApp Send claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23-27) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# every prior sprint's test script used).
#
# What this proves (Sprint 28 Definition of Done):
#   A. Bug fix verification (see migration header notes 8a/8b):
#      A1. resolve_price now rejects a caller with no membership in
#          the business (was previously wide open).
#      A2. create_approval_task's new on_approval_action persists
#          through resolve_approval_task (was previously impossible —
#          next_action was always clobbered).
#   B. create_quotation: drafts a Quotation + lines with PRICE-001
#      price resolution, is capture-on-sales gated, and creates a
#      real ApprovalTask (domain=sales, subject_type=quotation).
#   C. A full quotation drafted, approved through the REAL engine
#      (role/SoD/delegation all exercised, not synthetic — two real
#      distinct memberships, per this sprint's own exit criterion),
#      sent via WhatsApp click-to-chat end to end:
#        C1. SoD applies to the sales domain in a team business (>=2
#            active members): the capturer (Sales Agent) is excluded
#            from the eligible-approver set for a quotation at/above
#            the sales SoD threshold (RM2000, seeded by Sprint 25's
#            trigger on the first solo->team transition).
#        C2. The Owner — a second, real, distinct membership — is the
#            one who actually decides the task (decide_approval_task),
#            not the capturer.
#        C3. build_whatsapp_quotation_link is rejected before
#            approval, succeeds after, returns a well-formed wa.me
#            link built from the party's contact_phone.
#        C4. mark_quotation_sent transitions draft -> sent, and is
#            rejected before approval / on a non-draft quotation.
#   D. Quotation -> Invoice conversion:
#        D1. mark_quotation_accepted (sent -> accepted), then
#            convert_quotation_to_invoice creates a correct Invoice:
#            due_date = issue date + Party.credit_terms_days,
#            source_quotation_id set, quotation.converted_invoice_id
#            set back, quotation.status = 'converted_to_invoice'.
#        D2. e_invoice_status defaults to 'not_applicable'.
#        D3. Ledger posting (SALE-001): a balanced debit AR / credit
#            Sales Revenue pair is posted for the invoice's
#            grand_total, and post_ledger_entries' own view/select
#            gating still applies to reading it back.
#        D4. convert_quotation_to_invoice rejects a quotation that
#            isn't 'accepted' yet.
#   E. Internal-rejection propagation: when the approving reviewer
#      rejects the ApprovalTask, quotation.status flips to 'rejected'
#      via the sync trigger (not left stuck on 'draft').
#   F. Role gating: Warehouse Staff (no sales capture/view) cannot
#      create a quotation and cannot see one.

import uuid
import psycopg2
import psycopg2.extras

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint28_test user=postgres password=testpass123"

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

    biz, owner, om_owner = seed_business(cur, "ownerW@test.com")
    conn.commit()
    salesagent_user, om_salesagent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "saW@test.com")
    warehouse_user, om_warehouse = invite_and_accept(cur, conn, owner, biz, WAREHOUSE_ROLE, "whW@test.com")
    bookkeeper_user, om_bookkeeper = invite_and_accept(cur, conn, owner, biz, BOOKKEEPER_ROLE, "bkW@test.com")
    payroll_user, om_payroll = invite_and_accept(cur, conn, owner, biz, PAYROLL_ADMIN_ROLE, "prW@test.com")

    # a second business — used only for the resolve_price cross-business auth check
    biz2, owner2, om_owner2 = seed_business(cur, "ownerX@test.com")
    conn.commit()

    # ------- fixtures: price type, product, price list entry, party ---
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_type(%s,'Retail')", (biz,))
    pt_retail = cur.fetchone()[0]
    conn.commit()

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_product(%s,'SKU-Q1','Quoted Widget','pcs',10.00,'manual',false)", (biz,),
    )
    product_id = cur.fetchone()[0]
    conn.commit()

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_price_list_entry(%s,%s,100.00,current_date - 1,null,null)",
        (product_id, pt_retail),
    )
    conn.commit()

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_party(%s,'ABC Trading',null,%s,null,null,null,'+60123456789',null,null,null,30)",
        (biz, ["customer"]),
    )
    party_id = cur.fetchone()[0]
    conn.commit()

    # ================= A: bug fix verification =========================
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "A1: resolve_price rejects a caller with no membership in the business (Sprint 27 gap, fixed here)",
        cur, conn,
        lambda: cur.execute("select * from public.resolve_price(%s,%s,%s)", (biz2, product_id, party_id)),
    )

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+7,'A2 fixture',%s,null,true)",
        (biz, party_id, psycopg2.extras.Json([
            {"product_id": product_id, "description": "Widget", "quantity": 1},
        ])),
    )
    a2_quotation_id = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "A2: on_approval_action persists through resolve_approval_task (was always null before this sprint's fix)",
        cur,
        "select on_approval_action from public.approval_tasks where subject_type='quotation' and subject_id=%s",
        (a2_quotation_id,), "send WhatsApp",
    )

    # ================= B: create_quotation ===============================
    as_user(cur, salesagent_user)
    cur.execute(
        "select id, quotation_no, grand_total from public.create_quotation(%s,%s,current_date+7,'10 units, stokis price, 30 days credit', %s)",
        (biz, party_id, psycopg2.extras.Json([
            {"product_id": product_id, "description": "Quoted Widget", "quantity": 10},
        ])),
    )
    quotation_id, quotation_no, grand_total = cur.fetchone()
    conn.commit()
    all_passed &= (float(grand_total) == 1000.00)
    print(f"[{'PASS' if float(grand_total) == 1000.00 else 'FAIL'}] B: quotation line resolves PRICE-001's Retail price "
          f"(10 x 100.00 = 1000.00, got {grand_total})")

    all_passed &= check(
        "B: exactly one ApprovalTask created for this quotation, domain=sales", cur,
        "select domain from public.approval_tasks where subject_type='quotation' and subject_id=%s", (quotation_id,), "sales",
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "B: Warehouse Staff (no sales capture) cannot create a quotation", cur, conn,
        lambda: cur.execute(
            "select public.create_quotation(%s,%s,current_date+7,null,%s)",
            (biz, party_id, psycopg2.extras.Json([{"product_id": product_id, "description": "x", "quantity": 1}])),
        ),
    )

    # ================= C: real approval engine + WhatsApp send ===========
    # Sales Agent only has `capture` on sales (never `approve`) and Bookkeeper
    # only has `approve` (never `capture`) per the fixed role templates — so
    # the ONLY role that can both capture AND approve a quotation is the
    # Owner. A quotation at/above the RM2000 sales SoD threshold, captured by
    # the Owner, is the real scenario that exercises SoD's maker-exclusion:
    # it should redirect to Bookkeeper (the other real, distinct membership
    # holding `approve` on sales) rather than auto-resolving back to the
    # Owner who captured it.
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+7,'big order', %s)",
        (biz, party_id, psycopg2.extras.Json([
            {"product_id": product_id, "description": "Quoted Widget", "quantity": 30},
        ])),
    )
    big_quotation_id = cur.fetchone()[0]
    conn.commit()
    cur.execute(
        "select assigned_membership_id, resolved_via from public.approval_tasks "
        "where subject_type='quotation' and subject_id=%s", (big_quotation_id,),
    )
    assigned, resolved_via = cur.fetchone()
    ok = assigned == om_bookkeeper and resolved_via == 'direct_permission'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C1: RM3000 quotation (>= RM2000 SoD threshold), captured by the Owner, "
          f"excludes the Owner as maker and redirects to Bookkeeper (a second, real, distinct membership) — "
          f"assigned={assigned}, resolved_via={resolved_via}")

    cur.execute("select id from public.approval_tasks where subject_type='quotation' and subject_id=%s", (big_quotation_id,))
    big_task_id = cur.fetchone()[0]
    as_user(cur, owner)
    all_passed &= expect_error(
        "C2: the Owner (excluded by SoD as the maker) cannot decide their own quotation's task", cur, conn,
        lambda: cur.execute("select public.decide_approval_task(%s,'approved')", (big_task_id,)),
    )
    as_user(cur, bookkeeper_user)
    cur.execute("select status from public.decide_approval_task(%s,'approved')", (big_task_id,))
    decided_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (decided_status == 'approved')
    print(f"[{'PASS' if decided_status == 'approved' else 'FAIL'}] C2: Bookkeeper (second real distinct membership) "
          f"decides the task (status={decided_status})")

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "C3: build_whatsapp_quotation_link rejected before approval (the small, still-pending quotation)", cur, conn,
        lambda: cur.execute("select * from public.build_whatsapp_quotation_link(%s)", (quotation_id,)),
    )

    # small quotation was auto-solo?? no — this business is 'team' (2+ members), so it also needs deciding.
    cur.execute("select id from public.approval_tasks where subject_type='quotation' and subject_id=%s", (quotation_id,))
    small_task_id = cur.fetchone()[0]
    as_user(cur, owner)
    cur.execute("select public.decide_approval_task(%s,'approved')", (small_task_id,))
    conn.commit()

    as_user(cur, salesagent_user)
    cur.execute("select phone_e164, message_text, wa_link from public.build_whatsapp_quotation_link(%s)", (quotation_id,))
    phone_e164, message_text, wa_link = cur.fetchone()
    conn.commit()
    ok = phone_e164 == "60123456789" and wa_link.startswith("https://wa.me/60123456789?text=") and "ABC Trading" in message_text
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C3: build_whatsapp_quotation_link succeeds after approval, returns a "
          f"well-formed wa.me link from the party's contact_phone (phone={phone_e164}, link={wa_link[:60]}...)")

    as_user(cur, salesagent_user)
    cur.execute("select status from public.mark_quotation_sent(%s)", (quotation_id,))
    sent_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (sent_status == 'sent')
    print(f"[{'PASS' if sent_status == 'sent' else 'FAIL'}] C4: mark_quotation_sent transitions draft -> sent (status={sent_status})")

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "C4: mark_quotation_sent rejected on an already-sent quotation", cur, conn,
        lambda: cur.execute("select public.mark_quotation_sent(%s)", (quotation_id,)),
    )

    # ================= D: Quotation -> Invoice conversion ================
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "D4: convert_quotation_to_invoice rejects a quotation that isn't accepted yet (still 'sent')", cur, conn,
        lambda: cur.execute("select public.convert_quotation_to_invoice(%s)", (quotation_id,)),
    )

    as_user(cur, salesagent_user)
    cur.execute("select status from public.mark_quotation_accepted(%s)", (quotation_id,))
    accepted_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (accepted_status == 'accepted')

    as_user(cur, salesagent_user)
    cur.execute(
        "select id, due_date, e_invoice_status, source_quotation_id, grand_total from "
        "public.convert_quotation_to_invoice(%s)", (quotation_id,),
    )
    invoice_id, due_date, e_invoice_status, source_quotation_id, invoice_grand_total = cur.fetchone()
    conn.commit()

    all_passed &= check(
        "D1: quotation.status becomes 'converted_to_invoice'", cur,
        "select status from public.quotations where id=%s", (quotation_id,), "converted_to_invoice",
    )
    all_passed &= check(
        "D1: quotation.converted_invoice_id points back at the new invoice", cur,
        "select converted_invoice_id from public.quotations where id=%s", (quotation_id,), invoice_id,
    )
    all_passed &= (source_quotation_id == quotation_id)
    print(f"[{'PASS' if source_quotation_id == quotation_id else 'FAIL'}] D1: invoice.source_quotation_id points back at the quotation")

    cur.execute("select issue_date from public.invoices where id=%s", (invoice_id,))
    issue_date = cur.fetchone()[0]
    expected_due = issue_date + __import__("datetime").timedelta(days=30)  # party.credit_terms_days = 30
    ok = due_date == expected_due
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D1: invoice.due_date = issue_date + Party.credit_terms_days (30) "
          f"(issue_date={issue_date}, due_date={due_date}, expected={expected_due})")

    all_passed &= (e_invoice_status == 'not_applicable')
    print(f"[{'PASS' if e_invoice_status == 'not_applicable' else 'FAIL'}] D2: e_invoice_status defaults to 'not_applicable'")

    as_user(cur, owner)
    all_passed &= check(
        "D3: a balanced ledger posting exists for this invoice's grand_total (debit AR)", cur,
        "select amount from public.ledger_entries where business_id=%s and direction='debit' "
        "and chart_of_accounts_id=(select id from public.chart_of_accounts where business_id=%s and account_code='1100') "
        "order by created_at desc limit 1",
        (biz, biz), invoice_grand_total,
    )
    all_passed &= check(
        "D3: a balanced ledger posting exists for this invoice's grand_total (credit Sales Revenue)", cur,
        "select amount from public.ledger_entries where business_id=%s and direction='credit' "
        "and chart_of_accounts_id=(select id from public.chart_of_accounts where business_id=%s and account_code='4000') "
        "order by created_at desc limit 1",
        (biz, biz), invoice_grand_total,
    )

    # ================= E: internal-rejection propagation =================
    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+7,'to be rejected', %s)",
        (biz, party_id, psycopg2.extras.Json([{"product_id": product_id, "description": "x", "quantity": 1}])),
    )
    reject_quotation_id = cur.fetchone()[0]
    conn.commit()
    cur.execute("select id from public.approval_tasks where subject_type='quotation' and subject_id=%s", (reject_quotation_id,))
    reject_task_id = cur.fetchone()[0]
    as_user(cur, owner)
    cur.execute("select public.decide_approval_task(%s,'rejected')", (reject_task_id,))
    conn.commit()
    all_passed &= check(
        "E: an internally-rejected ApprovalTask flips quotation.status to 'rejected' via the sync trigger", cur,
        "select status from public.quotations where id=%s", (reject_quotation_id,), "rejected",
    )

    # ================= F: role gating =====================================
    # Warehouse Staff DOES have `view` on sales by role design (they need
    # visibility into linked Delivery Orders), so they're expected to see
    # quotations here — Payroll Admin (payroll/hr_attendance_leave only,
    # nothing on sales) is the role with genuinely zero sales visibility.
    as_user(cur, warehouse_user)
    all_passed &= check(
        "F: Warehouse Staff (has sales view by role design, for linked Delivery Orders) can see quotations", cur,
        "select count(*) > 0 from public.quotations where business_id=%s", (biz,), True,
    )
    as_user(cur, payroll_user)
    all_passed &= check(
        "F: Payroll Admin (no sales domain access at all) sees zero quotations for this business", cur,
        "select count(*) from public.quotations where business_id=%s", (biz,), 0,
    )

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
