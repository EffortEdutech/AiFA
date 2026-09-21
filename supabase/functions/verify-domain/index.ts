// Sprint 65 -- Domain Binding (Architecture.md §2.4).
//
// Performs a live DNS-over-HTTPS TXT lookup for a domain and, if the
// configured verification_token is found, flips that domains row to
// verified. Two invocation modes, distinguished by the caller's JWT role
// claim (both satisfy the platform's verify_jwt gate, since anon/service
// keys are themselves valid signed JWTs -- this project's own established
// pattern for a cron-callable function that never needs a real user):
//
//   - role === "authenticated" + body.domainId: the "Check now" button.
//     Caller must be an active member with settings:configure for that
//     domain's business (checked here server-side, mirrors add_domain()'s
//     own gate) -- a rejection surfaces as a 403.
//   - role === "anon" (the project's own public anon key, not a real
//     visitor -- only pg_cron calls this function with it) + no body:
//     scheduled re-check batch mode. Rechecks every still-pending domain.
//
// Writes always go through a service-role client (SUPABASE_SERVICE_ROLE_KEY
// is a platform-injected env var inside every edge function -- never
// handled or printed by us) because the domains table has no UPDATE policy
// for any role, by design (see the Sprint 65 migration's own comment).

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function decodeJwtRole(authHeader: string | null): { role: string | null; sub: string | null } {
  if (!authHeader) return { role: null, sub: null };
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return { role: null, sub: null };
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { role: payload.role ?? null, sub: payload.sub ?? null };
  } catch {
    return { role: null, sub: null };
  }
}

interface DnsAnswer {
  name: string;
  type: number;
  data: string;
}

async function txtRecordsFor(domain: string): Promise<string[]> {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=TXT`,
    { headers: { accept: "application/dns-json" } },
  );
  if (!res.ok) return [];
  const json = await res.json();
  const answers: DnsAnswer[] = json.Answer ?? [];
  return answers
    .filter((a) => a.type === 16)
    .map((a) => a.data.replace(/^"|"$/g, ""));
}

async function checkOneDomain(
  admin: ReturnType<typeof createClient>,
  row: { id: string; domain: string; verification_token: string },
): Promise<boolean> {
  let verified = false;
  try {
    const txts = await txtRecordsFor(row.domain);
    verified = txts.includes(row.verification_token);
  } catch {
    verified = false;
  }
  const patch: Record<string, unknown> = { last_checked_at: new Date().toISOString() };
  if (verified) {
    patch.verification_status = "verified";
    patch.verified_at = new Date().toISOString();
  }
  // Sprint 66 fix: this write was silently failing on every cron run since
  // Sprint 65 (service_role had no UPDATE grant on `domains` until the
  // sprint66_grant_service_role_public_homepage_reads migration) and this
  // call never checked or logged its own error, so the failure was
  // invisible. Now checked and logged so a future failure of a *different*
  // kind (e.g. a bad patch value) surfaces instead of failing silently.
  const { error: updateErr } = await admin.from("domains").update(patch).eq("id", row.id);
  if (updateErr) {
    console.error(`domains update failed for ${row.id} (${row.domain}):`, updateErr);
  }
  return verified;
}

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { role, sub } = decodeJwtRole(req.headers.get("authorization"));

  let body: { domainId?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    if (body.domainId) {
      if (role !== "authenticated" || !sub) {
        return new Response(JSON.stringify({ error: "unauthenticated" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { data: domainRow, error: fetchErr } = await admin
        .from("domains")
        .select("id, business_id, domain, verification_token, verification_status")
        .eq("id", body.domainId)
        .maybeSingle();
      if (fetchErr || !domainRow) {
        return new Response(JSON.stringify({ error: "domain_not_found" }), {
          status: 404,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { data: isMember } = await admin
        .from("business_memberships")
        .select("role_id, role_permissions:role_permissions!inner(domain, capability)")
        .eq("business_id", domainRow.business_id)
        .eq("user_id", sub)
        .eq("status", "active")
        .eq("role_permissions.domain", "settings")
        .eq("role_permissions.capability", "configure")
        .maybeSingle();
      if (!isMember) {
        return new Response(JSON.stringify({ error: "requires_settings_configure" }), {
          status: 403,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const verified = domainRow.verification_status === "verified"
        ? true
        : await checkOneDomain(admin, domainRow);
      return new Response(JSON.stringify({ domainId: domainRow.id, verified }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (role !== "anon" && role !== "service_role") {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const { data: pending } = await admin
      .from("domains")
      .select("id, domain, verification_token")
      .eq("verification_status", "pending");
    let checked = 0;
    let verifiedCount = 0;
    for (const row of pending ?? []) {
      checked++;
      if (await checkOneDomain(admin, row)) verifiedCount++;
    }
    return new Response(JSON.stringify({ mode: "batch", checked, verified: verifiedCount }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
