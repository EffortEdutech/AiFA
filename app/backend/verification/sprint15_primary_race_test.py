# NOTE: this script was run in the Claude session's own sandboxed Postgres instance
# (simulated auth.users/auth.uid(), matching Sprint 14's verification setup), NOT
# against this project's real local Supabase (different port/credentials, and no
# seeded devices/business fixtures). It is committed as a reproducible record of
# how Sprint 15's atomicity claims were verified, not as a ready-to-run tool
# against your own instance -- to adapt it: point DSN at
# postgresql://postgres:postgres@127.0.0.1:54322/postgres, sign up a real test
# user via Supabase Auth, call register_device() twice for two device ids, and
# swap the hardcoded business_id/device_id/token literals below for your own.

import psycopg2
import threading

DSN = "host=127.0.0.1 port=5432 dbname=aifa_test user=postgres password=testpass123"
BIZ_B = "bbbbbbbb-0000-0000-0000-000000000002"

# biz-b-dev-1 is primary (the original first-registered device for business B)
# biz-b-dev-race-1 is an ordinary, non-primary device
results = {}

def ordinary_activate(expected_token, key, barrier):
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("set role aifa_app_role")
    cur.execute("select set_config('app.current_user_id', %s, false)", (BIZ_B,))
    barrier.wait()
    try:
        cur.execute(
            "select active_device_id from public.request_activation(%s, %s, %s::uuid)",
            ("biz-b-dev-race-1", 2, expected_token),
        )
        results[key] = ("SUCCESS", cur.fetchone())
    except Exception as e:
        results[key] = ("REJECTED", str(e).split(chr(10))[0])
    cur.close()
    conn.close()

def primary_takeover(key, barrier):
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("set role aifa_app_role")
    cur.execute("select set_config('app.current_user_id', %s, false)", (BIZ_B,))
    barrier.wait()
    try:
        cur.execute(
            "select active_device_id from public.request_primary_takeover(%s, %s)",
            ("biz-b-dev-1", 2),
        )
        results[key] = ("SUCCESS", cur.fetchone())
    except Exception as e:
        results[key] = ("REJECTED", str(e).split(chr(10))[0])
    cur.close()
    conn.close()

def reset_lock(token):
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "update active_device_lock set active_device_id = 'biz-b-dev-race-1', lock_token = %s::uuid where business_id = %s",
        (token, BIZ_B),
    )
    cur.close()
    conn.close()

def get_current_token():
    conn = psycopg2.connect(DSN)
    cur = conn.cursor()
    cur.execute("select lock_token, active_device_id from active_device_lock where business_id = %s", (BIZ_B,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row

NUM_TRIALS = 5
final_holders = []
for i in range(1, NUM_TRIALS + 1):
    token, current_active = get_current_token()
    reset_lock(str(token))  # keep dev-race-1 as current active holder, known token
    results.clear()
    barrier = threading.Barrier(2)
    t1 = threading.Thread(target=ordinary_activate, args=(str(token), "ordinary", barrier))
    t2 = threading.Thread(target=primary_takeover, args=("primary", barrier))
    t1.start(); t2.start()
    t1.join(); t2.join()

    final_token, final_active = get_current_token()
    print(f"\n--- Trial {i} ---")
    for k, v in results.items():
        print(f"  {k}: {v}")
    print(f"  final active device: {final_active}")
    assert final_active == "biz-b-dev-1", f"FAIL trial {i}: primary should always be the final active device, got {final_active}"
    final_holders.append(final_active)

print(f"\n=== ALL {NUM_TRIALS} TRIALS: primary device ended up active every time, regardless of race outcome ===")
print(f"Final holders: {final_holders}")
