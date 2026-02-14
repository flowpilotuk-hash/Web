"use client";

import { useEffect, useState } from "react";

export default function HomePage() {
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function onInstallClick() {
    if (installPromptEvent) {
      installPromptEvent.prompt();
      try {
        await installPromptEvent.userChoice;
      } finally {
        setInstallPromptEvent(null);
      }
      return;
    }
    setInstallHelpOpen(true);
  }

  return (
    <main style={styles.page}>
      {/* Safe keyframes (no document access at module scope) */}
      <style>{`
        @keyframes fpFloat {
          0% { transform: translate3d(0,0,0); opacity: 0.9; }
          50% { transform: translate3d(0,-8px,0); opacity: 0.95; }
          100% { transform: translate3d(0,0,0); opacity: 0.9; }
        }
      `}</style>

      {/* Minimal header */}
      <header style={styles.header}>
        <div style={styles.brand}>FlowPilot</div>

        <nav style={styles.nav}>
          <button type="button" onClick={onInstallClick} style={styles.navButton}>
            Install app
          </button>

          {/* Force full navigation (reliable in production) */}
          <a href="/sign-in" style={styles.navLink}>
            Sign in
          </a>

          <a href="/sign-up" style={styles.ctaPrimary}>
            Start Free Trial
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section style={styles.hero}>
        <div aria-hidden="true" style={styles.heroBgWrap}>
          <FlowBackdrop />
        </div>

        <div style={styles.heroInner}>
          <h1 style={styles.h1}>Salon growth on autopilot.</h1>

          <p style={styles.subhead}>
            Social content, a single booking link, and automated review requests — in one simple dashboard.
          </p>

          <div style={styles.heroCtas}>
            <a href="/sign-up" style={styles.ctaPrimaryLg}>
              Start Free Trial
            </a>

            <button type="button" onClick={onInstallClick} style={styles.ctaSecondaryLg}>
              Install app
            </button>
          </div>

          <div style={styles.heroMeta}>
            <span style={styles.metaPill}>Works on mobile & desktop</span>
            <span style={styles.metaDivider} />
            <span style={styles.metaPill}>No App Store needed</span>
          </div>
        </div>
      </section>

      {/* Minimal sections */}
      <section id="what" style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.h2}>What FlowPilot does</h2>
          <p style={styles.sectionLead}>Three core automations that remove busywork and keep bookings coming in.</p>
        </div>

        <div style={styles.cards3}>
          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span style={styles.accentBar} />
              <h3 style={styles.h3}>Automated social posting</h3>
            </div>
            <p style={styles.p}>Plan → approve → post. Consistent presence without daily effort.</p>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span style={styles.accentBar} />
              <h3 style={styles.h3}>Smart booking link</h3>
            </div>
            <p style={styles.p}>One clean booking page for clients — provider link or FlowPilot basic time-window requests.</p>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span style={styles.accentBar} />
              <h3 style={styles.h3}>Automated review requests</h3>
            </div>
            <p style={styles.p}>After appointments, automatically request reviews to build trust and visibility.</p>
          </div>
        </div>
      </section>

      <section id="how" style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.h2}>How it works</h2>
          <p style={styles.sectionLead}>Simple. Non-technical. You stay in control.</p>
        </div>

        <ol style={styles.steps}>
          <li style={styles.step}>
            <div style={styles.stepNum}>1</div>
            <div>
              <div style={styles.stepTitle}>Set it up once</div>
              <div style={styles.stepBody}>Business details, style, booking mode, and reviews settings.</div>
            </div>
          </li>

          <li style={styles.step}>
            <div style={styles.stepNum}>2</div>
            <div>
              <div style={styles.stepTitle}>Approve what matters</div>
              <div style={styles.stepBody}>Promotions can require approval. You can still post manually anytime.</div>
            </div>
          </li>

          <li style={styles.step}>
            <div style={styles.stepNum}>3</div>
            <div>
              <div style={styles.stepTitle}>FlowPilot runs</div>
              <div style={styles.stepBody}>Posting, booking capture, and reviews run in the background.</div>
            </div>
          </li>
        </ol>
      </section>

      <section style={styles.finalCta}>
        <div style={styles.finalCard}>
          <div>
            <h2 style={styles.h2}>Ready to try FlowPilot?</h2>
            <p style={{ ...styles.sectionLead, marginBottom: 0 }}>
              Start a free trial and see it working inside your salon this week.
            </p>
          </div>

          <div style={styles.finalActions}>
            <a href="/sign-up" style={styles.ctaPrimaryLg}>
              Start Free Trial
            </a>
            <div style={styles.subtleNote}>Subscription after trial • Cancel anytime</div>
          </div>
        </div>
      </section>

      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          <div style={styles.footerBrand}>FlowPilot</div>
          <div style={styles.footerMeta}>© {new Date().getFullYear()} FlowPilot</div>
        </div>
      </footer>

      {installHelpOpen && (
        <div role="dialog" aria-modal="true" style={styles.modalOverlay} onClick={() => setInstallHelpOpen(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Install FlowPilot</div>
            <div style={styles.modalBody}>
              <p style={{ marginTop: 0, lineHeight: 1.7 }}>
                <strong>On iPhone (Safari):</strong> tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.
              </p>
              <p style={{ marginTop: 0, lineHeight: 1.7 }}>
                <strong>On Android (Chrome):</strong> tap the menu → <strong>Install app</strong>.
              </p>
              <p style={{ marginTop: 0, lineHeight: 1.7 }}>
                <strong>On desktop:</strong> look for the install icon in the address bar (Chrome/Edge).
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setInstallHelpOpen(false)} style={styles.modalClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function FlowBackdrop() {
  return (
    <div style={styles.backdrop}>
      <svg width="1200" height="520" viewBox="0 0 1200 520" style={styles.backdropSvg} xmlns="http://www.w3.org/2000/svg">
        <path
          d="M-40 380 C 180 280, 260 460, 520 340 C 780 220, 880 300, 1240 140"
          fill="none"
          stroke="rgba(0,0,0,0.10)"
          strokeWidth="2"
        />
        <path
          d="M-60 220 C 140 120, 340 240, 560 150 C 820 40, 980 120, 1260 20"
          fill="none"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth="2"
        />
        <circle cx="260" cy="300" r="4" fill="#7fff00" opacity="0.6" />
        <circle cx="560" cy="160" r="4" fill="#7fff00" opacity="0.5" />
        <circle cx="900" cy="290" r="4" fill="#7fff00" opacity="0.4" />
      </svg>

      <div style={styles.backdropAnim} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "Arial, Helvetica, sans-serif", background: "#ffffff", color: "#000", minHeight: "100vh" },

  header: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "18px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    position: "sticky",
    top: 0,
    background: "rgba(255,255,255,0.9)",
    backdropFilter: "blur(6px)",
    borderBottom: "1px solid rgba(0,0,0,0.08)",
    zIndex: 10
  },

  brand: { fontWeight: 900, letterSpacing: 0.2 },

  nav: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },

  navLink: {
    display: "inline-block",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#fff",
    color: "#000",
    textDecoration: "none",
    fontWeight: 700
  },

  navButton: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#fff",
    color: "#000",
    fontWeight: 800,
    cursor: "pointer"
  },

  ctaPrimary: {
    display: "inline-block",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#7fff00",
    color: "#000",
    textDecoration: "none",
    fontWeight: 900
  },

  hero: { maxWidth: 1100, margin: "0 auto", padding: "64px 16px 24px 16px", position: "relative", overflow: "hidden" },

  heroBgWrap: { position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.9 },

  heroInner: { position: "relative", maxWidth: 820, paddingTop: 26, paddingBottom: 48 },

  h1: { margin: 0, fontSize: 56, lineHeight: 1.02, letterSpacing: -0.8 },

  subhead: { marginTop: 14, fontSize: 18, lineHeight: 1.75, maxWidth: 760, color: "rgba(0,0,0,0.80)" },

  heroCtas: { marginTop: 22, display: "flex", gap: 12, flexWrap: "wrap" },

  ctaPrimaryLg: {
    display: "inline-block",
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.14)",
    background: "#7fff00",
    color: "#000",
    textDecoration: "none",
    fontWeight: 900
  },

  ctaSecondaryLg: {
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.14)",
    background: "#fff",
    color: "#000",
    fontWeight: 900,
    cursor: "pointer"
  },

  heroMeta: { marginTop: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", color: "rgba(0,0,0,0.75)", fontSize: 13 },

  metaPill: { border: "1px solid rgba(0,0,0,0.10)", borderRadius: 999, padding: "6px 10px", background: "rgba(255,255,255,0.85)", fontWeight: 700 },

  metaDivider: { width: 4, height: 4, borderRadius: 99, background: "rgba(0,0,0,0.25)" },

  section: { maxWidth: 1100, margin: "0 auto", padding: "56px 16px" },

  sectionHeader: { maxWidth: 780 },

  h2: { margin: 0, fontSize: 22, letterSpacing: -0.2 },

  sectionLead: { marginTop: 10, marginBottom: 0, lineHeight: 1.75, color: "rgba(0,0,0,0.78)" },

  cards3: { marginTop: 18, display: "grid", gap: 14, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },

  card: { border: "1px solid rgba(0,0,0,0.10)", borderRadius: 16, padding: 18, background: "#fff" },

  cardTop: { display: "flex", alignItems: "center", gap: 10 },

  accentBar: { width: 10, height: 28, borderRadius: 99, background: "#7fff00", opacity: 0.95 },

  h3: { margin: 0, fontSize: 16 },

  p: { marginTop: 10, marginBottom: 0, lineHeight: 1.7, color: "rgba(0,0,0,0.78)" },

  steps: { marginTop: 18, display: "grid", gap: 12, paddingLeft: 0, listStyle: "none", maxWidth: 780 },

  step: { display: "grid", gridTemplateColumns: "32px 1fr", gap: 12, border: "1px solid rgba(0,0,0,0.10)", borderRadius: 16, padding: 16, background: "#fff" },

  stepNum: { width: 32, height: 32, borderRadius: 999, background: "#7fff00", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 },

  stepTitle: { fontWeight: 900, marginBottom: 4 },

  stepBody: { lineHeight: 1.7, color: "rgba(0,0,0,0.78)" },

  finalCta: { maxWidth: 1100, margin: "0 auto", padding: "56px 16px 72px 16px" },

  finalCard: { border: "1px solid rgba(0,0,0,0.12)", borderRadius: 18, padding: 22, background: "#fff", display: "grid", gap: 18 },

  finalActions: { display: "grid", gap: 10, justifyItems: "start" },

  subtleNote: { fontSize: 13, color: "rgba(0,0,0,0.65)" },

  footer: { borderTop: "1px solid rgba(0,0,0,0.08)", padding: "28px 16px" },

  footerInner: { maxWidth: 1100, margin: "0 auto", display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },

  footerBrand: { fontWeight: 900 },

  footerMeta: { fontSize: 13, opacity: 0.75 },

  backdrop: { position: "absolute", inset: 0 },

  backdropSvg: { position: "absolute", right: -120, top: -70, maxWidth: "1200px", width: "1200px", height: "520px" },

  backdropAnim: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at 20% 30%, rgba(127,255,0,0.10) 0%, rgba(127,255,0,0.00) 45%), radial-gradient(circle at 70% 40%, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.00) 55%)",
    animation: "fpFloat 10s ease-in-out infinite"
  },

  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 },

  modalCard: { width: "min(520px, 100%)", background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,0.12)", padding: 18 },

  modalTitle: { fontWeight: 900, fontSize: 16, marginBottom: 8 },

  modalBody: { fontSize: 14, color: "rgba(0,0,0,0.85)" },

  modalClose: { marginTop: 10, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", color: "#000", fontWeight: 800, cursor: "pointer" }
};
