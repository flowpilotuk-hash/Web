import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type ApiErr = { error: string };

type ReviewSettings = {
  reviewUrl: string;
  sendDelayMinutes: number; // e.g., 120
  channel: "email" | "sms";
  template: string;
};

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

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("review_settings")
      .select("review_url, send_delay_minutes, channel, template, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return jsonError(error.message, 500);
    if (!data) return NextResponse.json({ review: null }, { status: 200 });

    return NextResponse.json(
      {
        review: {
          reviewUrl: data.review_url,
          sendDelayMinutes: data.send_delay_minutes,
          channel: data.channel,
          template: data.template,
          updatedAt: data.updated_at,
        },
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return jsonError("Unauthorized", 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError("Body must be valid JSON.", 400);
    }

    if (!body || typeof body !== "object") return jsonError("Invalid JSON body.", 400);
    const b = body as Partial<ReviewSettings>;

    const reviewUrl = typeof b.reviewUrl === "string" ? b.reviewUrl.trim() : "";
    if (!reviewUrl || !isValidHttpUrl(reviewUrl)) {
      return jsonError("reviewUrl must be a valid http(s) link.", 400);
    }

    const sendDelayMinutes =
      typeof b.sendDelayMinutes === "number" && Number.isFinite(b.sendDelayMinutes)
        ? Math.max(0, Math.min(7 * 24 * 60, Math.floor(b.sendDelayMinutes))) // clamp 0..10080
        : 120;

    const channel = b.channel === "sms" ? "sms" : "email";

    const templateRaw = typeof b.template === "string" ? b.template : "";
    const template = normalizeSpaces(templateRaw);
    if (template.length < 10) {
      return jsonError("template is too short. Please write a short message (10+ characters).", 400);
    }

    const supabase = supabaseAdmin();

    const { error } = await supabase.from("review_settings").upsert(
      {
        user_id: userId,
        review_url: reviewUrl,
        send_delay_minutes: sendDelayMinutes,
        channel,
        template,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}
