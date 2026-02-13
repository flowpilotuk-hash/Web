import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing environment variable: ${name}`);
  return v.trim();
}

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("booking_settings")
    .select("mode, booking_url, provider, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (error) notFound();
  if (!data) notFound();

  const mode = data.mode === "flowpilot_basic" ? "flowpilot_basic" : "provider";
  const bookingUrl = typeof data.booking_url === "string" ? data.booking_url : "";
  const provider = typeof data.provider === "string" ? data.provider : null;

  // Provider mode: show clean redirect page
  if (mode === "provider") {
    if (!bookingUrl || !isValidHttpUrl(bookingUrl)) notFound();

    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 16px", textAlign: "center" }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Book your appointment</h1>
        <p style={{ marginTop: 12, lineHeight: 1.6 }}>
          You’re being redirected to the salon’s booking page{provider ? ` (${provider})` : ""}.
        </p>

        <div style={{ marginTop: 20 }}>
          <a
            href={bookingUrl}
            style={{
              display: "inline-block",
              padding: "12px 18px",
              borderRadius: 12,
              border: "1px solid #000",
              background: "#000",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Book online
          </a>
        </div>

        <p style={{ marginTop: 14, fontSize: 13, opacity: 0.8 }}>
          If you’re not redirected, click the button above.
        </p>

        <meta httpEquiv="refresh" content={`2;url=${bookingUrl}`} />
      </main>
    );
  }

  // FlowPilot Basic: request a time window
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Request an appointment</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6 }}>
          Choose a date and a preferred time window. The salon will confirm the exact time (or suggest one within that window).
        </p>
      </header>

      <section style={{ border: "1px solid #000", borderRadius: 14, padding: 18, background: "#fff" }}>
        <form method="POST" action={`/api/booking-requests/${encodeURIComponent(slug)}`}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontWeight: 700 }}>Your name</label>
              <input
                name="customerName"
                required
                placeholder="e.g., Sarah"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 700 }}>Email</label>
              <input
                name="customerEmail"
                type="email"
                required
                placeholder="e.g., sarah@example.com"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 700 }}>Phone (optional)</label>
              <input
                name="customerPhone"
                placeholder="e.g., 07..."
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 700 }}>Preferred date</label>
              <input name="requestedDate" type="date" required style={inputStyle} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontWeight: 700 }}>Window start</label>
                <input name="windowStart" type="time" required style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontWeight: 700 }}>Window end</label>
                <input name="windowEnd" type="time" required style={inputStyle} />
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 700 }}>Notes (optional)</label>
              <textarea
                name="notes"
                rows={3}
                placeholder="e.g., Cut & blow-dry. Prefer earlier if possible."
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            <button
              type="submit"
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid #000",
                background: "#000",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                width: "fit-content",
              }}
            >
              Send request
            </button>

            <div style={{ fontSize: 13, opacity: 0.8 }}>
              By submitting, you’re asking the salon to confirm a time — you’ll receive confirmation by email.
            </div>
          </div>
        </form>
      </section>

      <nav style={{ marginTop: 18 }}>
        <Link href="/" style={{ textDecoration: "underline", color: "#000" }}>
          Back to FlowPilot
        </Link>
      </nav>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  marginTop: 8,
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ccc",
};
