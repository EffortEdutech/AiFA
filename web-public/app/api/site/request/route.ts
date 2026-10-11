// AiFA Public Site -- customer request intake (Sprint 68a). Replaces the old
// /api/site/contact route. Browser-side checks are a convenience only: every
// rule is enforced again inside submit_public_request_v2(), which is the only
// way a visitor can create a request.
import { NextRequest, NextResponse } from "next/server";

import { internationalDigits } from "../../../../lib/contact";
import { REQUEST_ERRORS, hashIp } from "../../../../lib/requests";
import { getPublicSupabaseClient } from "../../../../lib/supabasePublic";

const MIN_FORM_MS = 3000; // a person cannot fill in this form faster

interface Body {
  businessId?: string;
  type?: string;
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  consent?: boolean;
  items?: { description?: string; quantity?: string }[];
  neededBy?: string;
  deliveryArea?: string;
  source?: string;
  website?: string; // honeypot: real visitors never see or fill this
  elapsedMs?: number;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!body.businessId || (body.type !== "contact" && body.type !== "rfq")) {
    return NextResponse.json({ error: "request_failed", message: REQUEST_ERRORS.request_failed }, { status: 400 });
  }

  // Honeypot filled: pretend it worked so a bot learns nothing.
  if (body.website) {
    return NextResponse.json({ ok: true, reference_code: "RQ-000000", tracking_token: null });
  }
  if (typeof body.elapsedMs === "number" && body.elapsedMs < MIN_FORM_MS) {
    return NextResponse.json(
      { error: "too_fast", message: "That was quick. Please check your details and send again." },
      { status: 429 },
    );
  }

  const phone = internationalDigits(str(body.phone, 30));
  if (!phone) {
    return NextResponse.json({ error: "invalid_phone", message: REQUEST_ERRORS.invalid_phone }, { status: 400 });
  }

  const fields: Record<string, unknown> = {
    name: str(body.name, 100),
    phone,
    email: str(body.email, 254),
    message: str(body.message, 2000),
    consent: body.consent === true ? "true" : "false",
  };
  if (body.type === "rfq") {
    fields.items = (Array.isArray(body.items) ? body.items : []).slice(0, 10).map((i) => ({
      description: str(i?.description, 200),
      quantity: str(i?.quantity, 20),
    }));
    fields.needed_by = str(body.neededBy, 10);
    fields.delivery_area = str(body.deliveryArea, 200);
  }

  const supabase = getPublicSupabaseClient();
  const { data, error } = await supabase.rpc("submit_public_request_v2", {
    p_business_id: body.businessId,
    p_request_type: body.type,
    p_fields: fields,
    p_ip_hash: hashIp(req),
    p_source: str(body.source, 40) || null,
  });

  if (error) {
    const code = Object.keys(REQUEST_ERRORS).find((c) => error.message.includes(c)) || "request_failed";
    const status = code === "rate_limited" ? 429 : code === "request_failed" ? 500 : 400;
    return NextResponse.json({ error: code, message: REQUEST_ERRORS[code] }, { status });
  }

  const result = data as { reference_code: string; tracking_token: string };
  return NextResponse.json({
    ok: true,
    reference_code: result.reference_code,
    tracking_token: result.tracking_token,
  });
}
