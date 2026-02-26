import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clerkClient } from "@clerk/nextjs/server";

type ApiErr = { error: string };

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message } satisfies ApiErr, { status });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing environment variable: ${name}`);
  return v.trim();
}

function optionalEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : null;
}

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function normalizeSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function isHhMm(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return h * 60 + m;
}

function isIsoDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function formatRequestSummary(input: {
  slug: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  requestedDate: string;
  windowStart: string;
  windowEnd: string;
  notes?: string | null;
}): string {
  return [
    `New booking request`,
    ``,
    `Public booking page: /book/${input.slug}`,
    ``,
    `Customer: ${input.customerName}`,
    `Email: ${input.customerEmail}`,
    input.customerPhone ? `Phone: ${input.customerPhone}` : null,
    ``,
    `Requested: ${input.requestedDate} • ${input.windowStart}-${input.windowEnd}`,
    input.notes ? `Notes: ${input.notes}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendEmailResend(args: { to: string; subject: string; text: string }): Promise<void> {
  const apiKey = optionalEnv("RESEND_API_KEY");
  const from = optionalEnv("EMAIL_FROM");
  const baseUrl = optionalEnv("PUBLIC_BASE_URL");

  // Email not configured yet? Don't fail bookings.
  if (!apiKey || !from) return;

  const payload = {
    from,
    to: args.to,
    subject: args.subject,
    text: args.text + (baseUrl ? `\n\n—\nFlowPilot: ${baseUrl}` : "")
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Resend email failed (${res.status}): ${t.slice(0, 300)}`);
  }
}

async function getSalonOwnerEmail(userId: string): Promise<string | null> {
  try {
    // IMPORTANT: In your Clerk SDK, clerkClient is async (function), so call it first.
    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    const primaryId = user.primaryEmailAddressId;
    const primary = user.emailAddresses.find((e) => e.id === primaryId) ?? user.emailAddresses[0];
    return primary?.emailAddress ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    if (!slug || typeof slug !== "string") return jsonError("Missing slug.", 400);

    const supabase = supabaseAdmin();

    // Confirm slug exists and is in flowpilot_basic mode
    const { data: booking, error: bookingErr } = await supabase
      .from("booking_settings")
      .select("user_id, slug, mode")
      .eq("slug", slug)
      .maybeSingle();

    if (bookingErr) return jsonError(bookingErr.message, 500);
    if (!booking) return jsonError("Unknown booking slug.", 404);
    if (booking.mode !== "flowpilot_basic") {
      return jsonError("This salon uses a booking provider link (no request form).", 409);
    }

    const contentType = req.headers.get("content-type") ?? "";

    let customerName = "";
    let customerEmail = "";
    let customerPhone = "";
    let requestedDate = "";
    let windowStart = "";
    let windowEnd = "";
    let notes = "";

    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as any;
      if (!body || typeof body !== "object") return jsonError("Body must be valid JSON.", 400);

      customerName = typeof body.customerName === "string" ? body.customerName : "";
      customerEmail = typeof body.customerEmail === "string" ? body.customerEmail : "";
      customerPhone = typeof body.customerPhone === "string" ? body.customerPhone : "";
      requestedDate = typeof body.requestedDate === "string" ? body.requestedDate : "";
      windowStart = typeof body.windowStart === "string" ? body.windowStart : "";
      windowEnd = typeof body.windowEnd === "string" ? body.windowEnd : "";
      notes = typeof body.notes === "string" ? body.notes : "";
    } else {
      const fd = await req.formData();
      customerName = String(fd.get("customerName") ?? "");
      customerEmail = String(fd.get("customerEmail") ?? "");
      customerPhone = String(fd.get("customerPhone") ?? "");
      requestedDate = String(fd.get("requestedDate") ?? "");
      windowStart = String(fd.get("windowStart") ?? "");
      windowEnd = String(fd.get("windowEnd") ?? "");
      notes = String(fd.get("notes") ?? "");
    }

    customerName = normalizeSpaces(customerName);
    customerEmail = customerEmail.trim();
    customerPhone = normalizeSpaces(customerPhone);
    requestedDate = requestedDate.trim();
    windowStart = windowStart.trim();
    windowEnd = windowEnd.trim();
    notes = normalizeSpaces(notes);

    if (customerName.length < 2) return jsonError("Please enter your name.", 400);
    if (!isEmail(customerEmail)) return jsonError("Please enter a valid email address.", 400);
    if (!isIsoDateOnly(requestedDate)) return jsonError("Please choose a date.", 400);
    if (!isHhMm(windowStart) || !isHhMm(windowEnd)) return jsonError("Please choose a valid time window.", 400);

    const startMin = timeToMinutes(windowStart);
    const endMin = timeToMinutes(windowEnd);
    if (startMin >= endMin) return jsonError("End time must be later than start time.", 400);

    const { data: inserted, error: insErr } = await supabase
      .from("booking_requests")
      .insert({
        user_id: booking.user_id,
        slug: booking.slug,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone || null,
        requested_date: requestedDate,
        window_start: windowStart,
        window_end: windowEnd,
        notes: notes || null,
        status: "pending"
      })
      .select("id")
      .single();

    if (insErr) return jsonError(insErr.message, 500);

    // Emails (MVP) — does not block booking if email fails.
    const salonEmail = await getSalonOwnerEmail(booking.user_id);

    const summary = formatRequestSummary({
      slug: booking.slug,
      customerName,
      customerEmail,
      customerPhone: customerPhone || null,
      requestedDate,
      windowStart,
      windowEnd,
      notes: notes || null
    });

    const baseUrl = optionalEnv("PUBLIC_BASE_URL") ?? "";
    const adminUrl = baseUrl ? `${baseUrl}/dashboard/booking-requests` : "/dashboard/booking-requests";

    const salonText =
      summary +
      `\n\nNext step:\nOpen booking requests: ${adminUrl}\n\nConfirm a time within the requested window (or decline).`;

    const customerText =
      `Thanks ${customerName} — we’ve received your booking request.\n\n` +
      `Requested: ${requestedDate} • ${windowStart}-${windowEnd}\n\n` +
      `The salon will confirm your exact appointment time shortly by email.` +
      (notes ? `\n\nYour notes: ${notes}` : "");

    let emailSalonSent = false;
    let emailCustomerSent = false;

    try {
      if (salonEmail) {
        await sendEmailResend({
          to: salonEmail,
          subject: `New booking request (${requestedDate} ${windowStart}-${windowEnd})`,
          text: salonText
        });
        emailSalonSent = true;
      }
    } catch {
      // ignore
    }

    try {
      await sendEmailResend({
        to: customerEmail,
        subject: "We’ve received your booking request",
        text: customerText
      });
      emailCustomerSent = true;
    } catch {
      // ignore
    }

    // Redirect browser form submissions back to booking page with success flag
    if (!contentType.includes("application/json")) {
      const url = new URL(`/book/${encodeURIComponent(slug)}?sent=1`, req.url);
      return NextResponse.redirect(url, 303);
    }

    return NextResponse.json(
      { ok: true, requestId: inserted.id, email: { salonSent: emailSalonSent, customerSent: emailCustomerSent } },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}