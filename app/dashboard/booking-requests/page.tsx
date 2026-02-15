"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ApiErr = { error: string };

type BookingRequestStatus = "pending" | "confirmed" | "declined";

type BookingRequest = {
  id: string;
  slug: string;

  customer_name: string;
  customer_email: string;
  customer_phone: string | null;

  requested_date: string; // YYYY-MM-DD
  window_start: string; // HH:MM
  window_end: string; // HH:MM
  notes: string | null;

  status: BookingRequestStatus;

  confirmed_start: string | null; // ISO
  confirmed_end: string | null; // ISO

  created_at: string; // ISO
};

function isApiErr(x: unknown): x is ApiErr {
  return !!x && typeof x === "object" && "error" in x && typeof (x as any).error === "string";
}

function formatDate(isoOrDate: string): string {
  const d = new Date(isoOrDate.includes("T") ? isoOrDate : `${isoOrDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoOrDate;
  return d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function formatTimeWindow(dateYmd: string, start: string, end: string): string {
  return `${formatDate(dateYmd)} • ${start}–${end}`;
}

function toLocalDatetimeValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function addMinutesIso(startIso: string, minutes: number): string {
  const d = new Date(startIso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

async function fetchRequests(status?: BookingRequestStatus) {
  const url = status ? `/api/booking-requests-admin?status=${status}` : "/api/booking-requests-admin";
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const data = json as any;
  return (data?.requests ?? []) as BookingRequest[];
}

async function updateRequest(input: {
  requestId: string;
  status: BookingRequestStatus;
  confirmedStartIso?: string | null;
  confirmedEndIso?: string | null;
}) {
  const res = await fetch("/api/booking-requests-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(input),
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
}

export default function BookingRequestsPage() {
  const [activeTab, setActiveTab] = useState<BookingRequestStatus>("pending");

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmStartLocal, setConfirmStartLocal] = useState<string>("");
  const [confirmDurationMin, setConfirmDurationMin] = useState<number>(60);

  const [workingId, setWorkingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await fetchRequests(activeTab);
      setRequests(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const stats = useMemo(() => {
    const pending = requests.filter((r) => r.status === "pending").length;
    const confirmed = requests.filter((r) => r.status === "confirmed").length;
    const declined = requests.filter((r) => r.status === "declined").length;
    return { pending, confirmed, declined, total: requests.length };
  }, [requests]);

  function openConfirm(r: BookingRequest) {
    setError(null);
    setNotice(null);

    setConfirmingId(r.id);

    // Prefill confirmed start: requested date + window start in local time
    const guessLocal = `${r.requested_date}T${r.window_start}`;
    setConfirmStartLocal(guessLocal);
    setConfirmDurationMin(60);
  }

  async function doConfirm() {
    if (!confirmingId) return;

    setError(null);
    setNotice(null);

    const startLocal = confirmStartLocal.trim();
    if (!startLocal) {
      setError("Please choose a confirmed start time.");
      return;
    }

    const start = new Date(startLocal);
    if (Number.isNaN(start.getTime())) {
      setError("Invalid start time.");
      return;
    }

    const startIso = start.toISOString();
    const endIso = addMinutesIso(startIso, Math.max(15, Math.min(240, Math.floor(confirmDurationMin || 60))));

    setWorkingId(confirmingId);
    try {
      await updateRequest({
        requestId: confirmingId,
        status: "confirmed",
        confirmedStartIso: startIso,
        confirmedEndIso: endIso,
      });
      setNotice("Confirmed.");
      setConfirmingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm.");
    } finally {
      setWorkingId(null);
    }
  }

  async function doDecline(id: string) {
    setError(null);
    setNotice(null);

    setWorkingId(id);
    try {
      await updateRequest({ requestId: id, status: "declined" });
      setNotice("Declined.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to decline.");
    } finally {
      setWorkingId(null);
    }
  }

  async function doResetToPending(id: string) {
    setError(null);
    setNotice(null);

    setWorkingId(id);
    try {
      await updateRequest({ requestId: id, status: "pending" });
      setNotice("Reset to pending.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset.");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Booking requests</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6 }}>
          Requests come from your public booking page when using FlowPilot Basic Booking (time window requests).
        </p>
      </header>

      <section
        style={{
          border: "1px solid #000",
          borderRadius: 12,
          padding: 14,
          background: "#fff",
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <TabButton label={`Pending (${activeTab === "pending" ? stats.total : "—"})`} active={activeTab === "pending"} onClick={() => setActiveTab("pending")} />
          <TabButton label="Confirmed" active={activeTab === "confirmed"} onClick={() => setActiveTab("confirmed")} />
          <TabButton label="Declined" active={activeTab === "declined"} onClick={() => setActiveTab("declined")} />

          <button
            type="button"
            onClick={() => void load()}
            style={{
              marginLeft: "auto",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #000",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Refresh
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          Showing: <strong>{activeTab}</strong> • Total returned: <strong>{stats.total}</strong>
        </div>
      </section>

      {error && (
        <div
          style={{
            color: "#7a1a1a",
            background: "#fff5f5",
            border: "1px solid #f1c0c0",
            padding: 12,
            borderRadius: 10,
            marginBottom: 18,
          }}
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          style={{
            color: "#1f5c1f",
            background: "#f3fff3",
            border: "1px solid #c7e6c7",
            padding: 12,
            borderRadius: 10,
            marginBottom: 18,
          }}
        >
          {notice}
        </div>
      )}

      {loading ? (
        <p style={{ margin: 0 }}>Loading…</p>
      ) : requests.length === 0 ? (
        <p style={{ margin: 0 }}>No requests in this view.</p>
      ) : (
        <section style={{ display: "grid", gap: 12 }}>
          {requests.map((r) => (
            <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>
                  {r.customer_name} • <span style={{ opacity: 0.8 }}>{r.customer_email}</span>
                </div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  Submitted: {new Date(r.created_at).toLocaleString()}
                </div>
              </div>

              <div style={{ marginTop: 10, lineHeight: 1.6 }}>
                <strong>Requested:</strong> {formatTimeWindow(r.requested_date, r.window_start, r.window_end)}
              </div>

              {r.customer_phone && (
                <div style={{ marginTop: 6, lineHeight: 1.6 }}>
                  <strong>Phone:</strong> {r.customer_phone}
                </div>
              )}

              {r.notes && (
                <div style={{ marginTop: 8, lineHeight: 1.6 }}>
                  <strong>Notes:</strong> {r.notes}
                </div>
              )}

              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                <strong>Status:</strong> {r.status.toUpperCase()}
              </div>

              {r.status === "confirmed" && r.confirmed_start && r.confirmed_end && (
                <div style={{ marginTop: 8, lineHeight: 1.6 }}>
                  <strong>Confirmed:</strong> {new Date(r.confirmed_start).toLocaleString()} –{" "}
                  {new Date(r.confirmed_end).toLocaleString()}
                </div>
              )}

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {r.status === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => openConfirm(r)}
                      disabled={workingId === r.id}
                      style={primaryBtn(workingId === r.id)}
                    >
                      Confirm
                    </button>

                    <button
                      type="button"
                      onClick={() => void doDecline(r.id)}
                      disabled={workingId === r.id}
                      style={secondaryBtn(workingId === r.id)}
                    >
                      Decline
                    </button>
                  </>
                )}

                {r.status !== "pending" && (
                  <button
                    type="button"
                    onClick={() => void doResetToPending(r.id)}
                    disabled={workingId === r.id}
                    style={secondaryBtn(workingId === r.id)}
                  >
                    Reset to pending
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {confirmingId && (
        <div role="dialog" aria-modal="true" style={modalOverlay} onClick={() => setConfirmingId(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Confirm booking</div>

            <label style={{ display: "block", fontWeight: 800 }}>Confirmed start</label>
            <input
              type="datetime-local"
              value={confirmStartLocal}
              onChange={(e) => setConfirmStartLocal(e.target.value)}
              style={modalInput}
            />

            <label style={{ display: "block", fontWeight: 800, marginTop: 12 }}>Duration (minutes)</label>
            <input
              type="number"
              min={15}
              max={240}
              value={confirmDurationMin}
              onChange={(e) => setConfirmDurationMin(Number(e.target.value))}
              style={modalInput}
            />

            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => setConfirmingId(null)} style={secondaryBtn(false)}>
                Cancel
              </button>

              <button type="button" onClick={() => void doConfirm()} style={primaryBtn(workingId === confirmingId)} disabled={workingId === confirmingId}>
                {workingId === confirmingId ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
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
            fontWeight: 800,
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
            fontWeight: 800,
          }}
        >
          Booking settings
        </Link>
      </nav>
    </main>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid #000",
        background: active ? "#7fff00" : "#fff",
        cursor: "pointer",
        fontWeight: 900,
      }}
    >
      {label}
    </button>
  );
}

function primaryBtn(disabled: boolean) {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 800,
    opacity: disabled ? 0.7 : 1,
  } as const;
}

function secondaryBtn(disabled: boolean) {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "#fff",
    color: "#111",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 800,
    opacity: disabled ? 0.7 : 1,
  } as const;
}

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const modalCard: React.CSSProperties = {
  width: "min(520px, 100%)",
  background: "#fff",
  borderRadius: 16,
  border: "1px solid rgba(0,0,0,0.12)",
  padding: 18,
};

const modalInput: React.CSSProperties = {
  marginTop: 8,
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ccc",
};

