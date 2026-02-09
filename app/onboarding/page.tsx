"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type PostingFrequency = "daily" | "weekly";
type Industry = "Beauty / Salons" | "Trades" | "Restaurant" | "Other";

type OnboardingData = {
  businessName: string;
  industry: Industry | string;
  industryOther?: string | null;
  postingFrequency: PostingFrequency;
  maxPostsPerDay: 1 | 2;
  brandTone: string;
  clientControlAcknowledged: boolean;
  promotionsRequireApprovalAcknowledged: boolean;
};

type ApiGetOk = { onboarding: OnboardingData | null };
type ApiErr = { error: string };

function isApiErr(x: unknown): x is ApiErr {
  return !!x && typeof x === "object" && "error" in x && typeof (x as any).error === "string";
}

function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isNonEmpty(value: string): boolean {
  return safeTrim(value).length > 0;
}

async function getOnboarding(): Promise<{ ok: true; data: OnboardingData | null } | { ok: false; status: number; error: string }> {
  const res = await fetch("/api/onboarding", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  const data = json as ApiGetOk;
  if (!data || typeof data !== "object" || !("onboarding" in data)) {
    return { ok: false, status: 500, error: "Unexpected response from /api/onboarding." };
  }

  return { ok: true, data: data.onboarding ?? null };
}

async function saveOnboarding(payload: OnboardingData): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const res = await fetch("/api/onboarding", {
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

export default function OnboardingPage() {
  const router = useRouter();

  const industryOptions: Industry[] = useMemo(
    () => ["Beauty / Salons", "Trades", "Restaurant", "Other"],
    []
  );

  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState<Industry>("Beauty / Salons");
  const [industryOther, setIndustryOther] = useState("");

  const [postingFrequency, setPostingFrequency] = useState<PostingFrequency>("daily");
  const [maxPostsPerDay, setMaxPostsPerDay] = useState<1 | 2>(1);
  const [brandTone, setBrandTone] = useState("Friendly, professional, and concise");

  const [clientControlAcknowledged, setClientControlAcknowledged] = useState(false);
  const [promotionsRequireApprovalAcknowledged, setPromotionsRequireApprovalAcknowledged] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      setSuccess(null);
      setAuthRequired(false);

      const result = await getOnboarding();

      if (!result.ok) {
        // If not signed in, the API returns 401
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
        const o = result.data;

        setBusinessName(o.businessName ?? "");
        // Only allow our known industries in the select; otherwise fallback to Other and store text
        if (industryOptions.includes(o.industry as Industry)) {
          setIndustry(o.industry as Industry);
          setIndustryOther("");
        } else {
          setIndustry("Other");
          setIndustryOther(o.industryOther ?? (typeof o.industry === "string" ? o.industry : ""));
        }

        setPostingFrequency(o.postingFrequency ?? "daily");
        setMaxPostsPerDay(o.maxPostsPerDay === 2 ? 2 : 1);
        setBrandTone(o.brandTone ?? "Friendly, professional, and concise");
        setClientControlAcknowledged(Boolean(o.clientControlAcknowledged));
        setPromotionsRequireApprovalAcknowledged(Boolean(o.promotionsRequireApprovalAcknowledged));
      }

      setLoading(false);
    })();
  }, [industryOptions]);

  const showOtherIndustry = industry === "Other";

  function validate(): string | null {
    if (!isNonEmpty(businessName)) return "Please enter your business name.";

    if (industry === "Other" && !isNonEmpty(industryOther)) {
      return "Please specify your business type (Industry).";
    }

    if (!isNonEmpty(brandTone)) return "Please enter a brand tone (a short description is fine).";

    if (!clientControlAcknowledged) {
      return "Please confirm you understand you can still post manually at any time.";
    }

    if (!promotionsRequireApprovalAcknowledged) {
      return "Please confirm promotions/loyalty/limited-time offers require your approval.";
    }

    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (authRequired) {
      setError("Please sign in before saving onboarding.");
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload: OnboardingData = {
      businessName: safeTrim(businessName),
      industry: industry === "Other" ? "Other" : industry,
      industryOther: industry === "Other" ? safeTrim(industryOther) : null,
      postingFrequency,
      maxPostsPerDay,
      brandTone: safeTrim(brandTone),
      clientControlAcknowledged,
      promotionsRequireApprovalAcknowledged
    };

    setSaving(true);
    const result = await saveOnboarding(payload);
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

    setSuccess("Saved to Supabase.");
    router.push("/dashboard");
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "40px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Business onboarding</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          Tell us about your business once. This is now saved to your account (Supabase).
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
        <h2 style={{ fontSize: 16, margin: "0 0 8px 0" }}>Important</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>You remain in control of your social media accounts at all times.</li>
          <li>You can post manually whenever you want. This tool supports marketing; it doesn’t control you.</li>
          <li>Promotions/loyalty/limited-time offers are only posted with your approval.</li>
        </ul>
      </section>

      {loading ? (
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
          <div style={{ lineHeight: 1.6 }}>
            Your onboarding is saved per account, so you need to sign in to continue.
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
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
          </div>
        </section>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label htmlFor="businessName" style={{ display: "block", fontWeight: 600 }}>
                Business name
              </label>
              <input
                id="businessName"
                name="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g., Glow & Co. Beauty Studio"
                autoComplete="organization"
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
              <label htmlFor="industry" style={{ display: "block", fontWeight: 600 }}>
                Industry
              </label>
              <select
                id="industry"
                name="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value as Industry)}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  background: "#fff"
                }}
              >
                {industryOptions.map((opt) => (
                  <option value={opt} key={opt}>
                    {opt}
                  </option>
                ))}
              </select>

              {showOtherIndustry && (
                <div style={{ marginTop: 10 }}>
                  <label htmlFor="industryOther" style={{ display: "block", fontWeight: 600 }}>
                    Specify your business type
                  </label>
                  <input
                    id="industryOther"
                    name="industryOther"
                    value={industryOther}
                    onChange={(e) => setIndustryOther(e.target.value)}
                    placeholder="e.g., Fitness Coach, Car Detailing, Photography"
                    style={{
                      marginTop: 8,
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc"
                    }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label htmlFor="postingFrequency" style={{ display: "block", fontWeight: 600 }}>
                  Posting frequency
                </label>
                <select
                  id="postingFrequency"
                  name="postingFrequency"
                  value={postingFrequency}
                  onChange={(e) => setPostingFrequency(e.target.value as PostingFrequency)}
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
                <label htmlFor="maxPostsPerDay" style={{ display: "block", fontWeight: 600 }}>
                  Max posts per day
                </label>
                <select
                  id="maxPostsPerDay"
                  name="maxPostsPerDay"
                  value={String(maxPostsPerDay)}
                  onChange={(e) => setMaxPostsPerDay(e.target.value === "2" ? 2 : 1)}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    background: "#fff"
                  }}
                >
                  <option value="1">1 (standard)</option>
                  <option value="2">2 (maximum)</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="brandTone" style={{ display: "block", fontWeight: 600 }}>
                Brand tone (how posts should sound)
              </label>
              <textarea
                id="brandTone"
                name="brandTone"
                value={brandTone}
                onChange={(e) => setBrandTone(e.target.value)}
                rows={3}
                placeholder="e.g., Calm, premium, friendly, expert — avoid slang."
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

            <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 14, background: "#fff" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={clientControlAcknowledged}
                    onChange={(e) => setClientControlAcknowledged(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    I understand I can still post manually at any time. This service supports marketing but does not
                    control my social media.
                  </span>
                </label>

                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={promotionsRequireApprovalAcknowledged}
                    onChange={(e) => setPromotionsRequireApprovalAcknowledged(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    I understand that promotions, loyalty schemes, and limited-time offers are only posted with my
                    approval.
                  </span>
                </label>
              </div>
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

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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
                  opacity: saving ? 0.7 : 1
                }}
              >
                {saving ? "Saving…" : "Save & continue"}
              </button>

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
            </div>
          </div>
        </form>
      )}
    </main>
  );
}
