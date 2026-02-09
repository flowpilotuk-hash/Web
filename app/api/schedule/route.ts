import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type PostingMode = "daily" | "weekly";

type ScheduleSettings = {
  mode: PostingMode;
  daysOfWeek: number[]; // 0=Sun ... 6=Sat
  windowStart: string; // "HH:MM"
  windowEnd: string; // "HH:MM"
  timezoneLabel: string;
};

type ApiErr = { error: string };

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message } satisfies ApiErr, { status });
}

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v || typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return v;
}

function getSupabaseAdmin() {
  const url = mustGetEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function requireUserId(): Promise<string | null> {
  const a = await auth();
  const userId = (a as { userId?: string | null }).userId ?? null;
  return userId;
}

function isValidTimeHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function parseBody(body: unknown): { ok: true; data: ScheduleSettings } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON body." };
  const b = body as Record<string, unknown>;

  const mode = b.mode;
  if (mode !== "daily" && mode !== "weekly") return { ok: false, error: "mode must be 'daily' or 'weekly'." };

  if (!Array.isArray(b.daysOfWeek)) return { ok: false, error: "daysOfWeek must be an array." };
  const days = b.daysOfWeek
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);

  const uniqueDays = Array.from(new Set(days)).sort((a, b2) => a - b2);
  if (uniqueDays.length === 0) return { ok: false, error: "Please select at least one day." };

  const windowStart = typeof b.windowStart === "string" ? b.windowStart.trim() : "";
  const windowEnd = typeof b.windowEnd === "string" ? b.windowEnd.trim() : "";

  if (!isValidTimeHHMM(windowStart) || !isValidTimeHHMM(windowEnd)) {
    return { ok: false, error: "windowStart/windowEnd must be valid HH:MM times." };
  }

  // Compare as minutes
  const [sh, sm] = windowStart.split(":").map((n) => Number(n));
  const [eh, em] = windowEnd.split(":").map((n) => Number(n));
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin >= endMin) return { ok: false, error: "windowEnd must be later than windowStart." };

  const timezoneLabel = typeof b.timezoneLabel === "string" ? b.timezoneLabel.trim() : "";
  if (timezoneLabel.length === 0) return { ok: false, error: "timezoneLabel is required." };

  return {
    ok: true,
    data: {
      mode,
      daysOfWeek: uniqueDays,
      windowStart,
      windowEnd,
      timezoneLabel
    }
  };
}

/**
 * GET /api/schedule
 * Returns: { schedule: ScheduleSettings | null }
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("schedule_settings")
      .select("mode, days_of_week, window_start, window_end, timezone_label, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return jsonError(`Supabase error: ${error.message}`, 500);

    if (!data) {
      return NextResponse.json({ schedule: null }, { status: 200 });
    }

    const schedule: ScheduleSettings = {
      mode: data.mode as PostingMode,
      daysOfWeek: Array.isArray(data.days_of_week) ? data.days_of_week.map((n: any) => Number(n)) : [],
      windowStart: data.window_start,
      windowEnd: data.window_end,
      timezoneLabel: data.timezone_label
    };

    return NextResponse.json({ schedule }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown server error.";
    return jsonError(msg, 500);
  }
}

/**
 * POST /api/schedule
 * Body: ScheduleSettings
 * Returns: { ok: true }
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    if (!userId) return jsonError("Unauthorized", 401);

    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = parseBody(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = getSupabaseAdmin();

    const row = {
      user_id: userId,
      mode: parsed.data.mode,
      days_of_week: parsed.data.daysOfWeek,
      window_start: parsed.data.windowStart,
      window_end: parsed.data.windowEnd,
      timezone_label: parsed.data.timezoneLabel,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from("schedule_settings").upsert(row, { onConflict: "user_id" });
    if (error) return jsonError(`Supabase error: ${error.message}`, 500);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown server error.";
    return jsonError(msg, 500);
  }
}
