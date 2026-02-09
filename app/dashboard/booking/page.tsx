"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type ApiErr = { error: string };

type BookingMode = "provider" | "flowpilot_basic";

type BookingSettings = {
  slug: string;
  mode: BookingMode;
  bookingUrl: string;
  provider?: string | null;
  updatedAt?: string;
};

type GetOk = { booking: BookingSettings | null };

function isApiErr(x: unknown): x is ApiErr {
  return !!x && typeof x === "object" && "error" in x && typeof (x as any).error === "string";
}

function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function getBooking(): Promise<
  { ok: true; data: BookingSettings | null } | { ok: false; status: number; error: string }
> {
  const res = await fetch("/api/booking-settings", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  const data = json as GetOk;
  if (!data || typeof data !== "object" || !("booking" in data)) {
    return { ok: false, status: 500, error: "Unexpected response from /api/booking-settings." };
  }

  return { ok: true, data: data.booking ?? null };
}

async function saveBooking(payload: {
  slug: string;
  mode: BookingMode;
  bookingUrl: string;
  provider?: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const res = await fetch("/api/booking-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  return { ok: true };
}

export default function BookingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);

  const [slug, setSlug] = useState("");
  const [mode, setMode] = useState<BookingMode>("provider");
  const [bookingUrl, setBookingUrl] = useState("");
  const [provider, setProvider] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const publicUrl = useMemo(() => {
    const s = slugify(slug);
    return `${typeof window !== "undefined" ? window.location.origin : ""}/book/${s}`;
  }, [slug]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      setSuccess(null);
      setAuthRequired(false);

      const result = await getBooking();

      if (!result.ok) {
        if (result.status === 401) {
          setAuthRequired(true);
          setLoading(false);
          return;
        }
        setError(result.error);
        setLoading(false);
        return;
      }

      if (result.data) {
        setSlug(result.data.slug);
        setMode(result.data.mode ?? "provider");
        setBookingUrl(result.data.bookingUrl ?? "");
        setProvider(result.data.provider ?? "");
      } else {
        // sensible defaults
        setSlug("the-trial-salon");
        setMode("flowpilot_basic");
        setBookingUrl("");
        setProvider("");
      }

      setLoading(false);
    })();
  }, []);

  function validate(): string | null {
    if (safeTrim(slug).length < 3) return "Please enter a slug (at least 3 characters).";

    if (mode === "provider") {
      if (safeTrim(bookingUrl).length === 0) return "Please enter your booking provider URL.";
      if (!isValidHttpUrl(bookingUrl)) return "Booking URL must be a valid http(s) link.";
    } else {
      // basic mode: bookingUrl optional
      if (safeTrim(bookingUrl).length > 0 && !isValidHttpUrl(bookingUrl)) {
        return "Booking URL must be a valid http(s) link (or leave it blank for FlowPilot Basic).";
      }
    }

    return null;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (authRequired) {
      setError("Please sign in before saving booking settings.");
      return;
    }

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    const payload = {
      slug: slugify(slug),
      mode,
      bookingUrl: bookingUrl.trim(),
      provider: safeTrim(provider) || null,
    };

    setSaving(true);
    const result = await saveBooking(payload);
    setSaving(false);

    if (!result.ok) {
      if (result.status === 401) {
        setAuthRequired(true);
        setError("You’re signed out. Please sign in and try again.");
        return;
      }
      setError(result.error);
      return;
    }

    setSuccess("Saved booking settings.");
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Booking</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#000" }}>
          Choose how your booking page works: use an existing provider link, or FlowPilot Basic (request a time window).
        </p>
      </header>

      {loading ? (
        <p style={{ margin: 0 }}>Loading…</p>
      ) : authRequired ? (
        <section
          style={{
            border: "1px solid #f1c0c0",
            background: "#fff5f5",
            color: "#7a1a1a",
            padding: 14,
            borderRadius: 12,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Sign-in required</div>
          <div style={{ lineHeight: 1.6 }}>You must be signed in to save booking settings.</div>
          <div style={{ marginTop: 12 }}>
            <Link
              href="/sign-in"
              style={{
                display: "inline-block",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              Go to sign-in
            </Link>
          </div>
        </section>
      ) : (
        <form onSubmit={onSave} noValidate>
          <section
            style={{
              border: "1px solid #000",
              borderRadius: 12,
              padding: 18,
              background: "#fff",
              marginBottom: 18,
            }}
          >
            <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>Settings</h2>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label htmlFor="slug" style={{ display: "block", fontWeight: 700 }}>
                  Public booking page slug
                </label>
                <input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g., the-trial-salon"
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
                  Public link: <strong>{publicUrl}</strong>
                </div>
              </div>

              <div>
                <label htmlFor="mode" style={{ display: "block", fontWeight: 700 }}>
                  Booking mode
                </label>
                <select
                  id="mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value === "flowpilot_basic" ? "flowpilot_basic" : "provider")}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    background: "#fff",
                  }}
                >
                  <option value="provider">Use my existing booking provider link</option>
                  <option value="flowpilot_basic">FlowPilot Basic Booking (request a time window)</option>
                </select>
              </div>

              {mode === "provider" ? (
                <>
                  <div>
                    <label htmlFor="bookingUrl" style={{ display: "block", fontWeight: 700 }}>
                      Booking provider URL (required)
                    </label>
                    <input
                      id="bookingUrl"
                      value={bookingUrl}
                      onChange={(e) => setBookingUrl(e.target.value)}
                      placeholder="https://..."
                      style={{
                        marginTop: 8,
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                      }}
                    />
                  </div>

                  <div>
                    <label htmlFor="provider" style={{ display: "block", fontWeight: 700 }}>
                      Provider name (optional)
                    </label>
                    <input
                      id="provider"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      placeholder="e.g., Fresha, Square, Calendly"
                      style={{
                        marginTop: 8,
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                      }}
                    />
                  </div>
                </>
              ) : (
                <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fafafa" }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>FlowPilot Basic Booking</div>
                  <div style={{ lineHeight: 1.6 }}>
                    Customers will request a time window (e.g., Tue 2–5pm). The salon confirms an exact time (or proposes
                    one inside that window). No external booking link required.
                  </div>
                  <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                    Optional: you can still paste a booking URL later if you adopt a provider.
                  </div>
                </section>
              )}

              {error && (
                <div
                  role="alert"
                  style={{
                    border: "1px solid #f1c0c0",
                    background: "#fff5f5",
                    color: "#7a1a1a",
                    padding: 12,
                    borderRadius: 10,
                  }}
                >
                  {error}
                </div>
              )}

              {success && (
                <div
                  role="status"
                  style={{
                    border: "1px solid #c7e6c7",
                    background: "#f3fff3",
                    color: "#1f5c1f",
                    padding: 12,
                    borderRadius: 10,
                  }}
                >
                  {success}
                </div>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #111",
                    background: "#111",
                    color: "#fff",
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? "Saving…" : "Save booking settings"}
                </button>

                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-block",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #111",
                    background: "#fff",
                    color: "#111",
                    textDecoration: "none",
                  }}
                >
                  Open booking page
                </a>
              </div>
            </div>
          </section>
        </form>
      )}

      <nav style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/dashboard"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: "#fff",
            color: "#111",
            textDecoration: "none",
          }}
        >
          Back to dashboard
        </Link>

        <Link
          href="/dashboard/reviews"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: "#fff",
            color: "#111",
            textDecoration: "none",
          }}
        >
          Reviews
        </Link>
      </nav>
    </main>
  );
}
