"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

type MediaItem = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  addedAtIso: string;
};

type MediaState = {
  sharedAlbumUrl: string;
  notesForAi: string;
  items: MediaItem[];
  updatedAtIso: string;
};

type PostingMode = "daily" | "weekly";

type ScheduleSettings = {
  mode: PostingMode;
  daysOfWeek: number[]; // 0=Sun ... 6=Sat
  windowStart: string; // HH:MM
  windowEnd: string; // HH:MM
  timezoneLabel: string;
  updatedAtIso: string;
};

type PriorityLevel = "normal" | "high";

type PriorityPostRequest = {
  id: string;
  createdAtIso: string;
  priority: PriorityLevel;
  desiredPostAtIso?: string;
  instructions: string;
  attachmentsNote: string;
  requiresPromoApproval: boolean;
  status: "queued" | "completed" | "cancelled";
};

const KEY_ONBOARDING = "smm:onboarding:v1";
const KEY_MEDIA = "smm:media:v1";
const KEY_SCHEDULE = "smm:schedule:v1";
const KEY_PRIORITY = "smm:priority-posts:v1";

const DAY_LABELS: Array<{ idx: number; label: string }> = [
  { idx: 1, label: "Mon" },
  { idx: 2, label: "Tue" },
  { idx: 3, label: "Wed" },
  { idx: 4, label: "Thu" },
  { idx: 5, label: "Fri" },
  { idx: 6, label: "Sat" },
  { idx: 0, label: "Sun" }
];

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function bytesToHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function daysToHuman(days: number[]): string {
  const set = new Set(days);
  return DAY_LABELS.filter((d) => set.has(d.idx))
    .map((d) => d.label)
    .join(", ");
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function normalizeIndustry(onboarding: OnboardingData | null): string {
  if (!onboarding) return "";
  if (onboarding.industry === "Other") {
    return isNonEmptyString(onboarding.industryOther) ? onboarding.industryOther.trim() : "Other";
  }
  return onboarding.industry;
}

export default function OverviewPage() {
  const [loaded, setLoaded] = useState(false);

  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [media, setMedia] = useState<MediaState | null>(null);
  const [schedule, setSchedule] = useState<ScheduleSettings | null>(null);
  const [priorityPosts, setPriorityPosts] = useState<PriorityPostRequest[]>([]);

  useEffect(() => {
    const ob = safeJsonParse<OnboardingData>(localStorage.getItem(KEY_ONBOARDING));
    const md = safeJsonParse<MediaState>(localStorage.getItem(KEY_MEDIA));
    const sc = safeJsonParse<ScheduleSettings>(localStorage.getItem(KEY_SCHEDULE));
    const pp = safeJsonParse<PriorityPostRequest[]>(localStorage.getItem(KEY_PRIORITY));

    // Minimal sanity checks so the page doesn't crash on corrupted storage
    setOnboarding(ob && isNonEmptyString(ob.businessName) ? ob : null);

    setMedia(
      md && typeof md === "object" && md !== null && Array.isArray(md.items)
        ? md
        : { sharedAlbumUrl: "", notesForAi: "", items: [], updatedAtIso: new Date().toISOString() }
    );

    setSchedule(
      sc && typeof sc === "object" && sc !== null && Array.isArray(sc.daysOfWeek) && isNonEmptyString(sc.windowStart) && isNonEmptyString(sc.windowEnd)
        ? sc
        : null
    );

    setPriorityPosts(Array.isArray(pp) ? pp : []);
    setLoaded(true);
  }, []);

  const ready = useMemo(() => {
    if (!onboarding) return false;
    const hasMedia = Boolean(media && (media.sharedAlbumUrl.trim().length > 0 || media.items.length > 0));
    const hasSchedule = Boolean(schedule && schedule.daysOfWeek.length > 0);
    return hasMedia && hasSchedule;
  }, [onboarding, media, schedule]);

  const queuedPriority = useMemo(
    () => priorityPosts.filter((p) => p.status === "queued").length,
    [priorityPosts]
  );

  const mediaStats = useMemo(() => {
    const count = media?.items.length ?? 0;
    const totalBytes = (media?.items ?? []).reduce((sum, it) => sum + (typeof it.sizeBytes === "number" ? it.sizeBytes : 0), 0);
    const hasAlbum = Boolean(media && media.sharedAlbumUrl && media.sharedAlbumUrl.trim().length > 0);
    return { count, totalBytes, hasAlbum };
  }, [media]);

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Overview</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          Review your setup. This is what the automated system will use when we enable AI posting.
        </p>
      </header>

      <section
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 18,
          background: ready ? "#f3fff3" : "#fffaf3",
          marginBottom: 18
        }}
      >
        <h2 style={{ fontSize: 16, margin: "0 0 8px 0" }}>Setup status</h2>

        {!loaded ? (
          <p style={{ margin: 0 }}>Loading…</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <strong>Ready to automate:</strong> {ready ? "Yes" : "Not yet"}
            </div>

            {!ready && (
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {!onboarding && (
                  <li>
                    Complete <Link href="/onboarding">onboarding</Link>
                  </li>
                )}
                {onboarding && !(media && (media.sharedAlbumUrl.trim().length > 0 || media.items.length > 0)) && (
                  <li>
                    Add <Link href="/dashboard/media">media</Link> (shared album link or uploads)
                  </li>
                )}
                {onboarding && !schedule && (
                  <li>
                    Set a <Link href="/dashboard/schedule">posting schedule</Link>
                  </li>
                )}
              </ul>
            )}

            <div style={{ fontSize: 13, color: "#555" }}>
              Automation is not enabled in this MVP yet. This page proves your inputs are complete and consistent.
            </div>
          </div>
        )}
      </section>

      <section style={{ display: "grid", gap: 18 }}>
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Business profile</h2>
            <Link href="/onboarding" style={{ textDecoration: "none" }}>
              Edit
            </Link>
          </div>

          {!loaded ? (
            <p style={{ marginTop: 12 }}>Loading…</p>
          ) : !onboarding ? (
            <p style={{ marginTop: 12 }}>Not set yet.</p>
          ) : (
            <ul style={{ margin: "12px 0 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                <strong>Name:</strong> {onboarding.businessName}
              </li>
              <li>
                <strong>Type:</strong> {normalizeIndustry(onboarding)}
              </li>
              <li>
                <strong>Frequency:</strong> {onboarding.postingFrequency === "daily" ? "Daily" : "Weekly"}
              </li>
              <li>
                <strong>Max posts/day:</strong> {onboarding.maxPostsPerDay}
              </li>
              <li>
                <strong>Brand tone:</strong> {onboarding.brandTone}
              </li>
            </ul>
          )}
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Media</h2>
            <Link href="/dashboard/media" style={{ textDecoration: "none" }}>
              Edit
            </Link>
          </div>

          {!loaded ? (
            <p style={{ marginTop: 12 }}>Loading…</p>
          ) : (
            <ul style={{ margin: "12px 0 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                <strong>Shared album link:</strong> {mediaStats.hasAlbum ? "Provided" : "Not provided"}
              </li>
              <li>
                <strong>Uploaded file metadata:</strong> {mediaStats.count} item(s) • {bytesToHuman(mediaStats.totalBytes)}
              </li>
              <li>
                <strong>AI usage rule:</strong> Only client-provided media is used.
              </li>
            </ul>
          )}
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Schedule</h2>
            <Link href="/dashboard/schedule" style={{ textDecoration: "none" }}>
              Edit
            </Link>
          </div>

          {!loaded ? (
            <p style={{ marginTop: 12 }}>Loading…</p>
          ) : !schedule ? (
            <p style={{ marginTop: 12 }}>Not set yet.</p>
          ) : (
            <ul style={{ margin: "12px 0 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                <strong>Mode:</strong> {schedule.mode === "daily" ? "Daily" : "Weekly"}
              </li>
              <li>
                <strong>Days:</strong> {daysToHuman(schedule.daysOfWeek)}
              </li>
              <li>
                <strong>Time window:</strong> {schedule.windowStart}–{schedule.windowEnd} ({schedule.timezoneLabel})
              </li>
            </ul>
          )}
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Priority posts</h2>
            <Link href="/dashboard/priority-post" style={{ textDecoration: "none" }}>
              View queue
            </Link>
          </div>

          {!loaded ? (
            <p style={{ marginTop: 12 }}>Loading…</p>
          ) : (
            <ul style={{ margin: "12px 0 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                <strong>Queued requests:</strong> {queuedPriority}
              </li>
              <li>
                <strong>Rule:</strong> Priority requests override the normal AI schedule when automation is enabled.
              </li>
              <li>
                <strong>Promo handling:</strong> Promotions/limited-time offers require explicit approval.
              </li>
            </ul>
          )}
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fafafa" }}>
          <h2 style={{ fontSize: 16, margin: "0 0 10px 0" }}>What happens when AI automation is enabled</h2>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>Check the priority post queue first (highest priority).</li>
            <li>Generate content using your business profile + brand tone.</li>
            <li>Use only client-provided media (shared album / uploaded items).</li>
            <li>Respect posting limits (max posts/day) and schedule windows.</li>
            <li>Block promotions/loyalty/limited-time offers unless explicitly approved.</li>
          </ol>
        </div>
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

        <Link
          href="/dashboard/schedule"
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
          Schedule
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
