import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type PostingFrequency = "daily" | "weekly";

type OnboardingPayload = {
  businessName: string;
  industry: string;
  industryOther?: string | null;
  postingFrequency: PostingFrequency;
  maxPostsPerDay: 1 | 2;
  brandTone: string;
  clientControlAcknowledged: boolean;
  promotionsRequireApprovalAcknowledged: boolean;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v || typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return v;
}

function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isPostingFrequency(v: unknown): v is PostingFrequency {
  return v === "daily" || v === "weekly";
}

function parsePayload(body: unknown): { ok: true; data: OnboardingPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON body." };

  const b = body as Record<string, unknown>;

  const businessName = typeof b.businessName === "string" ? safeTrim(b.businessName) : "";
  const industry = typeof b.industry === "string" ? safeTrim(b.industry) : "";
  const industryOther =
    typeof b.industryOther === "string" ? safeTrim(b.industryOther) : b.industryOther === null ? null : undefined;

  const postingFrequency = b.postingFrequency;
  const maxPostsPerDayRaw = b.maxPostsPerDay;

  const brandTone = typeof b.brandTone === "string" ? safeTrim(b.brandTone) : "";

  const clientControlAcknowledged = Boolean(b.clientControlAcknowledged);
  const promotionsRequireApprovalAcknowledged = Boolean(b.promotionsRequireApprovalAcknowledged);

  if (businessName.length === 0) return { ok: false, error: "businessName is required." };
  if (industry.length === 0) return { ok: false, error: "industry is required." };

  if (industry.toLowerCase() === "other") {
    if (!industryOther || safeTrim(String(industryOther)).length === 0) {
      return { ok: false, error: "industryOther is required when industry is 'Other'." };
    }
  }

  if (!isPostingFrequency(postingFrequency)) {
    return { ok: false, error: "postingFrequency must be 'daily' or 'weekly'." };
  }

  const maxPostsPerDay = maxPostsPerDayRaw === 2 ? 2 : maxPostsPerDayRaw === 1 ? 1 : null;
  if (maxPostsPerDay === null) {
    return { ok: false, error: "maxPostsPerDay must be 1 or 2." };
  }

  if (brandTone.length === 0) return { ok: false, error: "brandTone is required." };

  if (!clientControlAcknowledged) {
    return { ok: false, error: "clientControlAcknowledged must be true." };
  }

  if (!promotionsRequireApprovalAcknowledged) {
    return { ok: false, error: "promotionsRequireApprovalAcknowledged must be true." };
  }

  return {
    ok: true,
    data: {
      businessName,
      industry,
      industryOther: industryOther ?? null,
      postingFrequency,
      maxPostsPerDay,
      brandTone,
      clientControlAcknowledged,
      promotionsRequireApprovalAcknowledged
    }
  };
}

function getSupabaseAdmin() {
  const url = mustGetEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function requireUserId(): Promise<string | null> {
  // In your setup, auth() is async (we've seen this in TypeScript errors before),
  // so we MUST await it.
  const a = await auth();
  const userId = (a as { userId?: string | null }).userId ?? null;
  return userId;
}

/**
 * GET /api/onboarding
 * Returns: { onboarding: OnboardingPayload | null }
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("onboarding")
      .select(
        "business_name, industry, industry_other, posting_frequency, max_posts_per_day, brand_tone, client_control_acknowledged, promotions_require_approval_acknowledged, updated_at"
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return jsonError(`Supabase error: ${error.message}`, 500);
    }

    if (!data) {
      return NextResponse.json({ onboarding: null }, { status: 200 });
    }

    const onboarding: OnboardingPayload = {
      businessName: data.business_name,
      industry: data.industry,
      industryOther: data.industry_other ?? null,
      postingFrequency: data.posting_frequency as PostingFrequency,
      maxPostsPerDay: (data.max_posts_per_day === 2 ? 2 : 1) as 1 | 2,
      brandTone: data.brand_tone,
      clientControlAcknowledged: Boolean(data.client_control_acknowledged),
      promotionsRequireApprovalAcknowledged: Boolean(data.promotions_require_approval_acknowledged)
    };

    return NextResponse.json({ onboarding }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown server error.";
    return jsonError(msg, 500);
  }
}

/**
 * POST /api/onboarding
 * Body: OnboardingPayload
 * Returns: { ok: true }
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    if (!userId) return jsonError("Unauthorized", 401);

    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = parsePayload(body);

    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = getSupabaseAdmin();

    const row = {
      user_id: userId,
      business_name: parsed.data.businessName,
      industry: parsed.data.industry,
      industry_other: parsed.data.industryOther ?? null,
      posting_frequency: parsed.data.postingFrequency,
      max_posts_per_day: parsed.data.maxPostsPerDay,
      brand_tone: parsed.data.brandTone,
      client_control_acknowledged: parsed.data.clientControlAcknowledged,
      promotions_require_approval_acknowledged: parsed.data.promotionsRequireApprovalAcknowledged,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from("onboarding").upsert(row, { onConflict: "user_id" });

    if (error) {
      return jsonError(`Supabase error: ${error.message}`, 500);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown server error.";
    return jsonError(msg, 500);
  }
}
