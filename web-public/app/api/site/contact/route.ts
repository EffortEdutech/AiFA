// AiFA Public Site -- contact form submission endpoint. Ports the POST
// branch of supabase/functions/public-homepage/index.ts's Deno.serve
// handler: calls the same, unchanged submit_public_request() RPC (Sprint
// 68 wires accepted submissions into the Approval Task pipeline). Runs
// with the anon key only, same as the page itself -- the RPC does its own
// SECURITY DEFINER-gated write, no service-role key needed here.
import { NextRequest, NextResponse } from "next/server";

import { getPublicSupabaseClient } from "../../../../lib/supabasePublic";

interface ContactBody {
  businessId?: string;
  name?: string;
  email?: string;
  message?: string;
}

export async function POST(req: NextRequest) {
  let body: ContactBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!body.businessId) {
    return NextResponse.json({ error: "missing_business_id" }, { status: 400 });
  }

  const supabase = getPublicSupabaseClient();
  const { error } = await supabase.rpc("submit_public_request", {
    p_business_id: body.businessId,
    p_request_type: "contact",
    p_payload: { name: body.name, email: body.email, message: body.message },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
