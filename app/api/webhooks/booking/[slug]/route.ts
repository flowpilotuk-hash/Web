import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ApiErr = { error: string };

function jsonError(message: string, status: number) {
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

function requireWebhookToken(req: Request): string | null {
  const expected = process.env.WEBHOOK_TOKEN?.trim();
  if (!expected) return "Missing environment variable: WEBHOOK_TOKEN";

  const authHeader = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  const got = (m?.[1] ?? "").trim();

  if (!got) return "Missing Authorization header (expected: Bearer <token>).";
  if (got !== expected) return "Unauthorized.";
  return null;
}

function asString(x: unknown): string | null {
  return typeof x === "string" && x.trim().length > 0 ? x.trim() : null;
}

function asDateIsoOrNull(x: unknown): string | null {
  const s = asString(x);
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function substituteTemplate(template: string, reviewUrl: string): string {
  return template.replaceAll("{review_url}", reviewUrl);
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const tokenErr = requireWebhookToken(req);
    if (tokenErr) return jsonError(tokenErr, tokenErr === "Unauthorized." ? 401 : 400);

    const { slug } = await params;
    if (!slug || typeof slug !== "string") return jsonError("Missing slug in URL.", 400);

    // ✅ Robust body parsing: read raw text then parse JSON ourselves.
    const rawText = await req.text();
    if (!rawText || rawText.trim().length === 0) {
      return jsonError("Body is empty (expected JSON).", 400);
    }

    let rawObj: Record<string, unknown>;
    try {
      rawObj = JSON.parse(rawText);
    } catch {
      return jsonError(`Body must be valid JSON. First 200 chars: ${rawText.slice(0, 200)}`, 400);
    }

    // 1) Resolve salon by slug
    const supabase = supabaseAdmin();

    const { data: booking, error: bookingErr } = await supabase
      .from("booking_settings")
      .select("user_id, slug")
      .eq("slug", slug)
      .maybeSingle();

    if (bookingErr) return jsonError(bookingErr.message, 500);
    if (!booking) return jsonError("Unknown booking slug.", 404);

    const userId: string = booking.user_id;

    // 2) Load review settings
    const { data: settings, error: settingsErr } = await supabase
      .from("review_settings")
      .select("review_url, send_delay_minutes, channel, template")
      .eq("user_id", userId)
      .maybeSingle();

    if (settingsErr) return jsonError(settingsErr.message, 500);
    if (!settings) return jsonError("Review settings not configured for this salon.", 409);

    // 3) Extract fields best-effort
    const externalEventId =
      asString(rawObj.external_event_id) ??
      asString(rawObj.eventId) ??
      asString(rawObj.id) ??
      asString(rawObj.bookingId) ??
      null;

    const customerName =
      asString(rawObj.customer_name) ??
      asString(rawObj.customerName) ??
      asString(rawObj.name) ??
      null;

    const customerEmail =
      asString(rawObj.customer_email) ??
      asString(rawObj.customerEmail) ??
      asString(rawObj.email) ??
      null;

    const customerPhone =
      asString(rawObj.customer_phone) ??
      asString(rawObj.customerPhone) ??
      asString(rawObj.phone) ??
      null;

    const appointmentEnd =
      asDateIsoOrNull(rawObj.appointment_end) ??
      asDateIsoOrNull(rawObj.appointmentEnd) ??
      asDateIsoOrNull(rawObj.end) ??
      asDateIsoOrNull(rawObj.endTime) ??
      null;

    // 4) Dedup if externalEventId exists
    if (externalEventId) {
      const { data: existing, error: existErr } = await supabase
        .from("appointment_events")
        .select("id")
        .eq("user_id", userId)
        .eq("external_event_id", externalEventId)
        .maybeSingle();

      if (existErr) return jsonError(existErr.message, 500);

      if (existing?.id) {
        return NextResponse.json({ ok: true, deduped: true });
      }
    }

    // 5) Insert appointment event
    const { data: insertedEvent, error: eventErr } = await supabase
      .from("appointment_events")
      .insert({
        user_id: userId,
        external_event_id: externalEventId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        appointment_end: appointmentEnd,
        raw: rawObj,
      })
      .select("id")
      .single();

    if (eventErr) return jsonError(eventErr.message, 500);

    // 6) Build review job
    const delayMinutes =
      typeof settings.send_delay_minutes === "number" && Number.isFinite(settings.send_delay_minutes)
        ? Math.max(0, Math.min(7 * 24 * 60, Math.floor(settings.send_delay_minutes)))
        : 120;

    const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

    const reviewUrl: string = settings.review_url;
    const template: string = settings.template;
    const message = substituteTemplate(template, reviewUrl);

    const channel = settings.channel === "sms" ? "sms" : "email";

    let toEmail: string | null = null;
    let toPhone: string | null = null;

    if (channel === "email") {
      toEmail = customerEmail;
      if (!toEmail) {
        return NextResponse.json({
          ok: true,
          queued: false,
          reason: "missing_customer_email",
          appointmentEventId: insertedEvent.id,
        });
      }
    } else {
      toPhone = customerPhone;
      if (!toPhone) {
        return NextResponse.json({
          ok: true,
          queued: false,
          reason: "missing_customer_phone",
          appointmentEventId: insertedEvent.id,
        });
      }
    }

    const { error: jobErr } = await supabase.from("review_jobs").insert({
      user_id: userId,
      appointment_event_id: insertedEvent.id,
      channel,
      to_email: toEmail,
      to_phone: toPhone,
      message,
      scheduled_for: scheduledFor,
      status: "queued",
    });

    if (jobErr) return jsonError(jobErr.message, 500);

    return NextResponse.json({
      ok: true,
      queued: true,
      scheduledFor,
      channel,
      appointmentEventId: insertedEvent.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}
