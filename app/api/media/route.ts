import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type MediaItem = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  addedAtIso: string;
};

type MediaPayload = {
  sharedAlbumUrl: string;
  notesForAi: string;
  items: MediaItem[];
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

function isProbablyUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value: string): boolean {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function parseBody(body: unknown): { ok: true; data: MediaPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON body." };
  const b = body as Record<string, unknown>;

  const sharedAlbumUrl = typeof b.sharedAlbumUrl === "string" ? safeTrim(b.sharedAlbumUrl) : "";
  const notesForAi = typeof b.notesForAi === "string" ? safeTrim(b.notesForAi) : "";

  if (sharedAlbumUrl.length > 0 && !isProbablyUrl(sharedAlbumUrl)) {
    return { ok: false, error: "sharedAlbumUrl must be a valid http(s) URL or empty." };
  }

  const itemsRaw = b.items;
  if (!Array.isArray(itemsRaw)) return { ok: false, error: "items must be an array." };

  // Keep some sane limits
  if (itemsRaw.length > 500) return { ok: false, error: "Too many media items (max 500)." };

  const items: MediaItem[] = [];
  for (const it of itemsRaw) {
    if (!it || typeof it !== "object") return { ok: false, error: "Invalid item in items." };
    const o = it as Record<string, unknown>;

    const id = typeof o.id === "string" ? o.id : "";
    const filename = typeof o.filename === "string" ? o.filename : "";
    const mimeType = typeof o.mimeType === "string" ? o.mimeType : "application/octet-stream";
    const sizeBytes = typeof o.sizeBytes === "number" ? o.sizeBytes : NaN;
    const addedAtIso = typeof o.addedAtIso === "string" ? o.addedAtIso : "";

    if (id.trim().length === 0) return { ok: false, error: "Each item must have an id." };
    if (filename.trim().length === 0) return { ok: false, error: "Each item must have a filename." };
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return { ok: false, error: "Each item must have a valid sizeBytes." };
    if (!isIsoDate(addedAtIso)) return { ok: false, error: "Each item must have a valid addedAtIso." };

    items.push({
      id: id.trim(),
      filename: filename.trim(),
      mimeType: mimeType.trim(),
      sizeBytes,
      addedAtIso
    });
  }

  return { ok: true, data: { sharedAlbumUrl, notesForAi, items } };
}

/**
 * GET /api/media
 * Returns: { media: MediaPayload | null }
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("media_settings")
      .select("shared_album_url, notes_for_ai, items, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return jsonError(`Supabase error: ${error.message}`, 500);

    if (!data) return NextResponse.json({ media: null }, { status: 200 });

    const items = Array.isArray(data.items) ? (data.items as any[]).filter(Boolean) : [];

    const media: MediaPayload = {
      sharedAlbumUrl: typeof data.shared_album_url === "string" ? data.shared_album_url : "",
      notesForAi: typeof data.notes_for_ai === "string" ? data.notes_for_ai : "",
      items: items as MediaItem[]
    };

    return NextResponse.json({ media }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown server error.";
    return jsonError(msg, 500);
  }
}

/**
 * POST /api/media
 * Body: MediaPayload
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
      shared_album_url: parsed.data.sharedAlbumUrl,
      notes_for_ai: parsed.data.notesForAi,
      items: parsed.data.items,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from("media_settings").upsert(row, { onConflict: "user_id" });
    if (error) return jsonError(`Supabase error: ${error.message}`, 500);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown server error.";
    return jsonError(msg, 500);
  }
}
