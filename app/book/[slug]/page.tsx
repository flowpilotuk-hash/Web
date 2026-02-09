import { redirect, notFound } from "next/navigation";
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
    .select("booking_url, provider")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    // If something goes wrong, don’t leak details publicly.
    notFound();
  }

  if (!data || typeof data.booking_url !== "string" || !isValidHttpUrl(data.booking_url)) {
    notFound();
  }

  const bookingUrl = data.booking_url;
  const provider = typeof data.provider === "string" ? data.provider : null;

  // If you prefer instant redirect, uncomment:
  // redirect(bookingUrl);

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

      {/* Auto redirect after 2 seconds */}
      <meta httpEquiv="refresh" content={`2;url=${bookingUrl}`} />
    </main>
  );
}
