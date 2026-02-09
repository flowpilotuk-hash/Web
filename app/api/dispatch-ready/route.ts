// C:\Social Media Manager\web\app\api\dispatch-ready\route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type ApprovalStatus = "pending" | "approved" | "rejected";

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

type PlanRow = {
  plan_json: unknown;
  model: string | null;
  generated_at: string;
};

type DispatchRow = {
  post_key: string;
  ready: boolean;
  updated_at: string;
};

type ApprovalRow = {
  post_key: string;
  status: ApprovalStatus;
  decided_at: string | null;
  reject_reason: string | null;
  updated_at: string;
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

/**
 * IMPORTANT:
 * This must match your client-side makePostKey() logic in:
 * - app/dashboard/plan/page.tsx
 * - app/dashboard/queue/page.tsx
 */
function makePostKey(dayDate: string, post: PlanPost, idx: number): string {
  return [
    dayDate,
    String(idx),
    post.platform,
    post.format,
    post.suggested_time_local,
    post.caption.slice(0, 80),
    post.media_instructions.slice(0, 80),
  ].join("|");
}

function joinHashtags(tags: string[]): string {
  const cleaned = (tags ?? [])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/^#+/, "")}`));
  return cleaned.join(" ");
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = supabaseAdmin();

    // 1) Latest plan for user
    const { data: planRows, error: planErr } = await supabase
      .from("plans")
      .select("plan_json, model, generated_at")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(1);

    if (planErr) return jsonError(planErr.message, 500);

    const planRow = (planRows?.[0] ?? null) as PlanRow | null;
    if (!planRow) {
      return NextResponse.json({
        items: [],
        meta: { reason: "no_plan_found" },
      });
    }

    const planJson = planRow.plan_json;
    if (!isValidPlan(planJson)) {
      return jsonError("Stored plan_json is invalid. Regenerate plan.", 500);
    }

    const plan: Plan = planJson;

    // 2) Dispatch map (ready=true only)
    const { data: dispatchRows, error: dispatchErr } = await supabase
      .from("plan_dispatch")
      .select("post_key, ready, updated_at")
      .eq("user_id", userId)
      .eq("ready", true);

    if (dispatchErr) return jsonError(dispatchErr.message, 500);

    const dispatchReadyKeys = new Set<string>();
    const dispatchUpdatedAt: Record<string, string> = {};
    for (const row of (dispatchRows ?? []) as DispatchRow[]) {
      if (!row?.post_key) continue;
      dispatchReadyKeys.add(row.post_key);
      dispatchUpdatedAt[row.post_key] = new Date(row.updated_at).toISOString();
    }

    if (dispatchReadyKeys.size === 0) {
      return NextResponse.json({
        items: [],
        meta: {
          model: planRow.model ?? undefined,
          planGeneratedAt: new Date(planRow.generated_at).toISOString(),
          dispatchReadyCount: 0,
        },
      });
    }

    // 3) Approvals map (all statuses, so we can enforce approval_required)
    const { data: approvalRows, error: approvalErr } = await supabase
      .from("plan_post_approvals")
      .select("post_key, status, decided_at, reject_reason, updated_at")
      .eq("user_id", userId);

    if (approvalErr) return jsonError(approvalErr.message, 500);

    const approvals: Record<string, ApprovalRow> = {};
    for (const row of (approvalRows ?? []) as ApprovalRow[]) {
      if (!row?.post_key) continue;
      approvals[row.post_key] = row;
    }

    // 4) Build filtered list: dispatch ready + approved (if required)
    const items: Array<{
      postKey: string;
      date: string;
      timeLocal: string;
      platform: PlanPost["platform"];
      format: PlanPost["format"];
      source: PlanPost["source"];
      caption: string;
      hashtags: string;
      mediaInstructions: string;
      approvalRequired: boolean;
      approvalReason: string;
      approvalStatus: "approved";
      dispatchUpdatedAtIso?: string;
    }> = [];

    for (const day of plan.days) {
      day.posts.forEach((p, idx) => {
        const postKey = makePostKey(day.date, p, idx);

        if (!dispatchReadyKeys.has(postKey)) return;

        // approval gate
        if (p.approval_required) {
          const a = approvals[postKey];
          if (!a || a.status !== "approved") return;
        }

        items.push({
          postKey,
          date: day.date,
          timeLocal: p.suggested_time_local,
          platform: p.platform,
          format: p.format,
          source: p.source,
          caption: p.caption,
          hashtags: joinHashtags(p.hashtags),
          mediaInstructions: p.media_instructions,
          approvalRequired: p.approval_required,
          approvalReason: p.approval_reason,
          approvalStatus: "approved",
          dispatchUpdatedAtIso: dispatchUpdatedAt[postKey],
        });
      });
    }

    // Sort by date + time
    items.sort((a, b) => `${a.date} ${a.timeLocal}`.localeCompare(`${b.date} ${b.timeLocal}`));

    return NextResponse.json({
      items,
      meta: {
        model: planRow.model ?? undefined,
        planGeneratedAt: new Date(planRow.generated_at).toISOString(),
        dispatchReadyCount: dispatchReadyKeys.size,
        returnedCount: items.length,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}
