// scripts/dispatch-worker.mjs
// Runs locally: pulls dispatch items and prints READY-TO-POST text.
// No dotenv, no npm installs, no PowerShell policy issues.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.AUTOMATION_TOKEN;

if (!TOKEN) {
  console.error("Missing env var: AUTOMATION_TOKEN");
  process.exit(1);
}

function normalizeHashtags(input) {
  const tags = Array.isArray(input)
    ? input
    : typeof input === "string"
    ? input.split(/\s+/)
    : [];

  const cleaned = tags
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/^#+/, "")}`));

  return [...new Set(cleaned)].join(" ");
}

function formatForPlatform(item) {
  const caption = (item.caption || "").trim();
  const hashtags = normalizeHashtags(item.hashtags || []);
  const cta = "Book online via the link.";

  if (item.platform === "instagram" && item.format === "story") {
    return `${caption || "Book online"}\n\n${cta}`;
  }

  if (item.platform === "instagram") {
    return [caption, cta, hashtags].filter(Boolean).join("\n\n");
  }

  if (item.platform === "facebook") {
    return [caption, cta].filter(Boolean).join("\n\n");
  }

  return caption || cta;
}

async function run() {
  const res = await fetch(`${BASE_URL}/api/dispatch-consume`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error("Invalid JSON:", text);
    return;
  }

  if (!res.ok) {
    console.error("Consume failed:", res.status, json);
    return;
  }

  const items = json.items || [];
  console.log(`[worker] OK ${items.length} item(s)`);

  for (const item of items) {
    console.log("—");
    console.log("Platform:", item.platform);
    console.log("Format:", item.format);
    console.log(formatForPlatform(item));
  }
}

run().catch((e) => {
  console.error("Worker crashed:", e);
  process.exit(1);
});
