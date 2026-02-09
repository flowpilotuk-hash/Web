"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type PostingMode = "daily" | "weekly";

type ScheduleSettings = {
  mode: PostingMode;
  daysOfWeek: number[]; // 0=Sun ... 6=Sat
  windowStart: string; // "HH:MM"
  windowEnd: string; // "HH:MM"
  timezoneLabel: string;
};

type ApiGetOk = { schedule: ScheduleSettings | null };
type ApiErr = { error: string };

const DAY_LABELS: Array<{ idx: number; label: string }> = [
  { idx: 1, label: "Mon" },
  { idx: 2, label: "Tue" },
  { idx: 3, label: "Wed" },
  { idx: 4, label: "Thu" },
  { idx: 5, label: "Fri" },
  { idx: 6, label: "Sat" },
  { idx: 0, label: "Sun" }
];

function isApiErr(x: unknown): x is ApiErr {
  return !!x && typeof x === "object" && "error" in x && typeof (x as any).error === "string";
}

function isValidTimeHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function timeToMinutes(value: string): number | null {
  if (!isValidTimeHHMM(value)) return null;
  const [h, m] = value.split(":").map((x) => Number(x));
  return h * 60 + m;
}

async function getSchedule(): Promise<
  { ok: true; data: ScheduleSettings | null } | { ok: false; status: number; error: string }
> {
  const res = await fetch("/api/schedule", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  const data = json as ApiGetOk;
  if (!data || typeof data !== "object" || !("schedule" in data)) {
    return { ok: false, status: 500, error: "Unexpected response from /api/schedule." };
  }

  return { ok: true, data: data.schedule ?? null };
}

async function saveSchedule(payload: ScheduleSettings): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const res = await fetch("/api/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload)
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  return { ok: true };
}

export default function SchedulePage() {
  const [loaded, setLoaded] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  const [mode, setMode] = useState<PostingMode>("daily");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri default
  const [windowStart, setWindowStart] = useState<string>("09:00");
  const [windowEnd, setWindowEnd] = useState<string>("18:00");
  const [timezoneLabel, setTimezoneLabel] = useState<string>("Europe/London");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const daysHuman = useMemo(() => {
    const set = new Set(daysOfWeek);
    return DAY_LABELS.filter((d) => set.has(d.idx))
      .map((d) => d.label)
      .join(", ");
  }, [daysOfWeek]);

  useEffect(() => {
    (async () => {
      setLoaded(false);
      setError(null);
      setSuccess(null);
      setAuthRequired(false);

      const result = await getSchedule();

      if (!result.ok) {
        if (result.status === 401) {
          setAuthRequired(true);
          setLoaded(true);
          return;
        }
        setError(result.error);
        setLoaded(true);
        return;
      }

      if (result.data) {
        setMode(result.data.mode);
        setDaysOfWeek(result.data.daysOfWeek.length > 0 ? result.data.daysOfWeek : [1, 2, 3, 4, 5]);
        setWindowStart(result.data.windowStart);
        setWindowEnd(result.data.windowEnd);
        setTimezoneLabel(result.data.timezoneLabel || "Europe/London");
      }

      setLoaded(true);
    })();
  }, []);

  function toggleDay(idx: number) {
    setError(null);
    setSuccess(null);

    setDaysOfWeek((prev) => {
      const set = new Set(prev);
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      return Array.from(set).sort((a, b) => a - b);
    });
  }

  function validate(): string | null {
    if (daysOfWeek.length === 0) return "Please select at least one posting day.";

    if (!isValidTimeHHMM(windowStart) || !isValidTimeHHMM(windowEnd)) {
      return "Please enter valid times (HH:MM).";
    }

    const startMin = timeToMinutes(windowStart);
    const endMin = timeToMinutes(windowEnd);
    if (startMin === null || endMin === null) return "Please enter valid times (HH:MM).";

    if (startMin >= endMin) return "Time window end must be later than the start.";

    if (timezoneLabel.trim().length === 0) return "Please enter a timezone label.";

    return null;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (authRequired) {
      setError("Please sign in before saving schedule.");
      return;
    }

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    const payload: ScheduleSettings = {
      mode,
      daysOfWeek: Array.from(new Set(daysOfWeek)).sort((a, b) => a - b),
      windowStart,
      windowEnd,
      timezoneLabel: timezoneLabel.trim()
    };

    setSaving(true);
    const result = await saveSchedule(payload);
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

    setSuccess("Schedule saved to Supabase.");
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Posting schedule</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          Choose when the automated system is allowed to post. (Saved to your account.)
        </p>
      </header>

      <section
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 18,
          background: "#fafafa",
          marginBottom: 18
        }}
      >
        <h2 style={{ fontSize: 16, margin: "0 0 8px 0" }}>Summary</h2>
        {!loaded ? (
          <p style={{ margin: 0 }}>Loading…</p>
        ) : authRequired ? (
          <p style={{ margin: 0 }}>Sign-in required to load/save schedule.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              <strong>Mode:</strong> {mode === "daily" ? "Daily" : "Weekly"}
            </li>
            <li>
              <strong>Days:</strong> {daysHuman || "—"}
            </li>
            <li>
              <strong>Time window:</strong> {windowStart}–{windowEnd} ({timezoneLabel})
            </li>
          </ul>
        )}
      </section>

      <form onSubmit={onSave} noValidate>
        <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff", marginBottom: 18 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>Settings</h2>

          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label htmlFor="mode" style={{ display: "block", fontWeight: 600 }}>
                Posting mode
              </label>
              <select
                id="mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as PostingMode)}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  background: "#fff"
                }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>

            <div>
              <div style={{ fontWeight: 600 }}>Allowed days</div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {DAY_LABELS.map((d) => {
                  const selected = daysOfWeek.includes(d.idx);
                  return (
                    <button
                      key={d.idx}
                      type="button"
                      onClick={() => toggleDay(d.idx)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: "1px solid #ddd",
                        background: selected ? "#111" : "#fff",
                        color: selected ? "#fff" : "#111",
                        cursor: "pointer"
                      }}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
                Tip: Many businesses choose Mon–Fri for daily posting, or 2–3 days per week for weekly posting.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label htmlFor="windowStart" style={{ display: "block", fontWeight: 600 }}>
                  Window start
                </label>
                <input
                  id="windowStart"
                  type="time"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ccc"
                  }}
                />
              </div>

              <div>
                <label htmlFor="windowEnd" style={{ display: "block", fontWeight: 600 }}>
                  Window end
                </label>
                <input
                  id="windowEnd"
                  type="time"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ccc"
                  }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="timezoneLabel" style={{ display: "block", fontWeight: 600 }}>
                Timezone (label)
              </label>
              <input
                id="timezoneLabel"
                value={timezoneLabel}
                onChange={(e) => setTimezoneLabel(e.target.value)}
                placeholder="e.g., Europe/London"
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc"
                }}
              />
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  border: "1px solid #f1c0c0",
                  background: "#fff5f5",
                  color: "#7a1a1a",
                  padding: 12,
                  borderRadius: 10
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
                  borderRadius: 10
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
                width: "fit-content",
                opacity: saving ? 0.7 : 1
              }}
            >
              {saving ? "Saving…" : "Save schedule"}
            </button>
          </div>
        </section>
      </form>

      <nav style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/dashboard"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            color: "#111",
            textDecoration: "none"
          }}
        >
          Back to dashboard
        </Link>

        <Link
          href="/dashboard/media"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            color: "#111",
            textDecoration: "none"
          }}
        >
          Media
        </Link>

        <Link
          href="/dashboard/priority-post"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            color: "#111",
            textDecoration: "none"
          }}
        >
          Priority posts
        </Link>
      </nav>
    </main>
  );
}
