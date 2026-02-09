import Link from "next/link";
import fs from "fs/promises";
import path from "path";

function splitLines(text: string): string[] {
  // Handles Windows + Unix line endings
  return text.replace(/\r\n/g, "\n").split("\n");
}

function tailLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  return lines.slice(lines.length - maxLines);
}

export default async function RunLogPage() {
  const logPath = path.join(process.cwd(), "dispatch-worker.log");

  let logText: string | null = null;
  let errorMsg: string | null = null;

  try {
    logText = await fs.readFile(logPath, "utf8");
  } catch (e) {
    errorMsg =
      e instanceof Error
        ? e.message
        : "Could not read dispatch-worker.log (unknown error).";
  }

  const lines = logText ? splitLines(logText).filter((l) => l.trim().length > 0) : [];
  const last = tailLines(lines, 200);

  // Basic “run summary”: count lines that look like worker runs
  const runLines = last.filter((l) => l.includes("[worker] OK"));
  const lastRunLine = runLines.length > 0 ? runLines[runLines.length - 1] : null;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Automation run log</h1>
        <p style={{ marginTop: 10, lineHeight: 1.6, color: "#333" }}>
          This page reads <code>dispatch-worker.log</code> from your server folder:
          <br />
          <code>{logPath}</code>
        </p>
      </header>

      <section
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 18,
          background: "#fafafa",
          marginBottom: 18,
        }}
      >
        <h2 style={{ fontSize: 16, margin: "0 0 8px 0" }}>Summary</h2>

        {errorMsg ? (
          <div
            style={{
              border: "1px solid #f1c0c0",
              background: "#fff5f5",
              color: "#7a1a1a",
              padding: 12,
              borderRadius: 10,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Log file not found yet</div>
            <div style={{ lineHeight: 1.6 }}>
              The log file is created only after the scheduled task runs at least once, or you run:
              <br />
              <code>node .\scripts\dispatch-worker.mjs &gt;&gt; dispatch-worker.log 2&gt;&amp;1</code>
              <br />
              <br />
              Details: <code>{errorMsg}</code>
            </div>
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              <strong>Last run line:</strong>{" "}
              {lastRunLine ? <code>{lastRunLine}</code> : "No run entries found in the last 200 lines."}
            </li>
            <li>
              <strong>Lines shown:</strong> {last.length}
            </li>
          </ul>
        )}
      </section>

      <section
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 18,
          background: "#fff",
        }}
      >
        <h2 style={{ fontSize: 16, margin: "0 0 12px 0" }}>Latest log output (last 200 lines)</h2>

        {errorMsg ? (
          <p style={{ margin: 0 }}>No log to display yet.</p>
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 14,
              borderRadius: 12,
              border: "1px solid #eee",
              background: "#0b0b0b",
              color: "#f5f5f5",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              lineHeight: 1.6,
              fontSize: 13,
            }}
          >
            {last.join("\n")}
          </pre>
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
            textDecoration: "none",
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
            textDecoration: "none",
          }}
        >
          Queue
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
            textDecoration: "none",
          }}
        >
          Plan
        </Link>
      </nav>
    </main>
  );
}
