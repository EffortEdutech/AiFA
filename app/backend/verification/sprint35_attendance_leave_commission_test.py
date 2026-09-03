# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23-34's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 35's attendance/
# overtime/leave/commission/dashboard work was verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 21-34) -> GRANT ALL TABLES +
# SEQUENCES to authenticated -> this sprint's migration -> GRANT again
# (new tables/sequences) -> this script (does its own auth.users/
# businesses/Owner-membership seeding, same synthetic-domain approach
# every prior sprint's test script used).
#
# ============================================================
# NOTE ON DoD ITEM 1 (GPS clock-in/out with offline queueing, verified
# via an airplane-mode test on a real device): this cannot be performed
# by this session — there is no mobile app UI or physical device in
# this engagement's toolset. What IS verified here: create_attendance_
# record accepts a caller-supplied recorded_at rather than forcing
# now(), so a record captured offline and synced later still carries
# its true clock time (section A.4 below). See the migration's own
# header note 1 and the Sprint 35 doc's Outcomes for the full
# disclosure. DoD item 1 stays open.
#
# NOTE ON OVERTIME/PAYROLL CONSTANTS: hourly_rate = basic_salary /
# (26 working days x 8 hours), overtime at 1.5x — an assumed common
# Malaysian payroll convention, not a verified statutory requirement
# (Vol 13_0 §11 specifies neither constant). Test salaries below were
# deliberately chosen so basic_salary / 208 divides evenly, to keep
# the reference arithmetic exact rather than fighting rounding at the
# x.xx5 boundary.
# ============================================================
#
# What this proves (Sprint 35 Definition of Done):
#   [OPEN] GPS/offline airplane-mode test — cannot be performed here.
#   B. Overtime correctly derived (clean AND irregular-schedule cases),
#      approved, reaches a real PayrollRun's gross_pay, and statutory
#      deductions are correctly computed against the OT-inclusive
#      gross (verified against an independent Python reference).
#   C. Full leave application -> approval -> balance deduction cycle,
#      with balance explicitly proven unchanged at submission time.
#   D. Commission correctly computed and attributed for THREE basis
#      types (percent_of_invoice, percent_of_margin, flat_per_unit),
#      including agent-specific-rule-vs-business-default resolution
#      order.
#   E. Dashboard shows correct revenue-vs-cost figures for one period,
#      checked against an independently-summed reference.
#   Plus: attendance alternation guard, role-gating on every new
#   domain (hr_attendance_leave, commission, accounting_reports), and
#   the rejection-deletes-the-draft-row behaviour for OvertimeRecord/
#   CommissionCalculation vs. LeaveApplication's real 'rejected' state.

import uuid
import psycopg2
import psycopg2.extras

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint35_test user=postgres password=testpass123"

OWNER_ROLE = "00000000-0000-0000-0000-000000000001"
PAYROLL_ADMIN_ROLE = "00000000-0000-0000-0000-000000000005"
SALES_AGENT_ROLE = "00000000-0000-0000-0000-000000000003"

TEST_ENCRYPTION_KEY = "sprint35-throwaway-test-key-not-a-real-secret"


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


def make_invoice(cur, conn, owner_user, biz, party_id, lines, tax_code=None):
    as_user(cur, owner_user)
    cur.execute(
        "select id from public.create_quotation(%s,%s,current_date+7,'fixture', %s)",
        (biz, party_id, psycopg2.extras.Json(lines)),
    )
    quotation_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'quotation', quotation_id, owner_user, 'approved')
    as_user(cur, owner_user)
    cur.execute("select public.mark_quotation_sent(%s)", (quotation_id,))
    cur.execute("select public.mark_quotation_accepted(%s)", (quotation_id,))
    cur.execute("select id, grand_total from public.convert_quotation_to_invoice(%s)", (quotation_id,))
    invoice_id, grand_total = cur.fetchone()
    conn.commit()
    return invoice_id, grand_total


# Independent Python reference for statutory deductions — NOT copied
# from the SQL function, same published 2026 rates as Sprint 34's own
# independent reference, recomputed fresh here.
def reference_statutory(gross):
    epf_employee = round(gross * 0.11, 2)
    socso_wage = min(gross, 6000)
    socso_employee = round(socso_wage * 0.005, 2)
    eis_wage = min(gross, 6000)
    eis_employee = round(eis_wage * 0.002, 2)

    annual_gross = gross * 12
    epf_relief = min(epf_employee * 12, 7000)
    chargeable = max(annual_gross - epf_relief - 9000, 0)

    brackets = [
        (0, 5000, 0.00), (5000, 20000, 0.01), (20000, 35000, 0.03), (35000, 50000, 0.06),
        (50000, 70000, 0.11), (70000, 100000, 0.19), (100000, 400000, 0.25),
        (400000, 600000, 0.26), (600000, 2000000, 0.28), (2000000, None, 0.30),
    ]
    annual_tax = 0.0
    for lower, upper, rate in brackets:
        if chargeable > lower:
            taxable = min(chargeable, upper if upper is not None else chargeable) - lower
            annual_tax += taxable * rate
    pcb = round(annual_tax / 12, 2)

    return {"epf_employee": epf_employee, "socso_employee": socso_employee,
            "eis_employee": eis_employee, "pcb_deduction": pcb}


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    biz, owner, om_owner = seed_business(cur, "owner35@test.com")
    conn.commit()
    payroll_admin_user, om_payroll_admin = invite_and_accept(cur, conn, owner, biz, PAYROLL_ADMIN_ROLE, "pa35@test.com")
    sales_agent_user, om_sales_agent = invite_and_accept(cur, conn, owner, biz, SALES_AGENT_ROLE, "sa35@test.com")

    # ------- fixtures: two employees, exact hourly rates ------------------
    as_user(cur, payroll_admin_user)
    cur.execute(
        "select id from public.create_party(%s,'Chan Employee',null,%s,null,null,null,'+60161111111',null,null,null,0)",
        (biz, ["employee"]),
    )
    emp1_party_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_party(%s,'Devi Employee',null,%s,null,null,null,'+60162222222',null,null,null,0)",
        (biz, ["employee"]),
    )
    emp2_party_id = cur.fetchone()[0]
    conn.commit()

    # basic_salary chosen so basic_salary/208 is exact (no rounding at x.xx5).
    cur.execute(
        "select id from public.create_employee_profile(%s,%s,'920303-03-1111','EPF-101',null,null,'Maybank',"
        "'1111111111',5200,'full_time','2025-01-01',%s)",
        (biz, emp1_party_id, TEST_ENCRYPTION_KEY),
    )
    ep1_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_employee_profile(%s,%s,'930404-04-2222','EPF-102',null,null,'CIMB',"
        "'2222222222',4160,'full_time','2025-01-01',%s)",
        (biz, emp2_party_id, TEST_ENCRYPTION_KEY),
    )
    ep2_id = cur.fetchone()[0]
    conn.commit()

    # =================================================================
    # A. Attendance capture: alternation guard, GPS fields, and the
    # offline-synced-later case (see header notes 1-2).
    # =================================================================
    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "A: Sales Agent (no hr_attendance_leave grants) cannot clock in an employee", cur, conn,
        lambda: cur.execute(
            "select public.create_attendance_record(%s,%s,'in','2026-09-10 08:00:00+08')", (biz, emp1_party_id),
        ),
        contains="not_authorized",
    )

    as_user(cur, payroll_admin_user)
    all_passed &= expect_error(
        "A: employee 2 cannot clock OUT before ever clocking in", cur, conn,
        lambda: cur.execute(
            "select public.create_attendance_record(%s,%s,'out','2026-09-11 09:00:00+08')", (biz, emp2_party_id),
        ),
        contains="cannot_clock_out_before_ever_clocking_in",
    )

    cur.execute(
        "select id, clock_type, recorded_at, gps_lat, gps_lng, gps_accuracy_m from public.create_attendance_record"
        "(%s,%s,'in','2026-09-10 08:00:00+08',3.1390,101.6869,5.5)",
        (biz, emp1_party_id),
    )
    row = cur.fetchone()
    conn.commit()
    ok = row[1] == 'in' and float(row[3]) == 3.139 and float(row[4]) == 101.6869 and float(row[5]) == 5.5
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: clock-in recorded with GPS lat/lng/accuracy — got {row[1:]}")

    all_passed &= expect_error(
        "A: employee 1 cannot clock IN twice in a row (alternation guard)", cur, conn,
        lambda: cur.execute(
            "select public.create_attendance_record(%s,%s,'in','2026-09-10 09:00:00+08')", (biz, emp1_party_id),
        ),
        contains="cannot_clock_in_twice_in_a_row",
    )

    cur.execute(
        "select public.create_attendance_record(%s,%s,'out','2026-09-10 18:00:00+08')", (biz, emp1_party_id),
    )
    conn.commit()
    all_passed &= expect_error(
        "A: employee 1 cannot clock OUT twice in a row (alternation guard)", cur, conn,
        lambda: cur.execute(
            "select public.create_attendance_record(%s,%s,'out','2026-09-10 18:30:00+08')", (biz, emp1_party_id),
        ),
        contains="cannot_clock_out_twice_in_a_row",
    )

    # A.4: offline-captured record synced later — recorded_at is the
    # true (past) clock time, NOT the moment this INSERT actually runs.
    cur.execute(
        "select recorded_at, now() from public.create_attendance_record(%s,%s,'in','2026-09-12 07:55:00+08')",
        (biz, emp1_party_id),
    )
    recorded_at, db_now = cur.fetchone()
    conn.commit()
    import datetime
    expected_instant = datetime.datetime(2026, 9, 12, 7, 55, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
    # Fixture dates in this test suite are arbitrary near-future dates (same
    # convention every prior sprint's test script uses), so recorded_at isn't
    # necessarily "in the past" relative to the real wall clock db now() —
    # the actual proof is that recorded_at is NOT silently replaced by
    # now() at insert time, i.e. it differs from the real insert instant.
    ok = recorded_at == expected_instant and recorded_at != db_now
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: a caller-supplied (past) recorded_at is stored as-is, not forced to "
          f"now() — simulates a record captured offline and synced minutes/hours later (recorded_at={recorded_at}, "
          f"db now()={db_now})")
    cur.execute("select public.create_attendance_record(%s,%s,'out','2026-09-12 17:00:00+08')", (biz, emp1_party_id))
    conn.commit()

    # Employee 2's own clean in/out pair, worked 9h against a 6h
    # schedule — the irregular-schedule case (this sprint's own Risk).
    cur.execute("select public.create_attendance_record(%s,%s,'in','2026-09-11 09:00:00+08')", (biz, emp2_party_id))
    cur.execute("select public.create_attendance_record(%s,%s,'out','2026-09-11 18:00:00+08')", (biz, emp2_party_id))
    conn.commit()

    # =================================================================
    # B. Overtime derivation: clean case, irregular-schedule case,
    # duplicate guard, no-overtime guard, rejection deletes the row,
    # and — later, section E — the sync into a real PayrollRun.
    # =================================================================
    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "B: Sales Agent cannot derive overtime", cur, conn,
        lambda: cur.execute("select public.derive_overtime_for_date(%s,%s,'2026-09-10')", (biz, emp1_party_id)),
        contains="not_authorized",
    )

    as_user(cur, payroll_admin_user)
    cur.execute(
        "select id, hours, status from public.derive_overtime_for_date(%s,%s,'2026-09-10')", (biz, emp1_party_id),
    )
    ot1_id, ot1_hours, ot1_status = cur.fetchone()
    conn.commit()
    ok = float(ot1_hours) == 2.00 and ot1_status == 'draft'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: employee 1's clean 10h-worked-vs-8h-scheduled day derives 2.00h "
          f"overtime, status 'draft' — got hours={ot1_hours}, status={ot1_status!r}")

    cur.execute(
        "select id, hours, status from public.derive_overtime_for_date(%s,%s,'2026-09-11',6)", (biz, emp2_party_id),
    )
    ot2_id, ot2_hours, ot2_status = cur.fetchone()
    conn.commit()
    ok = float(ot2_hours) == 3.00 and ot2_status == 'draft'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B (irregular schedule): employee 2 worked 9h against an explicit 6h "
          f"scheduled-hours parameter, derives 3.00h overtime — got hours={ot2_hours}, status={ot2_status!r}")

    all_passed &= expect_error(
        "B: deriving overtime twice for the same employee/date is rejected", cur, conn,
        lambda: cur.execute("select public.derive_overtime_for_date(%s,%s,'2026-09-10')", (biz, emp1_party_id)),
        contains="overtime_already_derived",
    )

    # No-overtime guard: employee 1's offline-synced day (09-12) worked
    # exactly 9h (07:55-17:00 = 9h05m) against the default 8h schedule —
    # switch to a day worked exactly at schedule to force the guard.
    cur.execute("select public.create_attendance_record(%s,%s,'in','2026-09-14 08:00:00+08')", (biz, emp1_party_id))
    cur.execute("select public.create_attendance_record(%s,%s,'out','2026-09-14 16:00:00+08')", (biz, emp1_party_id))
    conn.commit()
    all_passed &= expect_error(
        "B: worked hours == scheduled hours produces no overtime (guard, not a silent zero row)", cur, conn,
        lambda: cur.execute("select public.derive_overtime_for_date(%s,%s,'2026-09-14')", (biz, emp1_party_id)),
        contains="no_overtime_for_this_date",
    )

    # Approve both real overtime records (feeds section E's payroll run).
    decide_pending_task(cur, conn, 'overtime_record', ot1_id, owner, 'approved')
    decide_pending_task(cur, conn, 'overtime_record', ot2_id, owner, 'approved')
    as_superuser(cur)
    cur.execute("select status from public.overtime_records where id in (%s,%s)", (ot1_id, ot2_id))
    statuses = {r[0] for r in cur.fetchall()}
    ok = statuses == {'approved'}
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: both OvertimeRecords flip to 'approved' once their ApprovalTask "
          f"is decided — got {statuses}")

    # Rejection deletes the draft row (header note 6) — a third, throwaway
    # overtime day for employee 1.
    cur.execute("select public.create_attendance_record(%s,%s,'in','2026-09-15 08:00:00+08')", (biz, emp1_party_id))
    cur.execute("select public.create_attendance_record(%s,%s,'out','2026-09-15 19:00:00+08')", (biz, emp1_party_id))
    conn.commit()
    cur.execute("select id from public.derive_overtime_for_date(%s,%s,'2026-09-15')", (biz, emp1_party_id))
    ot3_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'overtime_record', ot3_id, owner, 'rejected')
    as_superuser(cur)
    cur.execute("select count(*) from public.overtime_records where id=%s", (ot3_id,))
    ok = cur.fetchone()[0] == 0
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] B: a rejected OvertimeRecord is DELETED, not given an invented "
          f"'rejected' status value not present in Vol 13_0 §11's own enum (header note 6)")

    # =================================================================
    # C. Leave: type/balance setup, submission leaves balance untouched,
    # approval deducts it, insufficient-balance guard, rejection keeps
    # the row (LeaveApplication DOES have a real 'rejected' status).
    # =================================================================
    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "C: Sales Agent cannot configure a leave type", cur, conn,
        lambda: cur.execute("select public.create_leave_type(%s,'Annual Leave',14)", (biz,)),
        contains="not_authorized",
    )

    as_user(cur, payroll_admin_user)
    cur.execute("select id from public.create_leave_type(%s,'Annual Leave',14)", (biz,))
    leave_type_id = cur.fetchone()[0]
    conn.commit()

    cur.execute("select entitled_days from public.grant_leave_balance(%s,%s,2026)", (emp1_party_id, leave_type_id))
    ent1 = cur.fetchone()[0]
    cur.execute(
        "select entitled_days from public.grant_leave_balance(%s,%s,2026,10)", (emp2_party_id, leave_type_id),
    )
    ent2 = cur.fetchone()[0]
    conn.commit()
    ok = float(ent1) == 14.00 and float(ent2) == 10.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: grant_leave_balance defaults to the leave type's own "
          f"default_entitlement_days (14) when not overridden, and honours an explicit override (10) — "
          f"got {ent1}, {ent2}")

    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "C: Sales Agent cannot submit a leave application", cur, conn,
        lambda: cur.execute(
            "select public.create_leave_application(%s,%s,%s,'2026-09-20','2026-09-24')",
            (biz, emp1_party_id, leave_type_id),
        ),
        contains="not_authorized",
    )

    as_user(cur, payroll_admin_user)
    cur.execute(
        "select id, status from public.create_leave_application(%s,%s,%s,'2026-09-20','2026-09-24')",
        (biz, emp1_party_id, leave_type_id),
    )
    leave1_id, leave1_status = cur.fetchone()
    conn.commit()
    ok = leave1_status == 'pending_approval'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: 5-day leave application starts 'pending_approval'")

    as_superuser(cur)
    cur.execute(
        "select used_days from public.leave_balances where employee_party_id=%s and leave_type_id=%s and year=2026",
        (emp1_party_id, leave_type_id),
    )
    ok = float(cur.fetchone()[0]) == 0.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: used_days is STILL 0.00 immediately after submission alone — "
          f"balance is not touched until approval (this sprint's own explicit DoD requirement)")

    decide_pending_task(cur, conn, 'leave_application', leave1_id, owner, 'approved')
    as_superuser(cur)
    cur.execute(
        "select status, approved_by, used_days from public.leave_applications la "
        "join public.leave_balances lb on lb.employee_party_id=la.employee_party_id "
        "and lb.leave_type_id=la.leave_type_id and lb.year=2026 where la.id=%s",
        (leave1_id,),
    )
    status1, approved_by1, used1 = cur.fetchone()
    ok = status1 == 'approved' and approved_by1 == om_owner and float(used1) == 5.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: on approval, LeaveApplication flips to 'approved' (approved_by set) "
          f"and used_days becomes 5.00 (5 inclusive days, Sep 20-24) — got status={status1!r}, "
          f"approved_by matches owner={approved_by1 == om_owner}, used_days={used1}")

    as_user(cur, payroll_admin_user)
    all_passed &= expect_error(
        "C: a leave application exceeding the remaining balance (14-5=9 available, 12 requested) is rejected",
        cur, conn,
        lambda: cur.execute(
            "select public.create_leave_application(%s,%s,%s,'2026-10-01','2026-10-12')",
            (biz, emp1_party_id, leave_type_id),
        ),
        contains="insufficient_leave_balance",
    )

    cur.execute(
        "select id from public.create_leave_application(%s,%s,%s,'2026-09-25','2026-09-26')",
        (biz, emp2_party_id, leave_type_id),
    )
    leave2_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'leave_application', leave2_id, owner, 'rejected')
    as_superuser(cur)
    cur.execute(
        "select la.status, lb.used_days from public.leave_applications la "
        "join public.leave_balances lb on lb.employee_party_id=la.employee_party_id "
        "and lb.leave_type_id=la.leave_type_id and lb.year=2026 where la.id=%s",
        (leave2_id,),
    )
    status2, used2 = cur.fetchone()
    ok = status2 == 'rejected' and float(used2) == 0.00
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] C: on rejection, LeaveApplication keeps its OWN 'rejected' status "
          f"(a real value in its literal enum, unlike OvertimeRecord/CommissionCalculation) and employee 2's "
          f"balance stays untouched — got status={status2!r}, used_days={used2}")

    # =================================================================
    # D. Commission: 3 basis types, agent-specific-vs-default resolution
    # order, trigger-status guard, no-agent guard, double-compute guard,
    # rejection deletes the row.
    # =================================================================
    as_user(cur, owner)
    cur.execute(
        "select id from public.create_party(%s,'Agent One',null,%s,null,null,null,'+60163333333',null,null,null,0)",
        (biz, ["agent"]),
    )
    agent1_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_party(%s,'Agent Two',null,%s,null,null,null,'+60164444444',null,null,null,0)",
        (biz, ["agent"]),
    )
    agent2_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_party(%s,'Agent Three',null,%s,null,null,null,'+60165555555',null,null,null,0)",
        (biz, ["agent"]),
    )
    agent3_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_party(%s,'Commission Test Customer',null,%s,null,null,null,'+60166666666',"
        "null,null,null,0)",
        (biz, ["customer"]),
    )
    cust_id = cur.fetchone()[0]
    conn.commit()

    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "D: Sales Agent (commission view only) cannot configure a commission rule", cur, conn,
        lambda: cur.execute(
            "select public.create_commission_rule(%s,'percent_of_invoice',0.05)", (biz,),
        ),
        contains="not_authorized",
    )

    as_user(cur, owner)
    cur.execute("select id from public.create_commission_rule(%s,'percent_of_invoice',0.05)", (biz,))
    default_rule_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_commission_rule(%s,'percent_of_margin',0.20,%s)", (biz, agent1_id),
    )
    agent1_rule_id = cur.fetchone()[0]
    cur.execute(
        "select id from public.create_commission_rule(%s,'flat_per_unit',3.00,%s)", (biz, agent3_id),
    )
    agent3_rule_id = cur.fetchone()[0]
    conn.commit()

    # Invoice 1: agent 1 has a specific percent_of_margin rule — must be
    # preferred over the business-wide percent_of_invoice default.
    invoice1_id, invoice1_total = make_invoice(
        cur, conn, owner, biz, cust_id, [{"description": "Widget A", "quantity": 10, "unit_price": 50}],
    )
    as_superuser(cur)
    cur.execute("update public.invoice_lines set unit_cost=30 where invoice_id=%s", (invoice1_id,))
    conn.commit()
    as_user(cur, owner)
    cur.execute("select public.assign_invoice_agent(%s,%s)", (invoice1_id, agent1_id))
    conn.commit()

    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "D: Sales Agent (no capture on commission) cannot compute a commission calculation", cur, conn,
        lambda: cur.execute("select public.compute_commission_for_invoice(%s)", (invoice1_id,)),
        contains="not_authorized",
    )

    as_user(cur, owner)
    cur.execute(
        "select amount, commission_rule_id, status from public.compute_commission_for_invoice(%s)", (invoice1_id,),
    )
    comm1_amount, comm1_rule, comm1_status = cur.fetchone()
    conn.commit()
    # margin = 500 (grand_total) - 30*10 (unit_cost*qty) = 200; 200*0.20 = 40.00
    ok = float(comm1_amount) == 40.00 and comm1_rule == agent1_rule_id and comm1_status == 'computed'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D (percent_of_margin, agent-specific rule preferred over business "
          f"default): invoice1 margin (500 - 30*10 = 200) x 20% = RM40.00 — got amount={comm1_amount}, "
          f"used agent-specific rule={comm1_rule == agent1_rule_id}")

    all_passed &= expect_error(
        "D: computing commission twice for the same invoice is rejected", cur, conn,
        lambda: cur.execute("select public.compute_commission_for_invoice(%s)", (invoice1_id,)),
        contains="commission_already_computed",
    )

    # Invoice 2: agent 2 has NO specific rule — falls back to the
    # business-wide percent_of_invoice default.
    invoice2_id, invoice2_total = make_invoice(
        cur, conn, owner, biz, cust_id, [{"description": "Widget B", "quantity": 4, "unit_price": 125}],
    )
    as_user(cur, owner)
    cur.execute("select public.assign_invoice_agent(%s,%s)", (invoice2_id, agent2_id))
    conn.commit()
    cur.execute("select amount, commission_rule_id from public.compute_commission_for_invoice(%s)", (invoice2_id,))
    comm2_amount, comm2_rule = cur.fetchone()
    conn.commit()
    # 500 (grand_total) * 5% = 25.00
    ok = float(comm2_amount) == 25.00 and comm2_rule == default_rule_id
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D (percent_of_invoice, business-wide default rule used when the "
          f"agent has none of their own): invoice2 500 x 5% = RM25.00 — got amount={comm2_amount}, "
          f"used default rule={comm2_rule == default_rule_id}")

    # Invoice 3: agent 3 has a flat_per_unit rule.
    invoice3_id, invoice3_total = make_invoice(
        cur, conn, owner, biz, cust_id,
        [{"description": "Widget C", "quantity": 5, "unit_price": 20}, {"description": "Widget D", "quantity": 7, "unit_price": 20}],
    )
    as_user(cur, owner)
    cur.execute("select public.assign_invoice_agent(%s,%s)", (invoice3_id, agent3_id))
    conn.commit()
    cur.execute("select amount, commission_rule_id from public.compute_commission_for_invoice(%s)", (invoice3_id,))
    comm3_amount, comm3_rule = cur.fetchone()
    conn.commit()
    # total qty = 12 units x RM3.00 = 36.00
    ok = float(comm3_amount) == 36.00 and comm3_rule == agent3_rule_id
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D (flat_per_unit): invoice3 12 units x RM3.00 = RM36.00 — "
          f"got amount={comm3_amount}, used agent-specific rule={comm3_rule == agent3_rule_id}")

    # Guards: no agent assigned, trigger-status mismatch.
    invoice4_id, invoice4_total = make_invoice(
        cur, conn, owner, biz, cust_id, [{"description": "Widget E", "quantity": 2, "unit_price": 50}],
    )
    all_passed &= expect_error(
        "D: an invoice with no assigned agent cannot have commission computed", cur, conn,
        lambda: cur.execute("select public.compute_commission_for_invoice(%s)", (invoice4_id,)),
        contains="invoice_has_no_assigned_agent",
    )

    invoice5_id, invoice5_total = make_invoice(
        cur, conn, owner, biz, cust_id, [{"description": "Widget F", "quantity": 3, "unit_price": 50}],
    )
    as_user(cur, owner)
    cur.execute("select public.assign_invoice_agent(%s,%s)", (invoice5_id, agent1_id))
    conn.commit()
    as_superuser(cur)
    cur.execute("update public.invoices set status='paid' where id=%s", (invoice5_id,))  # business trigger stays 'issued'
    conn.commit()
    as_user(cur, owner)
    all_passed &= expect_error(
        "D: an invoice whose status has moved past the business's configured trigger point "
        "('paid' vs configured 'issued') is rejected, not silently computed anyway", cur, conn,
        lambda: cur.execute("select public.compute_commission_for_invoice(%s)", (invoice5_id,)),
        contains="has_not_reached_the_configured_commission_trigger_status",
    )

    # Approve/pay the three real commission calculations for the
    # dashboard test (section F) to sum. (The ApprovalTask's subject_id
    # is the commission_calculation's own id, not the invoice id.)
    as_superuser(cur)
    cur.execute("select id from public.commission_calculations where invoice_id=%s", (invoice1_id,))
    comm1_id = cur.fetchone()[0]
    decide_pending_task(cur, conn, 'commission_calculation', comm1_id, owner, 'approved')
    as_user(cur, owner)
    cur.execute("select status from public.mark_commission_paid(%s)", (comm1_id,))
    comm1_paid_status = cur.fetchone()[0]
    conn.commit()
    ok = comm1_paid_status == 'paid'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: commission 1 approved then mark_commission_paid moves it to 'paid'")

    as_superuser(cur)
    cur.execute("select id from public.commission_calculations where invoice_id=%s", (invoice2_id,))
    comm2_id = cur.fetchone()[0]
    cur.execute("select id from public.commission_calculations where invoice_id=%s", (invoice3_id,))
    comm3_id = cur.fetchone()[0]
    decide_pending_task(cur, conn, 'commission_calculation', comm2_id, owner, 'approved')
    decide_pending_task(cur, conn, 'commission_calculation', comm3_id, owner, 'approved')

    # Rejection deletes the row (header note 6) — a throwaway 6th invoice.
    invoice6_id, invoice6_total = make_invoice(
        cur, conn, owner, biz, cust_id, [{"description": "Widget G", "quantity": 4, "unit_price": 20}],
    )
    as_user(cur, owner)
    cur.execute("select public.assign_invoice_agent(%s,%s)", (invoice6_id, agent1_id))
    cur.execute("select id from public.compute_commission_for_invoice(%s)", (invoice6_id,))
    comm6_id = cur.fetchone()[0]
    conn.commit()
    decide_pending_task(cur, conn, 'commission_calculation', comm6_id, owner, 'rejected')
    as_superuser(cur)
    cur.execute("select count(*) from public.commission_calculations where id=%s", (comm6_id,))
    ok = cur.fetchone()[0] == 0
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] D: a rejected CommissionCalculation is DELETED, not given an invented "
          f"'rejected' status value not present in Vol 13_0 §11's own enum (header note 6)")

    # =================================================================
    # E. Overtime -> PayrollRun sync: gross_pay includes overtime pay,
    # statutory is computed on the OT-inclusive gross, and both
    # OvertimeRecords flip to 'synced_to_payroll'.
    # =================================================================
    as_user(cur, payroll_admin_user)
    cur.execute("select id, total_net_pay from public.create_payroll_run(%s,'2026-09')", (biz,))
    run_id, total_net_pay = cur.fetchone()
    conn.commit()

    cur.execute(
        "select employee_party_id, gross_pay, epf_employee, socso_employee, eis_employee, pcb_deduction, net_pay "
        "from public.payslips where payroll_run_id=%s", (run_id,),
    )
    payslip_rows = {r[0]: r for r in cur.fetchall()}
    conn.commit()

    ps1 = payslip_rows[emp1_party_id]
    # emp1: basic 5200, hourly 5200/208=25.00, 2h OT x 1.5 = 75.00 -> gross 5275.00
    expected_gross1 = 5275.00
    exp1 = reference_statutory(expected_gross1)
    expected_net1 = expected_gross1 - exp1["epf_employee"] - exp1["socso_employee"] - exp1["eis_employee"] - exp1["pcb_deduction"]
    ok = float(ps1[1]) == expected_gross1 and round(float(ps1[6]), 2) == round(expected_net1, 2)
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] E: employee 1's payslip gross_pay = 5200 basic + (2h x RM25.00/h x 1.5) "
          f"= RM{expected_gross1:.2f}, statutory computed against the OT-inclusive gross, net_pay={ps1[6]} "
          f"matches hand-computed {expected_net1:.2f} — got gross={ps1[1]}")

    ps2 = payslip_rows[emp2_party_id]
    # emp2: basic 4160, hourly 4160/208=20.00, 3h OT x 1.5 = 90.00 -> gross 4250.00
    expected_gross2 = 4250.00
    exp2 = reference_statutory(expected_gross2)
    expected_net2 = expected_gross2 - exp2["epf_employee"] - exp2["socso_employee"] - exp2["eis_employee"] - exp2["pcb_deduction"]
    ok = float(ps2[1]) == expected_gross2 and round(float(ps2[6]), 2) == round(expected_net2, 2)
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] E (irregular schedule employee): employee 2's payslip gross_pay = 4160 "
          f"basic + (3h x RM20.00/h x 1.5) = RM{expected_gross2:.2f}, net_pay={ps2[6]} matches hand-computed "
          f"{expected_net2:.2f} — got gross={ps2[1]}")

    as_superuser(cur)
    cur.execute("select status from public.overtime_records where id in (%s,%s)", (ot1_id, ot2_id))
    statuses = {r[0] for r in cur.fetchall()}
    ok = statuses == {'synced_to_payroll'}
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] E: both approved OvertimeRecords flip to 'synced_to_payroll' once "
          f"swept into the PayrollRun — got {statuses}")

    # Move the run to 'approved' so the dashboard (status in approved/paid) counts it.
    as_user(cur, payroll_admin_user)
    cur.execute("select status from public.submit_payroll_run(%s)", (run_id,))
    conn.commit()
    decide_pending_task(cur, conn, 'payroll_run', run_id, owner, 'approved')
    as_superuser(cur)
    cur.execute("select status, total_net_pay from public.payroll_runs where id=%s", (run_id,))
    run_status, run_total_net_pay = cur.fetchone()
    ok = run_status == 'approved'
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] E: PayrollRun reaches 'approved' status (feeds section F's dashboard)")

    # =================================================================
    # F. Dashboard: revenue vs. payroll cost vs. commission cost for
    # the test period, checked against an independently-summed
    # reference built from the fixture data above (not copied from
    # the SQL function's own aggregation logic).
    # =================================================================
    as_user(cur, sales_agent_user)
    all_passed &= expect_error(
        "F: Sales Agent (no accounting_reports grant) cannot view the dashboard", cur, conn,
        lambda: cur.execute(
            "select * from public.revenue_vs_cost_dashboard(%s,'2026-09-01','2026-09-30')", (biz,),
        ),
        contains="not_authorized",
    )

    as_user(cur, owner)
    cur.execute(
        "select revenue, payroll_cost, commission_cost, net from public.revenue_vs_cost_dashboard"
        "(%s,'2026-09-01','2026-09-30')", (biz,),
    )
    dash_revenue, dash_payroll_cost, dash_commission_cost, dash_net = cur.fetchone()
    conn.commit()

    expected_revenue = round(
        float(invoice1_total) + float(invoice2_total) + float(invoice3_total)
        + float(invoice4_total) + float(invoice5_total) + float(invoice6_total), 2,
    )
    expected_payroll_cost = round(float(run_total_net_pay), 2)  # this run is independently verified in section E
    expected_commission_cost = round(40.00 + 25.00 + 36.00, 2)  # invoices 1 (paid), 2, 3 (approved) — 6 rejected/deleted, 4/5 never computed
    expected_net = round(expected_revenue - expected_payroll_cost - expected_commission_cost, 2)

    ok = (
        round(float(dash_revenue), 2) == expected_revenue
        and round(float(dash_payroll_cost), 2) == expected_payroll_cost
        and round(float(dash_commission_cost), 2) == expected_commission_cost
        and round(float(dash_net), 2) == expected_net
    )
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] F: revenue_vs_cost_dashboard for Sep 2026 — revenue={dash_revenue} "
          f"(expected {expected_revenue}), payroll_cost={dash_payroll_cost} (expected {expected_payroll_cost}), "
          f"commission_cost={dash_commission_cost} (expected {expected_commission_cost}), net={dash_net} "
          f"(expected {expected_net})")

    print()
    print("ALL PASSED" if all_passed else "SOME FAILED")
    print()
    print("REMINDER: DoD item 1 (GPS clock-in/out verified via a real airplane-mode/offline-queue device")
    print("test) could not be performed by this session — see the migration's own header note 1 and the")
    print("Sprint 35 doc's Outcomes. Overtime pay constants (26 days x 8h, 1.5x multiplier) are a disclosed,")
    print("assumed convention, not a verified statutory requirement.")
    conn.close()
    return 0 if all_passed else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
