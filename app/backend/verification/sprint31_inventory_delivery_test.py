# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-30's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 31's Inventory &
# Delivery Order claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23-30) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# every prior sprint's test script used).
#
# What this proves (Sprint 31 Definition of Done):
#   A. Opening stock entry works correctly — including the disclosed
#      capture-vs-configure gating split (header note 4) and the
#      one-per-(product,warehouse) guard.
#   B. Delivery Order dispatch correctly and atomically decrements
#      stock, verified with a REAL concurrent-dispatch test (two DOs
#      racing for the same product's stock via genuine threading, not
#      just sequential calls) — same threading.Barrier discipline
#      Sprint 15's own concurrency test used, per this sprint's own
#      Risks table.
#   C. Stock Take variance-to-adjustment generation, verified against
#      a manually-counted test scenario.
#   D. Delivery Order approval-gated through the real ApprovalTask
#      engine (domain='inventory'), including the rejection path and
#      the disclosed no-'approved'-status-value design (header note 3).
#   Plus: non-stock-tracked lines are skipped for posting (header note
#   5), role gating throughout, and mark_delivery_order_delivered
#   completing the volume's own literal lifecycle (header note 9).

import uuid
import threading
import psycopg2
import psycopg2.extras

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint31_test user=postgres password=testpass123"

OWNER_ROLE = "00000000-0000-0000-0000-000000000001"
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
    """Draft a quotation, approve it, accept, convert -> invoice. Same helper Sprint 29's own test used."""
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
    return invoice_id


def dispatch_race_attempt(dsn, user_id, delivery_order_id, key, results, barrier):
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("set role authenticated")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))
    barrier.wait()  # force both threads to attempt dispatch at (as close to) the same instant
    try:
        cur.execute("select status from public.dispatch_delivery_order(%s)", (delivery_order_id,))
        row = cur.fetchone()
        results[key] = ("SUCCESS", row)
    except Exception as e:
        results[key] = ("REJECTED", str(e).strip().splitlines()[0])
    finally:
        cur.close()
        conn.close()


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    biz, owner, om_owner = seed_business(cur, "ownerW@test.com")
    conn.commit()
    bookkeeper_user, om_bookkeeper = invite_and_accept(cur, conn, owner, biz, BOOKKEEPER_ROLE, "bkW@test.com")
    salesagent_user, om_salesagent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "saW@test.com")
    warehouse_user, om_warehouse = invite_and_accept(cur, conn, owner, biz, WAREHOUSE_ROLE, "whW@test.com")
    payroll_user, om_payroll = invite_and_accept(cur, conn, owner, biz, PAYROLL_ADMIN_ROLE, "pyW@test.com")

    # ------- fixtures: price type, products (one tracked, one not), party ---
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_type(%s,'Retail')", (biz,))
    pt_retail = cur.fetchone()[0]
    conn.commit()

    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_product(%s,'SKU-A','Widget A','pcs',5.00,'manual',true)", (biz,))
    product_a = cur.fetchone()[0]
    cur.execute("select id from public.create_product(%s,'SKU-B','Installation Service','job',0,'manual',false)", (biz,))
    product_b = cur.fetchone()[0]
    conn.commit()
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_list_entry(%s,%s,20.00,current_date - 1,null,null)", (product_a, pt_retail))
    cur.execute("select id from public.create_price_list_entry(%s,%s,50.00,current_date - 1,null,null)", (product_b, pt_retail))
    conn.commit()

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_party(%s,'Buyer Sdn Bhd',null,%s,null,null,null,'+60122222222',null,null,null,0)",
        (biz, ["customer"]),
    )
    party_id = cur.fetchone()[0]
    conn.commit()

    # ================= A: Opening stock =====================================
    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "A: Warehouse Staff (no inventory configure) cannot create a warehouse", cur, conn,
        lambda: cur.execute("select public.create_warehouse(%s,'Main Warehouse')", (biz,)),
    )

    as_user(cur, owner)
    cur.execute("select id from public.create_warehouse(%s,'Main Warehouse')", (biz,))
    warehouse_id = cur.fetchone()[0]
    conn.commit()

    as_user(cur, payroll_user)
    all_passed &= expect_error(
        "A: Payroll Admin (no inventory grants at all) cannot record opening stock", cur, conn,
        lambda: cur.execute("select public.record_opening_stock(%s,%s,%s,100)", (biz, product_a, warehouse_id)),
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "A: record_opening_stock rejects a non-stock-tracked product", cur, conn,
        lambda: cur.execute("select public.record_opening_stock(%s,%s,%s,10)", (biz, product_b, warehouse_id)),
    )

    as_user(cur, warehouse_user)
    cur.execute("select quantity_on_hand from public.record_opening_stock(%s,%s,%s,100,5.00)", (biz, product_a, warehouse_id))
    qty_on_hand = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "A: opening stock recorded — quantity_on_hand starts at 100", cur,
        "select quantity_on_hand from public.stock_levels where product_id=%s and warehouse_id=%s",
        (product_a, warehouse_id), 100,
    )
    all_passed &= check(
        "A: exactly one 'opening' stock_movement row posted", cur,
        "select count(*) from public.stock_movements where product_id=%s and movement_type='opening'",
        (product_a,), 1,
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "A: a second opening-stock entry for the same product+warehouse is rejected", cur, conn,
        lambda: cur.execute("select public.record_opening_stock(%s,%s,%s,50)", (biz, product_a, warehouse_id)),
    )

    # ================= B/D: Delivery Order lifecycle ========================
    invoice1 = make_invoice(cur, conn, salesagent_user, biz, party_id, product_a, 10, owner)

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "D: Sales Agent (no inventory capture) cannot create a delivery order", cur, conn,
        lambda: cur.execute(
            "select public.create_delivery_order(%s,%s,%s,%s)",
            (biz, invoice1, warehouse_id, psycopg2.extras.Json([{"product_id": product_a, "quantity": 10}])),
        ),
    )

    as_user(cur, warehouse_user)
    cur.execute(
        "select id, status from public.create_delivery_order(%s,%s,%s,%s)",
        (biz, invoice1, warehouse_id, psycopg2.extras.Json([{"product_id": product_a, "quantity": 10}])),
    )
    do1_id, do1_status = cur.fetchone()
    conn.commit()
    all_passed &= (do1_status == 'draft')
    print(f"[{'PASS' if do1_status == 'draft' else 'FAIL'}] D: create_delivery_order starts as 'draft'")

    all_passed &= check(
        "D: a real ApprovalTask created for the DO (domain=inventory)", cur,
        "select domain from public.approval_tasks where subject_type='delivery_order' and subject_id=%s", (do1_id,), "inventory",
    )
    all_passed &= check(
        "D: the linked invoice's delivery_order_id now points back at the DO", cur,
        "select delivery_order_id from public.invoices where id=%s", (invoice1,), do1_id,
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "D: create_delivery_order refuses an invoice that already has one linked", cur, conn,
        lambda: cur.execute(
            "select public.create_delivery_order(%s,%s,%s,%s)",
            (biz, invoice1, warehouse_id, psycopg2.extras.Json([{"product_id": product_a, "quantity": 1}])),
        ),
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "B: dispatch_delivery_order refused before the ApprovalTask is approved", cur, conn,
        lambda: cur.execute("select public.dispatch_delivery_order(%s)", (do1_id,)),
    )

    decide_pending_task(cur, conn, 'delivery_order', do1_id, bookkeeper_user, 'approved')
    all_passed &= check(
        "D: on approval, delivery_order.status stays 'draft' (no invented 'approved' value — see header note 3)", cur,
        "select status from public.delivery_orders where id=%s", (do1_id,), "draft",
    )

    as_user(cur, warehouse_user)
    cur.execute("select status from public.dispatch_delivery_order(%s)", (do1_id,))
    do1_dispatched_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (do1_dispatched_status == 'dispatched')
    print(f"[{'PASS' if do1_dispatched_status == 'dispatched' else 'FAIL'}] B: dispatch_delivery_order moves status to 'dispatched'")

    all_passed &= check(
        "B: stock_levels correctly decremented 100 -> 90", cur,
        "select quantity_on_hand from public.stock_levels where product_id=%s and warehouse_id=%s",
        (product_a, warehouse_id), 90,
    )
    all_passed &= check(
        "B: a 'delivery_out' stock_movement of 10 posted, linked to the DO", cur,
        "select quantity from public.stock_movements where product_id=%s and movement_type='delivery_out' "
        "and source_document_type='delivery_order' and source_document_id=%s", (product_a, do1_id), 10,
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "B: dispatch_delivery_order refused a second time (already dispatched)", cur, conn,
        lambda: cur.execute("select public.dispatch_delivery_order(%s)", (do1_id,)),
    )

    as_user(cur, warehouse_user)
    cur.execute("select status from public.mark_delivery_order_delivered(%s)", (do1_id,))
    do1_delivered_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (do1_delivered_status == 'delivered')
    print(f"[{'PASS' if do1_delivered_status == 'delivered' else 'FAIL'}] D: mark_delivery_order_delivered completes the lifecycle")

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "D: mark_delivery_order_delivered refused once already delivered", cur, conn,
        lambda: cur.execute("select public.mark_delivery_order_delivered(%s)", (do1_id,)),
    )

    # ------- non-stock-tracked line: dispatch posts nothing to stock --------
    invoice2 = make_invoice(cur, conn, salesagent_user, biz, party_id, product_b, 1, owner)
    as_user(cur, warehouse_user)
    cur.execute(
        "select id from public.create_delivery_order(%s,%s,%s,%s)",
        (biz, invoice2, warehouse_id, psycopg2.extras.Json([{"product_id": product_b, "quantity": 1}])),
    )
    do2_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'delivery_order', do2_id, bookkeeper_user, 'approved')
    as_user(cur, warehouse_user)
    cur.execute("select status from public.dispatch_delivery_order(%s)", (do2_id,))
    do2_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (do2_status == 'dispatched')
    all_passed &= check(
        "B: a non-stock-tracked line's dispatch posts NO stock_movement (see header note 5)", cur,
        "select count(*) from public.stock_movements where product_id=%s", (product_b,), 0,
    )

    # ------- rejection path ---------------------------------------------
    invoice3 = make_invoice(cur, conn, salesagent_user, biz, party_id, product_a, 5, owner)
    as_user(cur, warehouse_user)
    cur.execute(
        "select id from public.create_delivery_order(%s,%s,%s,%s)",
        (biz, invoice3, warehouse_id, psycopg2.extras.Json([{"product_id": product_a, "quantity": 5}])),
    )
    do3_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'delivery_order', do3_id, bookkeeper_user, 'rejected')
    all_passed &= check(
        "D: on rejection, delivery_order.status moves to 'rejected'", cur,
        "select status from public.delivery_orders where id=%s", (do3_id,), "rejected",
    )
    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "D: dispatch_delivery_order refused on a rejected DO", cur, conn,
        lambda: cur.execute("select public.dispatch_delivery_order(%s)", (do3_id,)),
    )

    # ================= B: concurrent-dispatch race (the sprint's own named risk) =====
    print()
    NUM_TRIALS = 3
    for trial in range(1, NUM_TRIALS + 1):
        as_user(cur, salesagent_user)
        cur.execute("select id from public.create_product(%s,%s,'Race Widget','pcs',5.00,'manual',true)",
                    (biz, f'SKU-RACE-{trial}'))
        race_product = cur.fetchone()[0]
        cur.execute("select id from public.create_price_list_entry(%s,%s,20.00,current_date - 1,null,null)", (race_product, pt_retail))
        conn.commit()

        as_user(cur, owner)
        cur.execute("select id from public.create_warehouse(%s,%s)", (biz, f'Race Warehouse {trial}'))
        race_warehouse = cur.fetchone()[0]
        conn.commit()

        as_user(cur, warehouse_user)
        cur.execute("select public.record_opening_stock(%s,%s,%s,10)", (biz, race_product, race_warehouse))
        conn.commit()

        race_invoice_a = make_invoice(cur, conn, salesagent_user, biz, party_id, race_product, 1, owner)
        race_invoice_b = make_invoice(cur, conn, salesagent_user, biz, party_id, race_product, 1, owner)

        as_user(cur, warehouse_user)
        cur.execute(
            "select id from public.create_delivery_order(%s,%s,%s,%s)",
            (biz, race_invoice_a, race_warehouse, psycopg2.extras.Json([{"product_id": race_product, "quantity": 6}])),
        )
        race_do_a = cur.fetchone()[0]
        cur.execute(
            "select id from public.create_delivery_order(%s,%s,%s,%s)",
            (biz, race_invoice_b, race_warehouse, psycopg2.extras.Json([{"product_id": race_product, "quantity": 6}])),
        )
        race_do_b = cur.fetchone()[0]
        conn.commit()
        decide_pending_task(cur, conn, 'delivery_order', race_do_a, bookkeeper_user, 'approved')
        decide_pending_task(cur, conn, 'delivery_order', race_do_b, bookkeeper_user, 'approved')

        results = {}
        barrier = threading.Barrier(2)
        t1 = threading.Thread(target=dispatch_race_attempt, args=(DSN, warehouse_user, race_do_a, "do_a", results, barrier))
        t2 = threading.Thread(target=dispatch_race_attempt, args=(DSN, warehouse_user, race_do_b, "do_b", results, barrier))
        t1.start(); t2.start()
        t1.join(); t2.join()

        successes = [k for k, v in results.items() if v[0] == "SUCCESS"]
        rejections = [k for k, v in results.items() if v[0] == "REJECTED"]

        as_user(cur, owner)
        cur.execute("select quantity_on_hand from public.stock_levels where product_id=%s and warehouse_id=%s",
                    (race_product, race_warehouse))
        final_qty = cur.fetchone()[0]
        conn.commit()

        trial_ok = (len(successes) == 1 and len(rejections) == 1 and float(final_qty) == 4.0)
        all_passed &= trial_ok
        print(f"[{'PASS' if trial_ok else 'FAIL'}] B trial {trial}: exactly one dispatch succeeded "
              f"({successes}), one rejected for insufficient stock ({[results[k][1] for k in rejections]}), "
              f"final quantity_on_hand={final_qty} (expected 4.0, i.e. 10 - 6, no lost update / no negative stock)")
    print()

    # ================= C: Stock Take =========================================
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "C: Sales Agent (no inventory capture) cannot create a stock take", cur, conn,
        lambda: cur.execute("select public.create_stock_take(%s,%s)", (biz, warehouse_id)),
    )

    as_user(cur, warehouse_user)
    cur.execute("select id from public.create_stock_take(%s,%s)", (biz, warehouse_id))
    stock_take_id = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "C: stock take snapshot has exactly one line (only product A is stock-tracked here)", cur,
        "select count(*) from public.stock_take_lines where stock_take_id=%s", (stock_take_id,), 1,
    )
    all_passed &= check(
        "C: the snapshotted system_qty matches current stock (90)", cur,
        "select system_qty from public.stock_take_lines where stock_take_id=%s and product_id=%s",
        (stock_take_id, product_a), 90,
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "C: recording a count for a product not on this stock take is rejected", cur, conn,
        lambda: cur.execute(
            "select public.record_stock_take_counts(%s,%s)",
            (stock_take_id, psycopg2.extras.Json([{"product_id": product_b, "counted_qty": 1}])),
        ),
    )

    as_user(cur, warehouse_user)
    cur.execute(
        "select counted_qty, variance from public.record_stock_take_counts(%s,%s)",
        (stock_take_id, psycopg2.extras.Json([{"product_id": product_a, "counted_qty": 85}])),
    )
    counted_qty, variance = cur.fetchone()
    conn.commit()
    all_passed &= (float(counted_qty) == 85.0 and float(variance) == -5.0)
    print(f"[{'PASS' if float(counted_qty) == 85.0 and float(variance) == -5.0 else 'FAIL'}] "
          f"C: manually-counted 85 against system 90 computes variance -5")

    as_user(cur, warehouse_user)
    cur.execute("select status from public.complete_stock_take(%s)", (stock_take_id,))
    completed_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (completed_status == 'completed')
    print(f"[{'PASS' if completed_status == 'completed' else 'FAIL'}] C: complete_stock_take moves status to 'completed'")

    all_passed &= check(
        "C: an 'adjustment_decrease' stock_movement of 5 was generated, linked to the stock take", cur,
        "select quantity from public.stock_movements where product_id=%s and movement_type='adjustment_decrease' "
        "and source_document_type='stock_take' and source_document_id=%s", (product_a, stock_take_id), 5,
    )
    all_passed &= check(
        "C: stock_levels correctly reflects the counted variance — 90 - 5 = 85", cur,
        "select quantity_on_hand from public.stock_levels where product_id=%s and warehouse_id=%s",
        (product_a, warehouse_id), 85,
    )

    as_user(cur, warehouse_user)
    all_passed &= expect_error(
        "C: complete_stock_take refused a second time (already completed)", cur, conn,
        lambda: cur.execute("select public.complete_stock_take(%s)", (stock_take_id,)),
    )

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
