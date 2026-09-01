# NOTE: same posture as app/backend/verification/sprint15_concurrency_test.py --
# run against this Claude session's own sandboxed Postgres instance (simulated
# auth.users/auth.uid(), aifa_app_role), NOT this project's real local Supabase.
# Committed as a reproducible record of how Sprint 19's cross-platform device
# registry claims were verified, not a ready-to-run tool against your own
# instance. To adapt: point DSN at your local Supabase Postgres, sign up a real
# test user, register two real devices for that business, and swap the
# hardcoded business_id/device_id literals below for your own.
#
# What this proves: mobile's app/src/db/syncService.ts and web's
# web/src/lib/syncService.ts both reduce, at the protocol level, to RPC/query
# callers against the SAME Postgres functions and tables -- @aifa/core/sync/
# supabaseTransport.ts's whole point this sprint. Two independent psycopg2
# sessions below stand in for "mobile" and "web" (there is no real mobile/web
# client runtime in this sandbox), each issuing the exact SQL the shared
# transport issues (same RPC names, same parameter names, same `.from()`
# query shape) against business_id aaaaaaaa-0000-0000-0000-000000000001 (the
# same fixture Sprint 14/15 already seeded two devices for: biz-a-dev-1,
# biz-a-dev-2/primary). A THIRD device is registered here to have a safe
# device to rename/revoke without touching those two fixtures' state for any
# other verification script that might run against this same sandbox DB later
# in the session.

import psycopg2

DSN = "host=127.0.0.1 port=5432 dbname=aifa_test user=postgres password=testpass123"
BIZ_A = "aaaaaaaa-0000-0000-0000-000000000001"
NEW_DEVICE_ID = "biz-a-dev-cross-platform-test"


def session(label):
    """A fresh connection + role/auth.uid() setup, standing in for one platform's own Supabase client."""
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("set role aifa_app_role")
    cur.execute("select set_config('app.current_user_id', %s, false)", (BIZ_A,))
    return conn, cur


def rpc(cur, fn_call, params):
    cur.execute(fn_call, params)
    return cur.fetchone()


def get_all_devices(cur, business_id):
    # Mirrors supabaseTransport.ts's getAllDevices: no revoked_at filter.
    cur.execute(
        "select device_id, device_label, is_primary, revoked_at from public.devices "
        "where business_id = %s order by registered_at",
        (business_id,),
    )
    return cur.fetchall()


def get_registered_devices(cur, business_id):
    # Mirrors supabaseTransport.ts's getRegisteredDevices: revoked_at is null.
    cur.execute(
        "select device_id, device_label, is_primary, revoked_at from public.devices "
        "where business_id = %s and revoked_at is null order by registered_at",
        (business_id,),
    )
    return cur.fetchall()


passed = []


def check(label, condition):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}")
    passed.append(condition)
    if not condition:
        raise AssertionError(label)


print("=== Sprint 19 cross-platform device-registry consistency ===\n")

def admin_cleanup():
    # Runs as postgres superuser, same pattern as sprint15_concurrency_test.py's
    # reset_lock_to_dev1 -- test scaffolding only, not something the app role
    # could or should do directly (RLS/grants correctly block it, confirmed by
    # this script's own earlier failed attempt to delete as aifa_app_role).
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("delete from public.devices where device_id = %s", (NEW_DEVICE_ID,))
    cur.close()
    conn.close()


admin_cleanup()  # idempotent re-run safety

print("Step 1 -- 'mobile' session registers a new device")
mobile_conn, mobile_cur = session("mobile")
row = rpc(
    mobile_cur,
    "select device_id, device_label, is_primary, revoked_at from public.register_device(%s, %s, %s)",
    (NEW_DEVICE_ID, "android", "Cross-Platform Test Device"),
)
check("register_device returned the new row", row[0] == NEW_DEVICE_ID and row[1] == "Cross-Platform Test Device")

print("\nStep 2 -- independent 'web' session sees it immediately (no caching layer between platforms)")
web_conn, web_cur = session("web")
web_devices = {d[0]: d for d in get_all_devices(web_cur, BIZ_A)}
check("web session's getAllDevices includes the mobile-registered device", NEW_DEVICE_ID in web_devices)
check("label matches what mobile set", web_devices[NEW_DEVICE_ID][1] == "Cross-Platform Test Device")

print("\nStep 3 -- 'web' session renames it (rename_device RPC)")
row = rpc(
    web_cur,
    "select device_id, device_label from public.rename_device(%s, %s)",
    (NEW_DEVICE_ID, "Renamed From Web"),
)
check("rename_device returned the new label", row[1] == "Renamed From Web")

print("\nStep 4 -- independent 'mobile' session sees the rename")
mobile_devices = {d[0]: d for d in get_all_devices(mobile_cur, BIZ_A)}
check("mobile session sees the web-issued rename", mobile_devices[NEW_DEVICE_ID][1] == "Renamed From Web")

print("\nStep 5 -- 'mobile' session revokes it (device is neither active nor primary, no replacement needed)")
row = rpc(
    mobile_cur,
    "select device_id, revoked_at from public.revoke_device(%s)",
    (NEW_DEVICE_ID,),
)
check("revoke_device set revoked_at", row[1] is not None)

print("\nStep 6 -- independent 'web' session's getRegisteredDevices (revoked-filtered) excludes it, getAllDevices still shows it as Revoked")
web_registered = {d[0] for d in get_registered_devices(web_cur, BIZ_A)}
web_all = {d[0]: d for d in get_all_devices(web_cur, BIZ_A)}
check("getRegisteredDevices (action-target picker query) excludes the revoked device", NEW_DEVICE_ID not in web_registered)
check("getAllDevices (Devices panel listing query) still includes it, revoked_at set", web_all[NEW_DEVICE_ID][3] is not None)

print("\nStep 7 -- a revoked device can never again pass a revoked_at-is-null RPC guard, from either platform")
for label, cur in (("mobile", mobile_cur), ("web", web_cur)):
    try:
        cur.execute(
            "select public.request_activation(%s, %s, %s)",
            (NEW_DEVICE_ID, 0, None),
        )
        raise AssertionError(f"{label}: request_activation should have been rejected for a revoked device")
    except psycopg2.errors.RaiseException:
        print(f"  [PASS] {label} session: request_activation correctly rejected for the revoked device")

# cleanup -- leave the sandbox DB as close to its pre-script state as possible
mobile_conn.close()
web_conn.close()
admin_cleanup()

print(f"\n=== {sum(passed)}/{len(passed)} checks passed ===")
print("ALL CROSS-PLATFORM CONSISTENCY CHECKS PASSED" if all(passed) else "SOME CHECKS FAILED")
