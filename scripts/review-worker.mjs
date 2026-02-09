// scripts/review-worker.mjs
// Runs locally: consumes due review_jobs and marks them sent (MVP).
// Later, replace "MVP sent" with real email/SMS sending.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.AUTOMATION_TOKEN;

if (!TOKEN) {
  console.error("Missing env var: AUTOMATION_TOKEN");
  process.exit(1);
}

async function postConsume() {
  const url = `${BASE_URL}/api/review-consume`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // keep as raw text
  }

  if (!res.ok) {
    console.error(`[review-worker] consume failed: ${res.status}`, json ?? { raw: text.slice(0, 500) });
    return null;
  }

  return json;
}

function safeStr(x) {
  return typeof x === "string" ? x : "";
}

function nowStamp() {
  return new Date().toISOString();
}

async function main() {
  console.log(`[review-worker] ${nowStamp()} running against ${BASE_URL}/api/review-consume`);

  const result = await postConsume();
  if (!result) return;

  const sent = Number(result.sent ?? 0);
  console.log(`[review-worker] sent=${sent}`);

  const jobs = Array.isArray(result.jobs) ? result.jobs : [];
  for (const j of jobs) {
    console.log("—");
    console.log("jobId:", safeStr(j.id));
    console.log("channel:", safeStr(j.channel));
    console.log("to_email:", safeStr(j.to_email));
    console.log("to_phone:", safeStr(j.to_phone));
    console.log("scheduled_for:", safeStr(j.scheduled_for));
    console.log("message:", safeStr(j.message));
  }
}

main().catch((err) => {
  console.error("[review-worker] crashed:", err);
  process.exit(1);
});
