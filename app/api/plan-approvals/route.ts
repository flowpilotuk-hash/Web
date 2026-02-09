import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type ApprovalStatus = "pending" | "approved" | "rejected";

type ApprovalRecord = {
  postKey: string;
  status: ApprovalStatus;
  rejectReason?: string | null;
  decidedAtIso?: string | null;
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

function normalizeSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function isStatus(x: unknown): x is ApprovalStatus {
  return x === "pending" || x === "approved" || x === "rejected";
}

function safeIsoOrNull(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== "string") return null;
  const v = x.trim();
  if (!v) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Unauthorized", 401);

  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("plan_post_approvals")
    .select("post_key,status,reject_reason,decided_at,updated_at")
    .eq("user_id", userId);

  if (error) return jsonError(error.message, 500);

  const approvals: Record<string, { status: ApprovalStatus; rejectReason?: string; decidedAtIso?: string }> = {};

  for (const row of data ?? []) {
    approvals[row.post_key] = {
      status: row.status as ApprovalStatus,
      rejectReason: row.reject_reason ?? undefined,
      decidedAtIso: row.decided_at ?? undefined,
    };
  }

  return NextResponse.json({ approvals });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Body must be valid JSON.", 400);
  }

  if (!body || typeof body !== "object") return jsonError("Invalid JSON body.", 400);

  const b = body as Partial<ApprovalRecord>;

  if (typeof b.postKey !== "string" || normalizeSpaces(b.postKey).length === 0) {
    return jsonError("postKey is required.", 400);
  }
  if (!isStatus(b.status)) {
    return jsonError("status must be 'pending', 'approved', or 'rejected'.", 400);
  }

  const postKey = normalizeSpaces(b.postKey);

  const rejectReason =
    typeof b.rejectReason === "string" ? normalizeSpaces(b.rejectReason) : b.rejectReason === null ? null : null;

  const decidedAtIso = safeIsoOrNull(b.decidedAtIso);

  const supabase = supabaseAdmin();

  const { error } = await supabase.from("plan_post_approvals").upsert(
    {
      user_id: userId,
      post_key: postKey,
      status: b.status,
      reject_reason: b.status === "rejected" ? rejectReason : null,
      decided_at: b.status === "pending" ? null : decidedAtIso ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,post_key" }
  );

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}
