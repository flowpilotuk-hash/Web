"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PostingFrequency = "daily" | "weekly";
type Industry = "Beauty / Salons" | "Trades" | "Restaurant" | "Other";

type OnboardingData = {
  businessName: string;
  industry: Industry;
  industryOther?: string;
  postingFrequency: PostingFrequency;
  maxPostsPerDay: 1 | 2;
  brandTone: string;
  clientControlAcknowledged: boolean;
  promotionsRequireApprovalAcknowledged: boolean;
  updatedAtIso: string;
};

const ONBOARDING_KEY = "smm:onboarding:v1";

function safeParseOnboarding(raw: string | null): OnboardingData | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingData>;
    if (!parsed || typeof parsed !== "object") return null;

    if (typeof parsed.businessName !== "string" || parsed.businessName.trim().length === 0) {
      return null;
    }
    if (typeof parsed.industry !== "string") return null;
    if (typeof parsed.postingFrequency !== "string") return null;
    if (typeof parsed.maxPostsPerDay !== "number") return null;
    if (typeof parsed.brandTone !== "string") return null;

    const maxPostsPerDay = parsed.maxPostsPerDay === 2 ? 2 : 1;

    return {
      businessName: parsed.businessName.trim(),
      industry: parsed.industry as Industry,
      industryOther: typeof parsed.industryOther === "string" ? parsed.industryOther.trim() : undefined,
      postingFrequency: parsed.postingFrequency as PostingFrequency,
      maxPostsPerDay: maxPostsPerDay as 1 | 2,
      brandTone: parsed.brandTone.trim(),
      clientControlAcknowledged: Boolean(parsed.clientControlAcknowledged),
      promotionsRequireApprovalAcknowledged: Boolean(parsed.promotionsRequireApprovalAcknowledged),
      updatedAtIso: typeof parsed.updatedAtIso === "string" ? parsed.updatedAtIso : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<OnboardingData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ONBOARDING_KEY);
      setProfile(safeParseOnboarding(raw));
    } catch {
      setProfile(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  const businessType =
    profile?.industry === "Other"
      ? profile.industryOther && profile.industryOther.length > 0
        ? profile.industryOther
        : "Other"
      : profile?.industry ?? "";

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Dashboard</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          This is your control center. Next we’ll add media sources and posting schedules.
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
        <h2 style={{ fontSize: 16, margin: "0 0 10px 0" }}>Business profile</h2>

        {!loaded ? (
          <p style={{ margin: 0 }}>Loading…</p>
        ) : !profile ? (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0 }}>No onboarding profile found for this browser.</p>
            <Link
              href="/onboarding"
              style={{
                display: "inline-block",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                textDecoration: "none",
                width: "fit-content"
              }}
            >
              Complete onboarding
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div>
                <strong>Name:</strong> {profile.businessName}
              </div>
              <div>
                <strong>Type:</strong> {businessType}
              </div>
              <div>
                <strong>Frequency:</strong> {profile.postingFrequency === "daily" ? "Daily" : "Weekly"}
              </div>
              <div>
                <strong>Max posts/day:</strong> {profile.maxPostsPerDay}
              </div>
            </div>

            <div style={{ borderTop: "1px solid #e5e5e5", paddingTop: 10 }}>
              <strong>Brand tone:</strong>
              <p style={{ margin: "6px 0 0 0", lineHeight: 1.6, color: "#333" }}>{profile.brandTone}</p>
            </div>

            <div style={{ borderTop: "1px solid #e5e5e5", paddingTop: 10, display: "grid", gap: 6 }}>
              <div>
                <strong>Client control acknowledged:</strong>{" "}
                {profile.clientControlAcknowledged ? "Yes" : "No"}
              </div>
              <div>
                <strong>Promo approval required:</strong>{" "}
                {profile.promotionsRequireApprovalAcknowledged ? "Yes" : "No"}
              </div>
            </div>

            <div style={{ borderTop: "1px solid #e5e5e5", paddingTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link
                href="/onboarding"
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
                Edit onboarding
              </Link>

              <span style={{ color: "#555", fontSize: 13, alignSelf: "center" }}>
                Saved locally for now (auth/database comes next).
              </span>
            </div>
          </div>
        )}
      </section>

      <section
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 18,
          background: "#fff"
        }}
      >
        <h2 style={{ fontSize: 16, margin: "0 0 10px 0" }}>Next steps</h2>
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Add a media source (uploads/shared album link).</li>
          <li>Set posting schedule (daily/weekly + time windows).</li>
          <li>Create “Priority Post” request flow (client can override at any time).</li>
          <li>Then we add auth + database so this works across devices.</li>
        </ol>
      </section>

      <nav style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/"
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
          Home
        </Link>
      </nav>
    </main>
  );
}
