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
  // IMPORTANT: Must match Queue page to persist approval mapping.
  const base = [
    dayDate,
    String(idx),
    post.platform,
    post.format,
    post.suggested_time_local,
    post.caption.slice(0, 80),
    post.media_instructions.slice(0, 80)
  ].join("|");
  return base;
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

function savePlanCache(data: ApiPlanOk) {
  const payload = { savedAtIso: new Date().toISOString(), data };
  localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(payload));
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

function saveApprovalsLocal(map: Record<string, ApprovalRecord>) {
  localStorage.setItem(APPROVALS_STORAGE_KEY, JSON.stringify(map));
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

async function postApproval(input: {
  postKey: string;
  status: ApprovalStatus;
  rejectReason?: string | null;
  decidedAtIso?: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const res = await fetch("/api/plan-approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(input)
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Approval update failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  return { ok: true };
}

async function generatePlan(): Promise<ApiPlanOk> {
  const res = await fetch("/api/plan", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    if (isApiErr(json)) throw new Error(json.error);
    throw new Error(`Failed to generate plan (HTTP ${res.status}).`);
  }

  const data = json as ApiPlanOk;
  if (!data || typeof data !== "object" || !(data as any).plan) {
    throw new Error("Unexpected response from /api/plan.");
  }

  return data;
}

async function fetchPlanStore(): Promise<ApiPlanOk | null> {
  const res = await fetch("/api/plan-store", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    if (isApiErr(json)) throw new Error(json.error);
    throw new Error(`Failed to load stored plan (HTTP ${res.status}).`);
  }

  // /api/plan-store returns { plan: null } when nothing saved
  if (!json || typeof json !== "object") throw new Error("Unexpected response from /api/plan-store.");

  const obj = json as any;
  if (!obj.plan) return null;

  return {
    plan: obj.plan as Plan,
    meta: obj.meta ?? undefined
  };
}

async function savePlanToStore(data: ApiPlanOk): Promise<void> {
  const res = await fetch("/api/plan-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      plan: data.plan,
      meta: {
        model: data.meta?.model,
        generatedAt: data.meta?.generatedAt,
        extractedFrom: data.meta?.extractedFrom
      }
    })
  });

  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    if (isApiErr(json)) throw new Error(json.error);
    throw new Error(`Failed to save plan (HTTP ${res.status}).`);
  }
}

export default function PlanPage() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [planOk, setPlanOk] = useState<ApiPlanOk | null>(null);
  const [approvals, setApprovals] = useState<Record<string, ApprovalRecord>>({});
  const [approvalsSource, setApprovalsSource] = useState<"server" | "local">("local");

  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      setNotice(null);
      setAuthRequired(false);

      // 1) Load cached plan immediately (fast UI)
      const cached = loadPlanCache();
      if (cached?.plan) setPlanOk(cached);

      // 2) Try load stored plan from Supabase (authoritative)
      try {
        const stored = await fetchPlanStore();
        if (stored?.plan) {
          setPlanOk(stored);
          savePlanCache(stored);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load stored plan.";
        if (msg.toLowerCase().includes("unauthorized")) setAuthRequired(true);
        // Not fatal if there isn't one yet
      }

      // 3) Load approvals (server preferred)
      try {
        const serverApprovals = await fetchApprovalsServer();
        setApprovals(serverApprovals);
        setApprovalsSource("server");
        saveApprovalsLocal(serverApprovals);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load approvals.";
        if (msg.toLowerCase().includes("unauthorized")) setAuthRequired(true);

        const local = loadApprovalsLocal();
        setApprovals(local);
        setApprovalsSource("local");
      }

      setLoading(false);
    })();
  }, []);

  const plan = planOk?.plan ?? null;

  const stats = useMemo(() => {
    if (!plan) return { total: 0, needsApproval: 0, approved: 0, rejected: 0, pending: 0 };

    let total = 0;
    let needsApproval = 0;
    let approved = 0;
    let rejected = 0;
    let pending = 0;

    for (const day of plan.days) {
      day.posts.forEach((p, idx) => {
        total += 1;
        if (!p.approval_required) return;

        needsApproval += 1;
        const key = makePostKey(day.date, p, idx);
        const rec = approvals[key];

        if (!rec || rec.status === "pending") pending += 1;
        else if (rec.status === "approved") approved += 1;
        else if (rec.status === "rejected") rejected += 1;
      });
    }

    return { total, needsApproval, approved, rejected, pending };
  }, [plan, approvals]);

  async function onGeneratePlan() {
    setError(null);
    setNotice(null);

    setGenerating(true);
    try {
      const data = await generatePlan();

      // Save locally for immediate UX
      savePlanCache(data);
      setPlanOk(data);

      // Persist to Supabase (this is what fixes plan-store returning null)
      await savePlanToStore(data);

      setNotice("Plan generated, cached, and saved to your account (Supabase).");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate/save plan.";
      if (msg.toLowerCase().includes("unauthorized")) setAuthRequired(true);
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function updateApproval(postKey: string, status: ApprovalStatus, rejectReason?: string) {
    setError(null);
    setNotice(null);

    const nextLocal: Record<string, ApprovalRecord> = {
      ...approvals,
      [postKey]: {
        status,
        decidedAtIso: status === "pending" ? undefined : new Date().toISOString(),
        rejectReason: status === "rejected" ? (rejectReason?.trim() || "Rejected") : undefined
      }
    };

    // Optimistic UI
    setApprovals(nextLocal);
    saveApprovalsLocal(nextLocal);

    const result = await postApproval({
      postKey,
      status,
      rejectReason: status === "rejected" ? (rejectReason?.trim() || "Rejected") : null,
      decidedAtIso: status === "pending" ? null : new Date().toISOString()
    });

    if (!result.ok) {
      if (result.status === 401) {
        setAuthRequired(true);
        setApprovalsSource("local");
        setError("You’re signed out. Please sign in to sync approvals.");
        return;
      }
      setError(result.error);
      return;
    }

    setApprovalsSource("server");

    // Re-fetch from server so refresh always matches DB
    try {
      const serverApprovals = await fetchApprovalsServer();
      setApprovals(serverApprovals);
      saveApprovalsLocal(serverApprovals);
      setNotice("Saved.");
    } catch {
      setNotice("Saved (local mirror updated).");
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Plan (AI) — Approvals</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          Review the AI plan. Anything flagged as a promotion/offer requires explicit approval.
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
          <p style={{ margin: 0 }}>Loading…</p>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={pillStyle(plan ? "#f3fff3" : "#fff5cc", plan ? "#1f5c1f" : "#6b4e00")}>
              Plan: {plan ? "Loaded" : "None"}
            </span>

            <span
              style={pillStyle(
                approvalsSource === "server" ? "#f3fff3" : "#fff5cc",
                approvalsSource === "server" ? "#1f5c1f" : "#6b4e00"
              )}
            >
              Approvals: {approvalsSource === "server" ? "Synced" : "Local"}
            </span>

            <span style={pillStyle("#fff", "#111")}>Posts: {stats.total}</span>
            <span style={pillStyle("#fff", "#111")}>Need approval: {stats.needsApproval}</span>
            <span style={pillStyle("#f3fff3", "#1f5c1f")}>Approved: {stats.approved}</span>
            <span style={pillStyle("#fff5f5", "#7a1a1a")}>Rejected: {stats.rejected}</span>
            <span style={pillStyle("#fff5cc", "#6b4e00")}>Pending: {stats.pending}</span>
          </div>
        )}
      </section>

      {authRequired && (
        <section
          style={{
            border: "1px solid #f1c0c0",
            background: "#fff5f5",
            color: "#7a1a1a",
            padding: 14,
            borderRadius: 12,
            marginBottom: 18
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Sign-in required</div>
          <div style={{ lineHeight: 1.6 }}>
            You appear to be signed out in this tab/session. Sign in so plans/approvals persist to your account.
          </div>
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
      )}

      {error && (
        <div
          style={{
            color: "#7a1a1a",
            background: "#fff5f5",
            border: "1px solid #f1c0c0",
            padding: 12,
            borderRadius: 10,
            marginBottom: 18
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
            marginBottom: 18
          }}
        >
          {notice}
        </div>
      )}

      <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Plan</h2>

          <button
            type="button"
            onClick={onGeneratePlan}
            disabled={generating}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              cursor: generating ? "not-allowed" : "pointer",
              width: "fit-content",
              opacity: generating ? 0.7 : 1
            }}
          >
            {generating ? "Generating…" : plan ? "Regenerate plan" : "Generate plan"}
          </button>
        </div>

        {!plan ? (
          <p style={{ marginTop: 12, lineHeight: 1.6 }}>
            No plan loaded yet. Click <strong>Generate plan</strong> to create one and save it to your account.
          </p>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {plan.days.map((day) => (
              <div key={day.date} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>{formatDateLabel(day.date)}</div>
                  <div style={{ color: "#555", fontSize: 13 }}>{day.date}</div>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  {day.posts.map((p, idx) => {
                    const postKey = makePostKey(day.date, p, idx);
                    const approval = approvals[postKey];
                    const needsApproval = p.approval_required;

                    const status: ApprovalStatus = needsApproval ? (approval?.status ?? "pending") : "approved";

                    return (
                      <div key={postKey} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={pillStyle("#111", "#fff")}>{p.platform.toUpperCase()}</span>
                            <span style={pillStyle("#fff", "#111")}>{p.format.toUpperCase()}</span>
                            <span style={pillStyle("#e9f2ff", "#003a8c")}>{p.source.toUpperCase()}</span>
                            <span style={pillStyle("#fff", "#111")}>{p.suggested_time_local}</span>

                            {needsApproval ? (
                              status === "approved" ? (
                                <span style={pillStyle("#f3fff3", "#1f5c1f")}>APPROVED</span>
                              ) : status === "rejected" ? (
                                <span style={pillStyle("#fff5f5", "#7a1a1a")}>REJECTED</span>
                              ) : (
                                <span style={pillStyle("#fff5cc", "#6b4e00")}>PENDING</span>
                              )
                            ) : (
                              <span style={pillStyle("#f3fff3", "#1f5c1f")}>NO APPROVAL NEEDED</span>
                            )}
                          </div>

                          {needsApproval && (
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => updateApproval(postKey, "approved")}
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: 10,
                                  border: "1px solid #111",
                                  background: "#111",
                                  color: "#fff",
                                  cursor: "pointer"
                                }}
                              >
                                Approve
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  const reason = window.prompt("Reject reason (optional):", approval?.rejectReason ?? "");
                                  updateApproval(postKey, "rejected", reason ?? "");
                                }}
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  background: "#fff",
                                  color: "#111",
                                  cursor: "pointer"
                                }}
                              >
                                Reject
                              </button>

                              <button
                                type="button"
                                onClick={() => updateApproval(postKey, "pending")}
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  background: "#fff",
                                  color: "#111",
                                  cursor: "pointer"
                                }}
                              >
                                Reset to pending
                              </button>
                            </div>
                          )}
                        </div>

                        {needsApproval && (
                          <div style={{ marginTop: 10, color: "#6b4e00" }}>
                            <strong>Approval required:</strong> {p.approval_reason || "This post may contain a promotion/offer."}
                          </div>
                        )}

                        <div style={{ marginTop: 10 }}>
                          <strong>Caption</strong>
                          <p style={{ margin: "6px 0 0 0", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{p.caption}</p>
                        </div>

                        <div style={{ marginTop: 10 }}>
                          <strong>Hashtags</strong>
                          <p style={{ margin: "6px 0 0 0", lineHeight: 1.6, color: "#333" }}>{joinHashtags(p.hashtags)}</p>
                        </div>

                        <div style={{ marginTop: 10 }}>
                          <strong>Media instructions</strong>
                          <p style={{ margin: "6px 0 0 0", lineHeight: 1.6, color: "#333" }}>{p.media_instructions}</p>
                        </div>

                        {approval?.rejectReason && status === "rejected" && (
                          <div style={{ marginTop: 10, color: "#7a1a1a" }}>
                            <strong>Reject reason:</strong> {approval.rejectReason}
                          </div>
                        )}

                        {approval?.decidedAtIso && (status === "approved" || status === "rejected") && (
                          <div style={{ marginTop: 10, color: "#555", fontSize: 13 }}>
                            Decided: {new Date(approval.decidedAtIso).toLocaleString()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
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
          href="/dashboard/queue"
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
          Posting queue
        </Link>
      </nav>
    </main>
  );
}
