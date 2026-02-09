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

function requireAutomationToken(req: Request): string | null {
  const expected = process.env.AUTOMATION_TOKEN?.trim();
  if (!expected) return "Missing environment variable: AUTOMATION_TOKEN";

  const authHeader = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  const got = (m?.[1] ?? "").trim();
  if (!got) return "Missing Authorization header (expected: Bearer <token>).";

  if (got !== expected) return "Unauthorized.";
  return null;
}

type ReviewJobRow = {
  id: string;
  user_id: string;
  channel: "email" | "sms";
  to_email: string | null;
  to_phone: string | null;
  message: string;
  scheduled_for: string;
  status: "queued" | "sent" | "failed";
};

async function fetchDueJobs(limit: number) {
  const supabase = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("review_jobs")
    .select("id, user_id, channel, to_email, to_phone, message, scheduled_for, status")
    .eq("status", "queued")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []) as ReviewJobRow[];
}

/**
 * GET = preview due review jobs
 * POST = mark due jobs as sent (MVP)
 *
 * Security: Authorization: Bearer <AUTOMATION_TOKEN>
 */
export async function GET(req: Request) {
  try {
    const tokenErr = requireAutomationToken(req);
    if (tokenErr) return jsonError(tokenErr, tokenErr === "Unauthorized." ? 401 : 400);

    const jobs = await fetchDueJobs(25);
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}

export async function POST(req: Request) {
  try {
    const tokenErr = requireAutomationToken(req);
    if (tokenErr) return jsonError(tokenErr, tokenErr === "Unauthorized." ? 401 : 400);

    const jobs = await fetchDueJobs(25);
    if (jobs.length === 0) return NextResponse.json({ ok: true, sent: 0, jobs: [] });

    const supabase = supabaseAdmin();
    const nowIso = new Date().toISOString();

    // Mark each job as sent (MVP). Later: attempt delivery, mark failed with error on exceptions.
    for (const job of jobs) {
      const { error } = await supabase
        .from("review_jobs")
        .update({ status: "sent", sent_at: nowIso, error: null })
        .eq("id", job.id);

      if (error) return jsonError(error.message, 500);
    }

    return NextResponse.json({ ok: true, sent: jobs.length, jobs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}
