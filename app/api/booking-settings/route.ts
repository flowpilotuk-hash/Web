import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type ApiErr = { error: string };

type BookingMode = "provider" | "flowpilot_basic";

type BookingSettings = {
  slug: string;
  mode: BookingMode;
  bookingUrl?: string | null; // required only for provider mode
  provider?: string | null;
};

function jsonError(message: string, status = 400) {
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

function normalizeSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function slugify(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "salon";
}

function isValidSlug(s: string): boolean {
  return /^[a-z0-9-]{3,60}$/.test(s);
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function parseMode(x: unknown): BookingMode {
  return x === "flowpilot_basic" ? "flowpilot_basic" : "provider";
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return jsonError("Unauthorized", 401);

    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("booking_settings")
      .select("slug, mode, booking_url, provider, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return jsonError(error.message, 500);

    if (!data) return NextResponse.json({ booking: null }, { status: 200 });

    return NextResponse.json(
      {
        booking: {
          slug: data.slug,
          mode: (data.mode as BookingMode) ?? "provider",
          bookingUrl: typeof data.booking_url === "string" ? data.booking_url : "",
          provider: data.provider ?? null,
          updatedAt: data.updated_at,
        },
      },
      { status: 200 }
    );
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

    const b = body as Partial<BookingSettings>;

    // slug
    let slug = typeof b.slug === "string" ? slugify(b.slug) : "";
    if (!slug) slug = "salon";
    if (!isValidSlug(slug)) return jsonError("slug must be 3–60 chars (a-z, 0-9, hyphen).", 400);

    // mode
    const mode: BookingMode = parseMode((b as any).mode);

    // provider (optional)
    const provider =
      typeof b.provider === "string" && normalizeSpaces(b.provider).length > 0
        ? normalizeSpaces(b.provider)
        : null;

    // booking url rules
    const bookingUrlRaw = typeof b.bookingUrl === "string" ? b.bookingUrl.trim() : "";
    const bookingUrl = bookingUrlRaw;

    if (mode === "provider") {
      if (!bookingUrl || !isValidHttpUrl(bookingUrl)) {
        return jsonError("bookingUrl must be a valid http(s) URL when mode is 'provider'.", 400);
      }
    } else {
      // flowpilot_basic: bookingUrl can be blank
      if (bookingUrl && !isValidHttpUrl(bookingUrl)) {
        return jsonError("bookingUrl must be a valid http(s) URL if provided.", 400);
      }
    }

    const supabase = supabaseAdmin();

    // Enforce slug uniqueness
    const { data: existing, error: existErr } = await supabase
      .from("booking_settings")
      .select("user_id")
      .eq("slug", slug)
      .maybeSingle();

    if (existErr) return jsonError(existErr.message, 500);
    if (existing && existing.user_id !== userId) {
      return jsonError("That booking page URL (slug) is already taken. Please choose another.", 409);
    }

    const { error } = await supabase.from("booking_settings").upsert(
      {
        user_id: userId,
        slug,
        mode,
        booking_url: bookingUrl ?? "",
        provider,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ ok: true, slug, mode }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return jsonError(msg, 500);
  }
}
