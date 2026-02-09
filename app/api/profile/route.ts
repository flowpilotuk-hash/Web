import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type PostingFrequency = "daily" | "weekly";
type Industry = "Beauty / Salons" | "Trades" | "Restaurant" | "Other";

type ProfileUpsert = {
  businessName: string;
  industry: Industry;
  industryOther?: string;
  postingFrequency: PostingFrequency;
  maxPostsPerDay: 1 | 2;
  brandTone: string;
  clientControlAcknowledged: boolean;
  promotionsRequireApprovalAcknowledged: boolean;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function normalizeSpaces(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function validateBody(body: unknown): { ok: true; value: ProfileUpsert } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON body." };
  const b = body as Partial<ProfileUpsert>;

  if (!isNonEmptyString(b.businessName)) return { ok: false, error: "businessName is required." };
  if (!isNonEmptyString(b.industry)) return { ok: false, error: "industry is required." };

  const industry = b.industry as Industry;
  const allowedIndustries: Industry[] = ["Beauty / Salons", "Trades", "Restaurant", "Other"];
  if (!allowedIndustries.includes(industry)) return { ok: false, error: "industry is invalid." };

  const postingFrequency = b.postingFrequency as PostingFrequency;
  if (postingFrequency !== "daily" && postingFrequency !== "weekly") {
    return { ok: false, error: "postingFrequency must be 'daily' or 'weekly'." };
  }

  const maxPostsPerDay = b.maxPostsPerDay;
  if (maxPostsPerDay !== 1 && maxPostsPerDay !== 2) {
    return { ok: false, error: "maxPostsPerDay must be 1 or 2." };
  }

  if (!isNonEmptyString(b.brandTone)) return { ok: false, error: "brandTone is required." };

  const clientControlAcknowledged = Boolean(b.clientControlAcknowledged);
  const promotionsRequireApprovalAcknowledged = Boolean(b.promotionsRequireApprovalAcknowledged);

  if (!clientControlAcknowledged) return { ok: false, error: "clientControlAcknowledged must be true." };
  if (!promotionsRequireApprovalAcknowledged) {
    return { ok: false, error: "promotionsRequireApprovalAcknowledged must be true." };
  }

  const industryOther =
    industry === "Other"
      ? isNonEmptyString(b.industryOther)
        ? normalizeSpaces(b.industryOther)
        : ""
      : undefined;

  if (industry === "Other" && !industryOther) {
    return { ok: false, error: "industryOther is required when industry is 'Other'." };
  }

  return {
    ok: true,
    value: {
      businessName: normalizeSpaces(b.businessName),
      industry,
      industryOther,
      postingFrequency,
      maxPostsPerDay,
      brandTone: normalizeSpaces(b.brandTone),
      clientControlAcknowledged,
      promotionsRequireApprovalAcknowledged,
    },
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "user_id,business_name,industry,industry_other,posting_frequency,max_posts_per_day,brand_tone,client_control_acknowledged,promotions_require_approval_acknowledged,updated_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) return NextResponse.json({ profile: null });

  return NextResponse.json({
    profile: {
      userId: data.user_id,
      businessName: data.business_name,
      industry: data.industry,
      industryOther: data.industry_other,
      postingFrequency: data.posting_frequency,
      maxPostsPerDay: data.max_posts_per_day,
      brandTone: data.brand_tone,
      clientControlAcknowledged: data.client_control_acknowledged,
      promotionsRequireApprovalAcknowledged: data.promotions_require_approval_acknowledged,
      updatedAt: data.updated_at,
    },
  });
}

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }

  const validated = validateBody(body);
  if (!validated.ok) return badRequest(validated.error);

  const v = validated.value;
  const supabase = supabaseAdmin();

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      business_name: v.businessName,
      industry: v.industry,
      industry_other: v.industry === "Other" ? v.industryOther : null,
      posting_frequency: v.postingFrequency,
      max_posts_per_day: v.maxPostsPerDay,
      brand_tone: v.brandTone,
      client_control_acknowledged: v.clientControlAcknowledged,
      promotions_require_approval_acknowledged: v.promotionsRequireApprovalAcknowledged,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
