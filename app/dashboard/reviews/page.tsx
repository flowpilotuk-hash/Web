"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

type ApiErr = { error: string };

type ReviewSettings = {
  reviewUrl: string;
  sendDelayMinutes: number;
  channel: "email" | "sms";
  template: string;
  updatedAt?: string;
};

type GetOk = { review: ReviewSettings | null };

function isApiErr(x: unknown): x is ApiErr {
  return !!x && typeof x === "object" && "error" in x && typeof (x as any).error === "string";
}

function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function getReviewSettings(): Promise<
  { ok: true; data: ReviewSettings | null } | { ok: false; status: number; error: string }
> {
  const res = await fetch("/api/review-settings", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  const data = json as GetOk;
  if (!data || typeof data !== "object" || !("review" in data)) {
    return { ok: false, status: 500, error: "Unexpected response from /api/review-settings." };
  }

  return { ok: true, data: data.review ?? null };
}

async function saveReviewSettings(payload: ReviewSettings): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const res = await fetch("/api/review-settings", {
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

export default function ReviewsPage() {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);

  const [reviewUrl, setReviewUrl] = useState("");
  const [sendDelayMinutes, setSendDelayMinutes] = useState<number>(120);
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [template, setTemplate] = useState(
    "Thanks for visiting us today! If you have 30 seconds, we’d really appreciate a quick review: {review_url}"
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setAuthRequired(false);
      setError(null);
      setSuccess(null);

      const result = await getReviewSettings();

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
        setReviewUrl(result.data.reviewUrl);
        setSendDelayMinutes(result.data.sendDelayMinutes);
        setChannel(result.data.channel);
        setTemplate(result.data.template);
      }

      setLoading(false);
    })();
  }, []);

  function validate(): string | null {
    if (!reviewUrl || !isValidHttpUrl(reviewUrl)) return "Please enter a valid review URL (http/https).";
    if (!Number.isFinite(sendDelayMinutes) || sendDelayMinutes < 0) return "Delay must be 0 or higher.";
    if (safeTrim(template).length < 10) return "Template is too short (10+ characters).";
    return null;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (authRequired) {
      setError("Please sign in before saving review settings.");
      return;
    }

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    const payload: ReviewSettings = {
      reviewUrl: reviewUrl.trim(),
      sendDelayMinutes: Math.floor(sendDelayMinutes),
      channel,
      template: safeTrim(template),
    };

    setSaving(true);
    const result = await saveReviewSettings(payload);
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

    setSuccess("Saved review settings.");
  }

  const previewMessage = safeTrim(template).replaceAll("{review_url}", reviewUrl || "(review link)");

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Reviews</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6 }}>
          After an appointment, we’ll send a review request using this template.
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
          <div style={{ lineHeight: 1.6 }}>You must be signed in to save review settings.</div>
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
            <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>Review request settings</h2>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label htmlFor="reviewUrl" style={{ display: "block", fontWeight: 700 }}>
                  Review link (Google recommended)
                </label>
                <input
                  id="reviewUrl"
                  value={reviewUrl}
                  onChange={(e) => setReviewUrl(e.target.value)}
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label htmlFor="delay" style={{ display: "block", fontWeight: 700 }}>
                    Delay after appointment (minutes)
                  </label>
                  <input
                    id="delay"
                    type="number"
                    min={0}
                    max={10080}
                    value={sendDelayMinutes}
                    onChange={(e) => setSendDelayMinutes(Number(e.target.value))}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                    }}
                  />
                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                    120 minutes = 2 hours (recommended)
                  </div>
                </div>

                <div>
                  <label htmlFor="channel" style={{ display: "block", fontWeight: 700 }}>
                    Channel
                  </label>
                  <select
                    id="channel"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value === "sms" ? "sms" : "email")}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      background: "#fff",
                    }}
                  >
                    <option value="email">Email (recommended first)</option>
                    <option value="sms">SMS (later)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="template" style={{ display: "block", fontWeight: 700 }}>
                  Message template
                </label>
                <textarea
                  id="template"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  rows={4}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    resize: "vertical",
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
                  Use <code>{"{review_url}"}</code> where the link should appear.
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 14,
                  background: "#fafafa",
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Preview</div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{previewMessage}</div>
              </div>

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
                  width: "fit-content",
                }}
              >
                {saving ? "Saving…" : "Save review settings"}
              </button>
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
          href="/dashboard/booking"
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
          Booking
        </Link>
      </nav>
    </main>
  );
}
