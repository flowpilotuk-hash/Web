"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PlanPost = {
  source: "priority" | "scheduled";
  platform: "instagram" | "facebook";
  format: "post" | "reel" | "story";
  suggested_time_local: string; // "HH:MM"
  caption: string;
  hashtags: string[];
  media_instructions: string;
  approval_required: boolean;
  approval_reason: string;
};

type PlanDay = {
  date: string; // YYYY-MM-DD
  posts: PlanPost[];
};

type Plan = {
  horizon_start_date: string;
  horizon_end_date: string;
  days: PlanDay[];
};

type ApiErr = { error: string };

type ApiPlanOk = {
  plan: Plan;
  meta?: { model?: string; generatedAt?: string; extractedFrom?: string };
};

type ApprovalStatus = "pending" | "approved" | "rejected";

type ApprovalRecord = {
  status: ApprovalStatus;
  decidedAtIso?: string;
  rejectReason?: string;
};

type ApprovalsGetOk = {
  approvals: Record<string, ApprovalRecord>;
};

type DispatchGetOk = {
  dispatch: Record<string, { ready: boolean; updatedAtIso: string }>;
};

const PLAN_CACHE_KEY = "smm:plan-cache:v1";
const APPROVALS_STORAGE_KEY = "smm:plan-approvals:v1";

function isApiErr(x: unknown): x is ApiErr {
  return !!x && typeof x === "object" && "error" in x && typeof (x as any).error === "string";
}

function pillStyle(bg: string, fg: string) {
  return {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    background: bg,
    color: fg,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.2
  } as const;
}

function formatDateLabel(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function joinHashtags(tags: string[]): string {
  const cleaned = (tags ?? [])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/^#+/, "")}`));
  return cleaned.join(" ");
}

function makePostKey(dayDate: string, post: PlanPost, idx: number): string {
  // IMPORTANT: Must match Plan page so approvals/dispatch map to same key.
  return [
    dayDate,
    String(idx),
    post.platform,
    post.format,
    post.suggested_time_local,
    post.caption.slice(0, 80),
    post.media_instructions.slice(0, 80)
  ].join("|");
}

function loadPlanCache(): ApiPlanOk | null {
  try {
    const raw = localStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (!parsed?.data?.plan) return null;
    return parsed.data as ApiPlanOk;
  } catch {
    return null;
  }
}

function loadApprovalsLocal(): Record<string, ApprovalRecord> {
  try {
    const raw = localStorage.getItem(APPROVALS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, ApprovalRecord>;
  } catch {
    return {};
  }
}

async function fetchApprovalsServer(): Promise<Record<string, ApprovalRecord>> {
  const res = await fetch("/api/plan-approvals", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    if (isApiErr(json)) throw new Error(json.error);
    throw new Error(`Failed to load approvals (HTTP ${res.status}).`);
  }

  const data = json as ApprovalsGetOk;
  if (!data || typeof data !== "object" || !("approvals" in data)) {
    throw new Error("Unexpected response from /api/plan-approvals.");
  }

  return data.approvals ?? {};
}

async function fetchDispatch(): Promise<Record<string, { ready: boolean; updatedAtIso: string }>> {
  const res = await fetch("/api/dispatch", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    if (isApiErr(json)) throw new Error(json.error);
    throw new Error(`Failed to load dispatch (HTTP ${res.status}).`);
  }

  const data = json as DispatchGetOk;
  if (!data || typeof data !== "object" || !("dispatch" in data)) {
    throw new Error("Unexpected response from /api/dispatch.");
  }

  return data.dispatch ?? {};
}

async function setDispatchReady(input: { postKey: string; ready: boolean }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const res = await fetch("/api/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(input)
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Dispatch update failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  return { ok: true };
}

type QueueItem = {
  key: string;
  date: string;
  time: string;
  platform: PlanPost["platform"];
  format: PlanPost["format"];
  source: PlanPost["source"];
  caption: string;
  hashtags: string;
  media: string;
  status: "ready" | "blocked";
  blockedReason?: string;

  // Dispatch flags:
  dispatchReady: boolean;
  dispatchUpdatedAtIso?: string;
};

export default function QueuePage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);

  const [approvals, setApprovals] = useState<Record<string, ApprovalRecord>>({});
  const [approvalsSource, setApprovalsSource] = useState<"server" | "local">("local");

  const [dispatch, setDispatch] = useState<Record<string, { ready: boolean; updatedAtIso: string }>>({});
  const [dispatchSource, setDispatchSource] = useState<"server" | "none">("none");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setNotice(null);

        const cached = loadPlanCache();
        if (!cached?.plan) {
          setError("No cached plan found. Go to Plan and generate a plan first.");
          setPlan(null);
          setLoading(false);
          return;
        }

        setPlan(cached.plan);

        // Approvals: prefer server, fallback local
        try {
          const serverApprovals = await fetchApprovalsServer();
          setApprovals(serverApprovals);
          setApprovalsSource("server");
        } catch {
          setApprovals(loadApprovalsLocal());
          setApprovalsSource("local");
        }

        // Dispatch flags: server only; if unauthorized, we simply show none and prompt sign-in
        try {
          const d = await fetchDispatch();
          setDispatch(d);
          setDispatchSource("server");
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to load dispatch flags.";
          if (msg.toLowerCase().includes("unauthorized")) {
            setDispatch({});
            setDispatchSource("none");
            setNotice("Sign in required to mark items Ready to post.");
          } else {
            setDispatch({});
            setDispatchSource("none");
          }
        }

        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error.");
        setLoading(false);
      }
    })();
  }, []);

  const queue = useMemo<QueueItem[]>(() => {
    if (!plan) return [];

    const items: QueueItem[] = [];

    for (const day of plan.days) {
      day.posts.forEach((p, idx) => {
        const key = makePostKey(day.date, p, idx);
        const approval = approvals[key];

        const needsApproval = p.approval_required;
        const approved = !needsApproval || approval?.status === "approved";
        const rejected = needsApproval && approval?.status === "rejected";
        const pending = needsApproval && (!approval || approval.status === "pending");

        const status: QueueItem["status"] = approved ? "ready" : "blocked";

        let blockedReason: string | undefined;
        if (rejected) blockedReason = "Rejected by client";
        if (pending) blockedReason = "Awaiting client approval";

        const dispatchRow = dispatch[key];
        const dispatchReady = Boolean(dispatchRow?.ready);
        const dispatchUpdatedAtIso = dispatchRow?.updatedAtIso;

        items.push({
          key,
          date: day.date,
          time: p.suggested_time_local,
          platform: p.platform,
          format: p.format,
          source: p.source,
          caption: p.caption,
          hashtags: joinHashtags(p.hashtags),
          media: p.media_instructions,
          status,
          blockedReason,
          dispatchReady,
          dispatchUpdatedAtIso
        });
      });
    }

    items.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    return items;
  }, [plan, approvals, dispatch]);

  const summary = useMemo(() => {
    const total = queue.length;
    const ready = queue.filter((q) => q.status === "ready").length;
    const blocked = total - ready;
    const markedReady = queue.filter((q) => q.status === "ready" && q.dispatchReady).length;
    return { total, ready, blocked, markedReady };
  }, [queue]);

  async function toggleDispatch(postKey: string, nextReady: boolean) {
    setError(null);
    setNotice(null);

    setSavingKey(postKey);

    // optimistic UI
    setDispatch((prev) => ({
      ...prev,
      [postKey]: { ready: nextReady, updatedAtIso: new Date().toISOString() }
    }));

    const result = await setDispatchReady({ postKey, ready: nextReady });

    if (!result.ok) {
      // rollback optimistic change by refetching
      try {
        const d = await fetchDispatch();
        setDispatch(d);
        setDispatchSource("server");
      } catch {
        // If refetch fails, keep optimistic state but inform user
      }

      if (result.status === 401) {
        setNotice("Sign in required to mark items Ready to post.");
      } else {
        setError(result.error);
      }

      setSavingKey(null);
      return;
    }

    // confirm from server
    try {
      const d = await fetchDispatch();
      setDispatch(d);
      setDispatchSource("server");
      setNotice(nextReady ? "Marked Ready to post." : "Unmarked (not Ready).");
    } catch {
      setNotice(nextReady ? "Marked Ready to post." : "Unmarked (not Ready).");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Posting queue</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          This shows which planned posts are <strong>ready</strong> vs <strong>blocked</strong> based on approvals.
          Now you can also mark “Ready to post” (dispatch) — actual auto-posting comes later.
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
        {loading ? (
          <p style={{ margin: 0 }}>Loading queue…</p>
        ) : error ? (
          <div
            style={{
              color: "#7a1a1a",
              background: "#fff5f5",
              border: "1px solid #f1c0c0",
              padding: 12,
              borderRadius: 10
            }}
          >
            {error}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={pillStyle("#fff", "#111")}>Total: {summary.total}</span>
            <span style={pillStyle("#f3fff3", "#1f5c1f")}>Approved: {summary.ready}</span>
            <span style={pillStyle("#fff5cc", "#6b4e00")}>Blocked: {summary.blocked}</span>
            <span style={pillStyle("#e9f2ff", "#003a8c")}>Marked Ready: {summary.markedReady}</span>

            <span
              style={pillStyle(
                approvalsSource === "server" ? "#f3fff3" : "#fff5cc",
                approvalsSource === "server" ? "#1f5c1f" : "#6b4e00"
              )}
            >
              Approvals: {approvalsSource === "server" ? "Synced" : "Local"}
            </span>

            <span style={pillStyle(dispatchSource === "server" ? "#f3fff3" : "#fff5cc", dispatchSource === "server" ? "#1f5c1f" : "#6b4e00")}>
              Dispatch: {dispatchSource === "server" ? "Synced" : "Unavailable"}
            </span>
          </div>
        )}
      </section>

      {notice && (
        <div
          style={{
            color: "#003a8c",
            background: "#e9f2ff",
            border: "1px solid #c7dcff",
            padding: 12,
            borderRadius: 10,
            marginBottom: 18
          }}
        >
          {notice}
        </div>
      )}

      {!loading && !error && (
        <section style={{ display: "grid", gap: 12 }}>
          {queue.map((q) => {
            const canDispatch = q.status === "ready" && dispatchSource === "server";
            const isSaving = savingKey === q.key;

            return (
              <div key={q.key} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={pillStyle("#111", "#fff")}>{q.platform.toUpperCase()}</span>
                    <span style={pillStyle("#fff", "#111")}>{q.format.toUpperCase()}</span>
                    <span style={pillStyle("#e9f2ff", "#003a8c")}>{q.source.toUpperCase()}</span>
                    <span style={pillStyle("#fff", "#111")}>
                      {formatDateLabel(q.date)} • {q.time}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {q.status === "ready" ? (
                      <span style={pillStyle("#f3fff3", "#1f5c1f")}>APPROVED</span>
                    ) : (
                      <span style={pillStyle("#fff5cc", "#6b4e00")}>BLOCKED</span>
                    )}

                    {q.status === "ready" && q.dispatchReady ? (
                      <span style={pillStyle("#e9f2ff", "#003a8c")}>READY TO POST</span>
                    ) : q.status === "ready" ? (
                      <span style={pillStyle("#fff", "#111")}>NOT READY</span>
                    ) : null}
                  </div>
                </div>

                {q.status === "blocked" && q.blockedReason && (
                  <div style={{ marginTop: 10, color: "#6b4e00" }}>
                    <strong>Blocked:</strong> {q.blockedReason}
                  </div>
                )}

                <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    disabled={!canDispatch || isSaving}
                    onClick={() => toggleDispatch(q.key, !q.dispatchReady)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid #111",
                      background: canDispatch ? "#111" : "#ddd",
                      color: canDispatch ? "#fff" : "#666",
                      cursor: canDispatch && !isSaving ? "pointer" : "not-allowed",
                      opacity: isSaving ? 0.7 : 1
                    }}
                    title={
                      dispatchSource !== "server"
                        ? "Sign in is required to use dispatch."
                        : q.status !== "ready"
                          ? "This item is blocked until approved."
                          : "Toggle Ready to post"
                    }
                  >
                    {isSaving ? "Saving…" : q.dispatchReady ? "Unmark Ready" : "Mark Ready to post"}
                  </button>

                  {q.dispatchUpdatedAtIso && q.status === "ready" && (
                    <span style={{ color: "#555", fontSize: 13 }}>
                      Updated: {new Date(q.dispatchUpdatedAtIso).toLocaleString()}
                    </span>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <strong>Caption</strong>
                  <p style={{ margin: "6px 0 0 0", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{q.caption}</p>
                </div>

                <div style={{ marginTop: 10 }}>
                  <strong>Hashtags</strong>
                  <p style={{ margin: "6px 0 0 0", lineHeight: 1.6, color: "#333" }}>{q.hashtags}</p>
                </div>

                <div style={{ marginTop: 10 }}>
                  <strong>Media instructions</strong>
                  <p style={{ margin: "6px 0 0 0", lineHeight: 1.6, color: "#333" }}>{q.media}</p>
                </div>
              </div>
            );
          })}
        </section>
      )}

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
          href="/dashboard/plan"
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
          Plan (approve posts)
        </Link>
      </nav>
    </main>
  );
}
