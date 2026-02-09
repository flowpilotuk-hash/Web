import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type PriorityLevel = "normal" | "high";
type Status = "queued" | "completed" | "cancelled";

type PriorityPostRequest = {
  id: string;
  createdAtIso: string;
  priority: PriorityLevel;
  desiredPostAtIso?: string;
  instructions: string;
  attachmentsNote: string;
  requiresPromoApproval: boolean;
  status: Status;
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

function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isIsoDate(value: string): boolean {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function parseRequestsBody(body: unknown): { ok: true; requests: PriorityPostRequest[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON body." };

  const b = body as Record<string, unknown>;
  const reqs = b.requests;

  if (!Array.isArray(reqs)) return { ok: false, error: "Body must be { requests: [...] }." };
  if (reqs.length > 500) return { ok: false, error: "Too many requests (max 500)." };

  const cleaned: PriorityPostRequest[] = [];

  for (const item of reqs) {
    if (!item || typeof item !== "object") return { ok: false, error: "Invalid request in array." };
    const o = item as Record<string, unknown>;

    const id = typeof o.id === "string" ? o.id : "";
    const createdAtIso = typeof o.createdAtIso === "string" ? o.createdAtIso : "";
    const priority = o.priority;
    const desiredPostAtIso = typeof o.desiredPostAtIso === "string" ? o.desiredPostAtIso : undefined;
    const instructions = typeof o.instructions === "string" ? o.instructions : "";
    const attachmentsNote = typeof o.attachmentsNote === "string" ? o.attachmentsNote : "";
    const requiresPromoApproval = Boolean(o.requiresPromoApproval);
    const status = o.status;

    if (safeTrim(id).length === 0) return { ok: false, error: "Each request must have an id." };
    if (!isIsoDate(createdAtIso)) return { ok: false, error: "Each request must have a valid createdAtIso." };
    if (priority !== "normal" && priority !== "high") return { ok: false, error: "priority must be 'normal' or 'high'." };
    if (desiredPostAtIso && !isIsoDate(desiredPostAtIso)) return { ok: false, error: "desiredPostAtIso must be ISO datetime if provided." };

    if (safeTrim(instructions).length < 10) return { ok: false, error: "instructions must be at least 10 characters." };
    if (safeTrim(attachmentsNote).length === 0) return { ok: false, error: "attachmentsNote is required." };

    if (status !== "queued" && status !== "completed" && status !== "cancelled") {
      return { ok: false, error: "status must be 'queued', 'completed', or 'cancelled'." };
    }

    cleaned.push({
      id: safeTrim(id),
      createdAtIso: new Date(createdAtIso).toISOString(),
      priority,
      desiredPostAtIso: desiredPostAtIso ? new Date(desiredPostAtIso).toISOString() : undefined,
      instructions: safeTrim(instructions),
      attachmentsNote: safeTrim(attachmentsNote),
      requiresPromoApproval,
      status
    });
  }

  // newest first
  cleaned.sort((a, b2) => (a.createdAtIso < b2.createdAtIso ? 1 : -1));

  return { ok: true, requests: cleaned };
}

/**
 * GET /api/priority-posts
 * Returns: { requests: PriorityPostRequest[] }
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("priority_posts")
      .select(
        "id, created_at, priority, desired_post_at, instructions, attachments_note, requires_promo_approval, status"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) return jsonError(`Supabase error: ${error.message}`, 500);

    const requests: PriorityPostRequest[] = (data ?? []).map((row: any) => ({
      id: row.id,
      createdAtIso: new Date(row.created_at).toISOString(),
      priority: row.priority as PriorityLevel,
      desiredPostAtIso: row.desired_post_at ? new Date(row.desired_post_at).toISOString() : undefined,
      instructions: row.instructions,
      attachmentsNote: row.attachments_note,
      requiresPromoApproval: Boolean(row.requires_promo_approval),
      status: row.status as Status
    }));

    return NextResponse.json({ requests }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown server error.";
    return jsonError(msg, 500);
  }
}

/**
 * POST /api/priority-posts
 * Body: { requests: PriorityPostRequest[] }
 * Strategy (simple + reliable): replace all rows for this user.
 * Returns: { ok: true }
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    if (!userId) return jsonError("Unauthorized", 401);

    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = parseRequestsBody(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = getSupabaseAdmin();

    // 1) Delete existing for this user
    const { error: delErr } = await supabase.from("priority_posts").delete().eq("user_id", userId);
    if (delErr) return jsonError(`Supabase error: ${delErr.message}`, 500);

    // 2) Insert fresh (if any)
    if (parsed.requests.length > 0) {
      const rows = parsed.requests.map((r) => ({
        user_id: userId,
        id: r.id,
        created_at: new Date(r.createdAtIso).toISOString(),
        priority: r.priority,
        desired_post_at: r.desiredPostAtIso ? new Date(r.desiredPostAtIso).toISOString() : null,
        instructions: r.instructions,
        attachments_note: r.attachmentsNote,
        requires_promo_approval: r.requiresPromoApproval,
        status: r.status,
        updated_at: new Date().toISOString()
      }));

      const { error: insErr } = await supabase.from("priority_posts").insert(rows);
      if (insErr) return jsonError(`Supabase error: ${insErr.message}`, 500);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown server error.";
    return jsonError(msg, 500);
  }
}
