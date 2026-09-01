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
import time

DSN = "host=127.0.0.1 port=5432 dbname=aifa_test user=postgres password=testpass123"
BIZ_B = "bbbbbbbb-0000-0000-0000-000000000002"
EXPECTED_TOKEN = "36856f91-3e5e-489f-814d-d50847c1217f"

results = {}
barrier = threading.Barrier(2)

def activate(device_id, key):
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("set role aifa_app_role")
    cur.execute("select set_config('app.current_user_id', %s, false)", (BIZ_B,))
    barrier.wait()  # force both threads to attempt the RPC at (as close to) the same instant
    try:
        cur.execute(
            "select active_device_id, lock_token from public.request_activation(%s, %s, %s::uuid)",
            (device_id, 2, EXPECTED_TOKEN),
        )
        row = cur.fetchone()
        results[key] = ("SUCCESS", row)
    except Exception as e:
        results[key] = ("REJECTED", str(e))
    finally:
        cur.close()
        conn.close()

def run_race(trial_num):
    global results
    results = {}
    t1 = threading.Thread(target=activate, args=("biz-b-dev-race-1", "race1"))
    t2 = threading.Thread(target=activate, args=("biz-b-dev-race-2", "race2"))
    global barrier
    barrier = threading.Barrier(2)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    successes = [k for k, v in results.items() if v[0] == "SUCCESS"]
    rejections = [k for k, v in results.items() if v[0] == "REJECTED"]
    print(f"\n--- Trial {trial_num} ---")
    for k, v in results.items():
        print(f"  {k}: {v}")
    assert len(successes) == 1, f"FAIL trial {trial_num}: expected exactly 1 success, got {len(successes)}"
    assert len(rejections) == 1, f"FAIL trial {trial_num}: expected exactly 1 rejection, got {len(rejections)}"
    print(f"  PASS: exactly one success ({successes[0]}), exactly one rejection ({rejections[0]})")
    return successes[0]

# Reset lock to a known state before each trial (simulate re-observing the same starting token)
def reset_lock_to_dev1():
    # Runs as postgres superuser (bypasses RLS/grants) — this is test
    # scaffolding to reset state between trials, not something the app
    # role could or should do directly.
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "update active_device_lock set active_device_id = 'biz-b-dev-1', lock_token = %s::uuid where business_id = %s",
        (EXPECTED_TOKEN, BIZ_B),
    )
    cur.close()
    conn.close()

NUM_TRIALS = 5
winners = []
for i in range(1, NUM_TRIALS + 1):
    reset_lock_to_dev1()
    winner = run_race(i)
    winners.append(winner)

print(f"\n=== ALL {NUM_TRIALS} TRIALS PASSED: exactly one success + one rejection every time ===")
print(f"Winners per trial: {winners}")
