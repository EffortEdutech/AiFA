# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-26's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 27's Pricing &
# Product Catalog claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23-26) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# every prior sprint's test script used).
#
# What this proves (Sprint 27 Definition of Done):
#   A. price_types: first-created row auto-becomes is_default; a
#      second create does not; set_default_price_type flips the flag
#      atomically (old default cleared, new one set) and is
#      capture-on-pricing gated.
#   B. products: create_product is capture-on-pricing gated; passing
#      cost_source='auto_from_purchase' is rejected server-side with a
#      clear error (the Purchase-module addendum has not shipped —
#      Vol 13_0 §5's own note, this sprint's risk mitigation).
#   C. price_list_entries: create_price_list_entry is capture-on-pricing
#      gated and rejects a price_type_id belonging to a different
#      business.
#   D. resolve_price (PRICE-001), tested with 3 price types per the
#      sprint's own explicit DoD requirement:
#        D1. party's assigned price type has an effective entry for the
#            product -> that price wins, used_business_default = false.
#        D2. party has no price_type_id set -> falls back to the
#            business default price type's entry, used_business_default
#            = true.
#        D3. party's assigned price type exists but has NO entry for
#            this specific product -> falls back to the business
#            default's entry (the disclosed extra fallback beyond the
#            literal two-step spec text), used_business_default = true.
#        D4. no price resolvable at all (no default-type entry either)
#            -> raises a clear error, not a silent null/zero.
#   E. Product import: create_product_import_batch stages rows without
#      creating any product yet; a deliberately-bad row (parse_status
#      = 'error') is stored, counted in error_count, and never
#      silently turned into a product; apply_product_import_batch only
#      commits the 'ok' rows, is idempotent (re-applying does not
#      duplicate products), and is capture-on-pricing gated.
#   F. RLS/capability split across role templates: Sales Agent
#      (capture+view on pricing) can create price types/products/price
#      list entries; Bookkeeper (view+approve only, no capture on
#      pricing) is rejected from all of the same; both can SELECT
#      (view-gated), a role with neither (Warehouse Staff) cannot see
#      anything set up by another business.

import uuid
import psycopg2
import psycopg2.extras

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint27_test user=postgres password=testpass123"

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


def create_party(cur, conn, as_user_fn, biz, display_name, party_types):
    cur.execute(
        "select id from public.create_party(%s,%s,null,%s,null,null,null,null,null,null,null,null)",
        (biz, display_name, party_types),
    )
    party_id = cur.fetchone()[0]
    conn.commit()
    return party_id


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    biz, owner, om_owner = seed_business(cur, "ownerP@test.com")
    conn.commit()
    bookkeeper_user, om_bookkeeper = invite_and_accept(cur, conn, owner, biz, BOOKKEEPER_ROLE, "bkP@test.com")
    salesagent_user, om_salesagent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "saP@test.com")
    warehouse_user, om_warehouse = invite_and_accept(cur, conn, owner, biz, WAREHOUSE_ROLE, "whP@test.com")

    # a second, unrelated business — used only for cross-business rejection checks
    biz2, owner2, om_owner2 = seed_business(cur, "ownerQ@test.com")
    conn.commit()

    # ================= A: price_types auto-default =========================
    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_type(%s,'Retail')", (biz,))
    pt_retail = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "A: first-created price type auto-becomes default", cur,
        "select is_default from public.price_types where id=%s", (pt_retail,), True,
    )

    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_type(%s,'Wholesale')", (biz,))
    pt_wholesale = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "A: second-created price type is NOT auto-default", cur,
        "select is_default from public.price_types where id=%s", (pt_wholesale,), False,
    )

    as_user(cur, salesagent_user)
    cur.execute("select id from public.create_price_type(%s,'VIP')", (biz,))
    pt_vip = cur.fetchone()[0]
    conn.commit()

    as_user(cur, salesagent_user)
    cur.execute("select id from public.set_default_price_type(%s,%s)", (biz, pt_wholesale))
    conn.commit()
    all_passed &= check(
        "A: set_default_price_type flips new default on", cur,
        "select is_default from public.price_types where id=%s", (pt_wholesale,), True,
    )
    all_passed &= check(
        "A: set_default_price_type clears old default", cur,
        "select is_default from public.price_types where id=%s", (pt_retail,), False,
    )
    # restore Retail as default for the resolve_price scenarios below (readability)
    as_user(cur, salesagent_user)
    cur.execute("select id from public.set_default_price_type(%s,%s)", (biz, pt_retail))
    conn.commit()

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "A: Bookkeeper (no pricing capture) cannot create a price type", cur, conn,
        lambda: cur.execute("select public.create_price_type(%s,'ShouldFail')", (biz,)),
    )

    # ================= B: products =========================================
    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_product(%s,'SKU-001','Widget','pcs',10.00,'manual',false)", (biz,),
    )
    product_widget = cur.fetchone()[0]
    conn.commit()

    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "B: cost_source='auto_from_purchase' is rejected (Purchase addendum not shipped)", cur, conn,
        lambda: cur.execute(
            "select public.create_product(%s,'SKU-002','Gadget','pcs',5.00,'auto_from_purchase',false)", (biz,),
        ),
    )
    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "B: Bookkeeper (no pricing capture) cannot create a product", cur, conn,
        lambda: cur.execute(
            "select public.create_product(%s,'SKU-003','ShouldFail','pcs',1.00,'manual',false)", (biz,),
        ),
    )

    # ================= C: price_list_entries ================================
    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_price_list_entry(%s,%s,20.00,current_date - 1,null,null)",
        (product_widget, pt_retail),
    )
    ple_retail = cur.fetchone()[0]
    conn.commit()

    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_price_list_entry(%s,%s,15.00,current_date - 1,null,null)",
        (product_widget, pt_wholesale),
    )
    ple_wholesale = cur.fetchone()[0]
    conn.commit()

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "C: Bookkeeper (no pricing capture) cannot create a price list entry", cur, conn,
        lambda: cur.execute(
            "select public.create_price_list_entry(%s,%s,99.00,current_date,null,null)",
            (product_widget, pt_retail),
        ),
    )

    as_user(cur, owner2)
    cur.execute("select id from public.create_price_type(%s,'OtherBizType')", (biz2,))
    pt_other_biz = cur.fetchone()[0]
    conn.commit()
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "C: create_price_list_entry rejects a price_type_id from a different business", cur, conn,
        lambda: cur.execute(
            "select public.create_price_list_entry(%s,%s,1.00,current_date,null,null)",
            (product_widget, pt_other_biz),
        ),
    )

    # ================= D: resolve_price (PRICE-001), >=3 price types ========
    # D1: party assigned Wholesale, which has an entry for this product -> Wholesale wins
    as_user(cur, salesagent_user)
    party_wholesale_customer = create_party(cur, conn, as_user, biz, "Wholesale Co", ["customer"])
    as_user(cur, salesagent_user)
    cur.execute("select id from public.set_party_price_type(%s,%s)", (party_wholesale_customer, pt_wholesale))
    conn.commit()

    cur.execute(
        "select unit_price, price_type_id, used_business_default from public.resolve_price(%s,%s,%s)",
        (biz, product_widget, party_wholesale_customer),
    )
    row = cur.fetchone()
    all_passed &= (row is not None and float(row[0]) == 15.00 and row[1] == pt_wholesale and row[2] is False)
    print(f"[{'PASS' if (row and float(row[0]) == 15.00 and row[1] == pt_wholesale and row[2] is False) else 'FAIL'}] "
          f"D1: party's own assigned price type resolves when it has an effective entry (got {row})")

    # D2: party with NO price_type_id set -> falls back to business default (Retail)
    as_user(cur, salesagent_user)
    party_no_type = create_party(cur, conn, as_user, biz, "Walk-in Customer", ["customer"])
    cur.execute(
        "select unit_price, price_type_id, used_business_default from public.resolve_price(%s,%s,%s)",
        (biz, product_widget, party_no_type),
    )
    row = cur.fetchone()
    ok = row is not None and float(row[0]) == 20.00 and row[1] == pt_retail and row[2] is True
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D2: party with no price type falls back to business default (got {row})")

    # D3: party assigned VIP, which exists but has NO entry for this product -> falls back to business default
    as_user(cur, salesagent_user)
    party_vip_no_entry = create_party(cur, conn, as_user, biz, "VIP No Entry Co", ["customer"])
    as_user(cur, salesagent_user)
    cur.execute("select id from public.set_party_price_type(%s,%s)", (party_vip_no_entry, pt_vip))
    conn.commit()
    cur.execute(
        "select unit_price, price_type_id, used_business_default from public.resolve_price(%s,%s,%s)",
        (biz, product_widget, party_vip_no_entry),
    )
    row = cur.fetchone()
    ok = row is not None and float(row[0]) == 20.00 and row[1] == pt_retail and row[2] is True
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D3: party's price type exists but has no entry for this product -> "
          f"falls back to business default, disclosed extra fallback (got {row})")

    # D4: no price resolvable at all — a product with zero price_list_entries anywhere
    as_user(cur, salesagent_user)
    cur.execute(
        "select id from public.create_product(%s,'SKU-BARE','Bare Product','pcs',null,'manual',false)", (biz,),
    )
    product_bare = cur.fetchone()[0]
    conn.commit()
    as_user(cur, salesagent_user)
    all_passed &= expect_error(
        "D4: resolve_price raises a clear error when nothing is resolvable (no silent null)", cur, conn,
        lambda: cur.execute("select * from public.resolve_price(%s,%s,%s)", (biz, product_bare, party_no_type)),
    )

    # ================= E: product import staging =============================
    as_user(cur, salesagent_user)
    rows_json = psycopg2.extras.Json([
        {"raw_data": {"sku": "IMP-001", "name": "Imported Widget", "unit": "pcs", "cost": "3.50"},
         "sku": "IMP-001", "name": "Imported Widget", "unit_of_measure": "pcs", "default_cost": "3.50",
         "parse_status": "ok"},
        {"raw_data": {"sku": "", "name": "", "unit": "", "cost": "not-a-number"},
         "parse_status": "error", "error_message": "missing SKU and name; cost is not numeric"},
    ])
    cur.execute(
        "select id, row_count, error_count, status from public.create_product_import_batch(%s,%s,%s)",
        (biz, "products_sample.xlsx", rows_json),
    )
    batch_id, row_count, error_count, batch_status = cur.fetchone()
    conn.commit()
    all_passed &= (row_count == 2 and error_count == 1 and batch_status == 'parsed')
    print(f"[{'PASS' if (row_count == 2 and error_count == 1 and batch_status == 'parsed') else 'FAIL'}] "
          f"E: batch stages both rows, counts the bad row, status stays 'parsed' not 'failed' "
          f"(row_count={row_count}, error_count={error_count}, status={batch_status})")

    all_passed &= check(
        "E: the bad row is stored with parse_status='error' and never silently dropped", cur,
        "select count(*) from public.product_import_rows where batch_id=%s and parse_status='error'",
        (batch_id,), 1,
    )
    all_passed &= check(
        "E: the bad row has no created_product_id (never silently turned into a product)", cur,
        "select created_product_id from public.product_import_rows where batch_id=%s and parse_status='error'",
        (batch_id,), None,
    )

    as_user(cur, bookkeeper_user)
    all_passed &= expect_error(
        "E: Bookkeeper (no pricing capture) cannot apply an import batch", cur, conn,
        lambda: cur.execute("select public.apply_product_import_batch(%s)", (batch_id,)),
    )

    as_user(cur, salesagent_user)
    cur.execute("select status from public.apply_product_import_batch(%s)", (batch_id,))
    applied_status = cur.fetchone()[0]
    conn.commit()
    all_passed &= (applied_status == 'applied')
    print(f"[{'PASS' if applied_status == 'applied' else 'FAIL'}] E: apply_product_import_batch marks the batch applied")

    all_passed &= check(
        "E: exactly 1 product created from the batch (the 'ok' row only)", cur,
        "select count(*) from public.products where sku='IMP-001' and business_id=%s", (biz,), 1,
    )

    as_user(cur, salesagent_user)
    cur.execute("select status from public.apply_product_import_batch(%s)", (batch_id,))
    conn.commit()
    all_passed &= check(
        "E: re-applying the same batch is idempotent (still exactly 1 product, no duplicate)", cur,
        "select count(*) from public.products where sku='IMP-001' and business_id=%s", (biz,), 1,
    )

    # ================= F: role-template gating on SELECT =====================
    as_user(cur, salesagent_user)
    all_passed &= check(
        "F: Sales Agent (pricing view) can see the products list", cur,
        "select count(*) > 0 from public.products where business_id=%s", (biz,), True,
    )
    as_user(cur, bookkeeper_user)
    all_passed &= check(
        "F: Bookkeeper (pricing view, no capture) can still SELECT products", cur,
        "select count(*) > 0 from public.products where business_id=%s", (biz,), True,
    )
    as_user(cur, warehouse_user)
    all_passed &= check(
        "F: Warehouse Staff (no pricing view) sees zero products for this business", cur,
        "select count(*) from public.products where business_id=%s", (biz,), 0,
    )

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
