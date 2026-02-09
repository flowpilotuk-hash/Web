"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type PriorityLevel = "normal" | "high";
type Status = "queued" | "completed" | "cancelled";

type PriorityPostRequest = {
  id: string;
  createdAtIso: string;
  priority: PriorityLevel;
  desiredPostAtIso?: string; // optional scheduling hint
  instructions: string;
  attachmentsNote: string;
  requiresPromoApproval: boolean;
  status: Status;
};

type ApiGetOk = { requests: PriorityPostRequest[] };
type ApiOk = { ok: true };
type ApiErr = { error: string };

function nowIso(): string {
  return new Date().toISOString();
}

function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isApiErr(x: unknown): x is ApiErr {
  return !!x && typeof x === "object" && "error" in x && typeof (x as any).error === "string";
}

async function getRequests(): Promise<
  { ok: true; data: PriorityPostRequest[] } | { ok: false; status: number; error: string }
> {
  const res = await fetch("/api/priority-posts", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  const data = json as ApiGetOk;
  if (!data || typeof data !== "object" || !Array.isArray((data as any).requests)) {
    return { ok: false, status: 500, error: "Unexpected response from /api/priority-posts." };
  }

  return { ok: true, data: data.requests };
}

async function saveRequests(requests: PriorityPostRequest[]): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const res = await fetch("/api/priority-posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ requests })
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  const ok = json as ApiOk;
  if (!ok || typeof ok !== "object" || (ok as any).ok !== true) {
    return { ok: false, status: 500, error: "Unexpected response from /api/priority-posts." };
  }

  return { ok: true };
}

function toIsoFromLocalDateTime(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function PriorityPostPage() {
  const [loaded, setLoaded] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  const [requests, setRequests] = useState<PriorityPostRequest[]>([]);

  const [priority, setPriority] = useState<PriorityLevel>("normal");
  const [desiredPostAtLocal, setDesiredPostAtLocal] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");
  const [attachmentsNote, setAttachmentsNote] = useState<string>("");
  const [requiresPromoApproval, setRequiresPromoApproval] = useState<boolean>(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoaded(false);
      setError(null);
      setSuccess(null);
      setAuthRequired(false);

      const result = await getRequests();

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

      // newest first already, but ensure stable order
      const sorted = [...result.data].sort((a, b) => (a.createdAtIso < b.createdAtIso ? 1 : -1));
      setRequests(sorted);
      setLoaded(true);
    })();
  }, []);

  const queuedCount = useMemo(
    () => requests.filter((r) => r.status === "queued").length,
    [requests]
  );

  function validate(): string | null {
    if (safeTrim(instructions).length < 10) return "Please add instructions (at least 10 characters).";
    if (safeTrim(attachmentsNote).length === 0) {
      return "Please describe the media to use (e.g., 'Use the 3 newest nail photos in the shared album').";
    }
    return null;
  }

  async function persist(next: PriorityPostRequest[]) {
    setSaving(true);
    const result = await saveRequests(next);
    setSaving(false);

    if (!result.ok) {
      if (result.status === 401) {
        setAuthRequired(true);
        setError("You’re signed out. Please sign in and try again.");
        return false;
      }
      setError(result.error);
      return false;
    }

    return true;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (authRequired) {
      setError("Please sign in before creating requests.");
      return;
    }

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    const desiredIso = toIsoFromLocalDateTime(desiredPostAtLocal);

    const newRequest: PriorityPostRequest = {
      id: makeId(),
      createdAtIso: nowIso(),
      priority,
      desiredPostAtIso: desiredIso ?? undefined,
      instructions: safeTrim(instructions),
      attachmentsNote: safeTrim(attachmentsNote),
      requiresPromoApproval,
      status: "queued"
    };

    const next = [newRequest, ...requests];
    setRequests(next);

    const ok = await persist(next);
    if (!ok) return;

    setSuccess("Priority post request queued.");
    setPriority("normal");
    setDesiredPostAtLocal("");
    setInstructions("");
    setAttachmentsNote("");
    setRequiresPromoApproval(false);
  }

  async function updateStatus(id: string, status: Status) {
    setError(null);
    setSuccess(null);

    const next = requests.map((r) => (r.id === id ? { ...r, status } : r));
    setRequests(next);

    const ok = await persist(next);
    if (!ok) return;

    setSuccess("Updated.");
  }

  async function clearCompletedCancelled() {
    setError(null);
    setSuccess(null);

    const next = requests.filter((r) => r.status === "queued");
    setRequests(next);

    const ok = await persist(next);
    if (!ok) return;

    setSuccess("Cleared completed/cancelled requests.");
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Priority post request</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          Use this when you want something specific marketed. If nothing is submitted, the system continues normal automated posting.
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
        <h2 style={{ fontSize: 16, margin: "0 0 8px 0" }}>Rules</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>You can still post manually on your social accounts at any time.</li>
          <li>This request will be treated as higher priority than the normal AI schedule (when automation is added).</li>
          <li>Promotions/loyalty/limited-time offers must be approved by you before posting.</li>
        </ul>
      </section>

      {!loaded ? (
        <p style={{ margin: 0 }}>Loading…</p>
      ) : authRequired ? (
        <section
          style={{
            border: "1px solid #f1c0c0",
            background: "#fff5f5",
            color: "#7a1a1a",
            padding: 14,
            borderRadius: 12
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Sign-in required</div>
          <div style={{ lineHeight: 1.6 }}>You must be signed in to load/save priority post requests.</div>
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
                textDecoration: "none"
              }}
            >
              Go to sign-in
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff", marginBottom: 18 }}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>Create a request</h2>

            <form onSubmit={onSubmit} noValidate>
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <label htmlFor="priority" style={{ display: "block", fontWeight: 600 }}>
                      Priority
                    </label>
                    <select
                      id="priority"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                      style={{
                        marginTop: 8,
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                        background: "#fff"
                      }}
                    >
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="desiredAt" style={{ display: "block", fontWeight: 600 }}>
                      Desired post time (optional)
                    </label>
                    <input
                      id="desiredAt"
                      type="datetime-local"
                      value={desiredPostAtLocal}
                      onChange={(e) => setDesiredPostAtLocal(e.target.value)}
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
                  <label htmlFor="instructions" style={{ display: "block", fontWeight: 600 }}>
                    What should we post? (instructions)
                  </label>
                  <textarea
                    id="instructions"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    rows={4}
                    placeholder="e.g., Promote our new gel polish range. Mention 'Book now' but no discounts unless approved."
                    style={{
                      marginTop: 8,
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      resize: "vertical"
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="attachmentsNote" style={{ display: "block", fontWeight: 600 }}>
                    Which photos/videos should we use?
                  </label>
                  <input
                    id="attachmentsNote"
                    value={attachmentsNote}
                    onChange={(e) => setAttachmentsNote(e.target.value)}
                    placeholder="e.g., Use the 2 newest photos in the shared album + the short video named 'new-set.mp4'"
                    style={{
                      marginTop: 8,
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc"
                    }}
                  />
                </div>

                <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 14, background: "#fafafa" }}>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={requiresPromoApproval}
                      onChange={(e) => setRequiresPromoApproval(e.target.checked)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      This request includes a promotion/offer/loyalty message (requires explicit approval before posting).
                    </span>
                  </label>
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
                  {saving ? "Saving…" : "Queue request"}
                </button>
              </div>
            </form>
          </section>

          <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Request queue</h2>
              <div style={{ color: "#555", fontSize: 13, alignSelf: "center" }}>
                {loaded ? `Queued: ${queuedCount}` : "Loading…"}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {requests.length === 0 ? (
                <p style={{ margin: 0 }}>No requests yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {requests.map((r) => (
                    <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700 }}>
                          {r.priority === "high" ? "High priority" : "Normal priority"} • {r.status.toUpperCase()}
                        </div>
                        <div style={{ color: "#555", fontSize: 13 }}>
                          Created: {new Date(r.createdAtIso).toLocaleString()}
                        </div>
                      </div>

                      {r.desiredPostAtIso && (
                        <div style={{ marginTop: 8, color: "#333" }}>
                          <strong>Desired time:</strong> {new Date(r.desiredPostAtIso).toLocaleString()}
                        </div>
                      )}

                      <div style={{ marginTop: 8 }}>
                        <strong>Instructions:</strong>
                        <p style={{ margin: "6px 0 0 0", lineHeight: 1.6 }}>{r.instructions}</p>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        <strong>Media to use:</strong>
                        <p style={{ margin: "6px 0 0 0", lineHeight: 1.6 }}>{r.attachmentsNote}</p>
                      </div>

                      <div style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
                        Promo flag: {r.requiresPromoApproval ? "Yes (requires approval)" : "No"}
                      </div>

                      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {r.status !== "completed" && (
                          <button
                            type="button"
                            onClick={() => updateStatus(r.id, "completed")}
                            disabled={saving}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid #ddd",
                              background: "#fff",
                              cursor: saving ? "not-allowed" : "pointer",
                              opacity: saving ? 0.7 : 1
                            }}
                          >
                            Mark completed
                          </button>
                        )}
                        {r.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => updateStatus(r.id, "cancelled")}
                            disabled={saving}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid #ddd",
                              background: "#fff",
                              cursor: saving ? "not-allowed" : "pointer",
                              opacity: saving ? 0.7 : 1
                            }}
                          >
                            Cancel
                          </button>
                        )}
                        {r.status !== "queued" && (
                          <button
                            type="button"
                            onClick={() => updateStatus(r.id, "queued")}
                            disabled={saving}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid #ddd",
                              background: "#fff",
                              cursor: saving ? "not-allowed" : "pointer",
                              opacity: saving ? 0.7 : 1
                            }}
                          >
                            Re-queue
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {requests.some((r) => r.status !== "queued") && (
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  onClick={clearCompletedCancelled}
                  disabled={saving}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.7 : 1
                  }}
                >
                  Clear completed/cancelled
                </button>
              </div>
            )}
          </section>

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
          </nav>
        </>
      )}
    </main>
  );
}
