import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type PlanPost = {
  source: "priority" | "scheduled";
  platform: "instagram" | "facebook";
  format: "post" | "reel" | "story";
  suggested_time_local: string; // "HH:MM"
  caption: string;
  hashtags: string[];
  media_instructions: string;
  approval_required: boolean;
  approval_reason: string;
};

type PlanDay = {
  date: string; // YYYY-MM-DD
  posts: PlanPost[];
};

type Plan = {
  horizon_start_date: string;
  horizon_end_date: string;
  days: PlanDay[];
};

type StorePlanBody = {
  plan: Plan;
  meta?: {
    model?: string;
    generatedAt?: string; // ISO
    extractedFrom?: string;
  };
};

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

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isIsoDate(value: string): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function isYyyyMmDd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHhMm(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function isValidPlan(plan: any): plan is Plan {
  if (!plan || typeof plan !== "object") return false;
  if (typeof plan.horizon_start_date !== "string" || !isYyyyMmDd(plan.horizon_start_date)) return false;
  if (typeof plan.horizon_end_date !== "string" || !isYyyyMmDd(plan.horizon_end_date)) return false;
  if (!Array.isArray(plan.days)) return false;

  for (const day of plan.days) {
    if (!day || typeof day !== "object") return false;
    if (typeof day.date !== "string" || !isYyyyMmDd(day.date)) return false;
    if (!Array.isArray(day.posts)) return false;

    for (const post of day.posts) {
      if (!post || typeof post !== "object") return false;
      if (post.source !== "priority" && post.source !== "scheduled") return false;
      if (post.platform !== "instagram" && post.platform !== "facebook") return false;
      if (post.format !== "post" && post.format !== "reel" && post.format !== "story") return false;
      if (typeof post.suggested_time_local !== "string" || !isHhMm(post.suggested_time_local)) return false;
      if (typeof post.caption !== "string") return false;
      if (!Array.isArray(post.hashtags) || post.hashtags.some((t: any) => typeof t !== "string")) return false;
      if (typeof post.media_instructions !== "string") return false;
      if (typeof post.approval_required !== "boolean") return false;
      if (typeof post.approval_reason !== "string") return false;
    }
  }

  return true;
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("plans")
      .select("plan_json, model, generated_at")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(1);

    if (error) return jsonError(error.message, 500);

    const row = data?.[0];
    if (!row) return NextResponse.json({ plan: null });

    return NextResponse.json({
      plan: row.plan_json,
      meta: {
        model: row.model ?? undefined,
        generatedAt: row.generated_at ?? undefined,
      },
    });
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

    const b = body as StorePlanBody;

    if (!isValidPlan((b as any).plan)) {
      return jsonError("Invalid plan format.", 400);
    }

    const model = typeof b.meta?.model === "string" && b.meta.model.trim().length > 0 ? b.meta.model.trim() : null;

    const generatedAt =
      typeof b.meta?.generatedAt === "string" && b.meta.generatedAt.trim().length > 0 && isIsoDate(b.meta.generatedAt)
        ? new Date(b.meta.generatedAt).toISOString()
        : new Date().toISOString();

    const supabase = supabaseAdmin();

    const { error } = await supabase.from("plans").insert({
      user_id: userId,
      plan_json: b.plan,
      model,
      generated_at: generatedAt,
    });

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ ok: true, generatedAt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}
