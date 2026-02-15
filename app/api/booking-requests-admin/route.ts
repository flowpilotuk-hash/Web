import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type ApiErr = { error: string };

type BookingRequestStatus = "pending" | "confirmed" | "declined";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message } satisfies ApiErr, { status });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing environment variable: ${name}`);
  return v.trim();
}

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isStatus(x: unknown): x is BookingRequestStatus {
  return x === "pending" || x === "confirmed" || x === "declined";
}

function parseIso(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return jsonError("Unauthorized", 401);

    const url = new URL(req.url);
    const status = url.searchParams.get("status"); // optional filter

    const supabase = supabaseAdmin();

    let q = supabase
      .from("booking_requests")
      .select(
        "id,slug,customer_name,customer_email,customer_phone,requested_date,window_start,window_end,notes,status,confirmed_start,confirmed_end,created_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (status && (status === "pending" || status === "confirmed" || status === "declined")) {
      q = q.eq("status", status);
    }

    const { data, error } = await q;
    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ requests: data ?? [] }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return jsonError("Unauthorized", 401);

    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object") return jsonError("Body must be valid JSON.", 400);

    const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
    if (!requestId) return jsonError("requestId is required.", 400);

    const status: unknown = body.status;
    if (!isStatus(status)) return jsonError("status must be pending|confirmed|declined.", 400);

    const confirmedStartIso = parseIso(body.confirmedStartIso);
    const confirmedEndIso = parseIso(body.confirmedEndIso);

    // Rules:
    // - confirmed requires start/end
    // - declined clears confirmed times
    if (status === "confirmed") {
      if (!confirmedStartIso || !confirmedEndIso) {
        return jsonError("confirmedStartIso and confirmedEndIso are required when confirming.", 400);
      }
      if (Date.parse(confirmedStartIso) >= Date.parse(confirmedEndIso)) {
        return jsonError("confirmedEndIso must be after confirmedStartIso.", 400);
      }
    }

    const supabase = supabaseAdmin();

    // Ensure the request belongs to this salon user
    const { data: existing, error: exErr } = await supabase
      .from("booking_requests")
      .select("id,status")
      .eq("id", requestId)
      .eq("user_id", userId)
      .maybeSingle();

    if (exErr) return jsonError(exErr.message, 500);
    if (!existing) return jsonError("Not found.", 404);

    const patch: any = { status };

    if (status === "confirmed") {
      patch.confirmed_start = confirmedStartIso;
      patch.confirmed_end = confirmedEndIso;
    } else {
      patch.confirmed_start = null;
      patch.confirmed_end = null;
    }

    const { error: upErr } = await supabase
      .from("booking_requests")
      .update(patch)
      .eq("id", requestId)
      .eq("user_id", userId);

    if (upErr) return jsonError(upErr.message, 500);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}
