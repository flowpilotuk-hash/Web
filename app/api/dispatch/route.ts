import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type DispatchRow = {
  post_key: string;
  ready: boolean;
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

function normalizeSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("plan_dispatch")
      .select("post_key, ready, updated_at")
      .eq("user_id", userId);

    if (error) return jsonError(error.message, 500);

    const dispatch: Record<string, { ready: boolean; updatedAtIso: string }> = {};

    for (const row of (data ?? []) as DispatchRow[]) {
      dispatch[row.post_key] = {
        ready: Boolean(row.ready),
        updatedAtIso: new Date(row.updated_at).toISOString(),
      };
    }

    return NextResponse.json({ dispatch });
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

    const b = body as Partial<{ postKey: unknown; ready: unknown }>;

    if (typeof b.postKey !== "string" || normalizeSpaces(b.postKey).length === 0) {
      return jsonError("postKey is required.", 400);
    }
    if (typeof b.ready !== "boolean") {
      return jsonError("ready must be boolean.", 400);
    }

    const postKey = normalizeSpaces(b.postKey);
    const supabase = supabaseAdmin();

    const { error } = await supabase.from("plan_dispatch").upsert(
      {
        user_id: userId,
        post_key: postKey,
        ready: b.ready,
      },
      { onConflict: "user_id,post_key" }
    );

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}
