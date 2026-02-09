"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
};

type ApiGetOk = { media: MediaState | null };
type ApiErr = { error: string };

const MAX_FILE_MB = 25;
const MAX_FILES_PER_ADD = 20;

function nowIso(): string {
  return new Date().toISOString();
}

function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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

function isProbablyUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isApiErr(x: unknown): x is ApiErr {
  return !!x && typeof x === "object" && "error" in x && typeof (x as any).error === "string";
}

async function getMedia(): Promise<
  { ok: true; data: MediaState | null } | { ok: false; status: number; error: string }
> {
  const res = await fetch("/api/media", { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const msg = isApiErr(json) ? json.error : `Request failed (HTTP ${res.status}).`;
    return { ok: false, status: res.status, error: msg };
  }

  const data = json as ApiGetOk;
  if (!data || typeof data !== "object" || !("media" in data)) {
    return { ok: false, status: 500, error: "Unexpected response from /api/media." };
  }

  return { ok: true, data: data.media ?? null };
}

async function saveMedia(payload: MediaState): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const res = await fetch("/api/media", {
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

export default function MediaPage() {
  const [sharedAlbumUrl, setSharedAlbumUrl] = useState("");
  const [notesForAi, setNotesForAi] = useState("");
  const [items, setItems] = useState<MediaItem[]>([]);

  const [loaded, setLoaded] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totalBytes = useMemo(() => items.reduce((sum, it) => sum + it.sizeBytes, 0), [items]);

  useEffect(() => {
    (async () => {
      setLoaded(false);
      setError(null);
      setSuccess(null);
      setAuthRequired(false);

      const result = await getMedia();

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
        setSharedAlbumUrl(result.data.sharedAlbumUrl ?? "");
        setNotesForAi(result.data.notesForAi ?? "");
        setItems(Array.isArray(result.data.items) ? result.data.items : []);
      }

      setLoaded(true);
    })();
  }, []);

  async function persist(next: { sharedAlbumUrl?: string; notesForAi?: string; items?: MediaItem[] }) {
    setError(null);
    setSuccess(null);

    if (authRequired) {
      setError("Please sign in before saving media settings.");
      return;
    }

    const nextUrl = next.sharedAlbumUrl ?? sharedAlbumUrl;
    const nextNotes = next.notesForAi ?? notesForAi;
    const nextItems = next.items ?? items;

    const payload: MediaState = {
      sharedAlbumUrl: nextUrl,
      notesForAi: nextNotes,
      items: nextItems
    };

    setSaving(true);
    const result = await saveMedia(payload);
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
  }

  async function onSaveSettings() {
    setError(null);
    setSuccess(null);

    const url = safeTrim(sharedAlbumUrl);

    if (url.length > 0 && !isProbablyUrl(url)) {
      setError("Shared album link must be a valid http(s) URL (or leave it blank).");
      return;
    }

    const nextUrl = url;
    const nextNotes = safeTrim(notesForAi);

    setSharedAlbumUrl(nextUrl);
    setNotesForAi(nextNotes);

    await persist({ sharedAlbumUrl: nextUrl, notesForAi: nextNotes });
  }

  async function onFilesSelected(fileList: FileList | null) {
    setError(null);
    setSuccess(null);

    if (!fileList || fileList.length === 0) return;

    if (fileList.length > MAX_FILES_PER_ADD) {
      setError(`Please add up to ${MAX_FILES_PER_ADD} files at a time.`);
      return;
    }

    const maxBytes = MAX_FILE_MB * 1024 * 1024;

    const nextItems: MediaItem[] = [];
    for (const f of Array.from(fileList)) {
      if (f.size > maxBytes) {
        setError(`"${f.name}" is larger than ${MAX_FILE_MB}MB. Please choose a smaller file.`);
        return;
      }
      nextItems.push({
        id: makeId(),
        filename: f.name,
        mimeType: f.type || "application/octet-stream",
        sizeBytes: f.size,
        addedAtIso: nowIso()
      });
    }

    const merged = [...nextItems, ...items]; // newest first
    setItems(merged);
    await persist({ items: merged });

    setSuccess(`Added ${nextItems.length} file(s). (Metadata only for now)`);
  }

  async function removeItem(id: string) {
    setError(null);
    setSuccess(null);

    const filtered = items.filter((x) => x.id !== id);
    setItems(filtered);
    await persist({ items: filtered });
  }

  async function clearAll() {
    setError(null);
    setSuccess(null);

    setSharedAlbumUrl("");
    setNotesForAi("");
    setItems([]);
    await persist({ sharedAlbumUrl: "", notesForAi: "", items: [] });
    setSuccess("Cleared media settings.");
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Media</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          Add client-provided photos/videos or a shared album link. The system will only use media you provide.
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
        <h2 style={{ fontSize: 16, margin: "0 0 8px 0" }}>Compliance</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>AI will not use unlicensed images.</li>
          <li>Only media you upload or share (album link) is used for content creation.</li>
          <li>Promotions/limited-time offers still require your approval (handled later in approvals flow).</li>
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
          <div style={{ lineHeight: 1.6 }}>You must be signed in to load/save media settings.</div>
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
            <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>Shared album (recommended)</h2>

            <label htmlFor="sharedAlbumUrl" style={{ display: "block", fontWeight: 600 }}>
              Shared album link (Google Drive / iCloud / Dropbox / etc.)
            </label>
            <input
              id="sharedAlbumUrl"
              value={sharedAlbumUrl}
              onChange={(e) => setSharedAlbumUrl(e.target.value)}
              placeholder="https://..."
              style={{
                marginTop: 8,
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ccc"
              }}
            />

            <div style={{ marginTop: 12 }}>
              <label htmlFor="notesForAi" style={{ display: "block", fontWeight: 600 }}>
                Notes for AI (optional)
              </label>
              <textarea
                id="notesForAi"
                value={notesForAi}
                onChange={(e) => setNotesForAi(e.target.value)}
                rows={3}
                placeholder="e.g., Only use photos from 2026 collection; avoid before/after unless approved."
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

            <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={onSaveSettings}
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
                {saving ? "Saving…" : "Save media settings"}
              </button>

              <button
                type="button"
                onClick={clearAll}
                disabled={saving}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  color: "#111",
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.7 : 1
                }}
              >
                Clear
              </button>

              <span style={{ color: "#555", fontSize: 13 }}>
                Saved per account (Supabase). Upload stores metadata only for now.
              </span>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
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
                  marginTop: 12,
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
          </section>

          <section style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 18, background: "#fff" }}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>Upload files (optional)</h2>
            <p style={{ marginTop: 0, lineHeight: 1.6, color: "#333" }}>
              For now we store file <strong>metadata</strong> (filename/type/size) and save it to your account.
              In a later sprint we’ll store actual files in cloud storage after tightening permissions.
            </p>

            <input type="file" multiple accept="image/*,video/*" onChange={(e) => onFilesSelected(e.target.files)} />

            <div style={{ marginTop: 12, color: "#555", fontSize: 13 }}>
              <div>
                <strong>Files saved:</strong> {items.length}
              </div>
              <div>
                <strong>Total size:</strong> {bytesToHuman(totalBytes)}
              </div>
              <div>
                <strong>Limits:</strong> up to {MAX_FILES_PER_ADD} files per add, up to {MAX_FILE_MB}MB per file
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              {items.length === 0 ? (
                <p style={{ margin: 0 }}>No files added yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((it) => (
                    <div
                      key={it.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        border: "1px solid #eee",
                        borderRadius: 10,
                        padding: 12
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{it.filename}</div>
                        <div style={{ fontSize: 13, color: "#555" }}>
                          {it.mimeType} • {bytesToHuman(it.sizeBytes)} • added{" "}
                          {new Date(it.addedAtIso).toLocaleString()}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeItem(it.id)}
                        disabled={saving}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: "#fff",
                          color: "#111",
                          cursor: saving ? "not-allowed" : "pointer",
                          opacity: saving ? 0.7 : 1,
                          height: "fit-content"
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
        </>
      )}
    </main>
  );
}
