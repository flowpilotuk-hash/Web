import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

type PlanPost = {
  source: "priority" | "scheduled";
  platform: "instagram" | "facebook";
  format: "post" | "reel" | "story";
  suggested_time_local: string; // "HH:MM"
  caption: string;
  hashtags: string[];
  media_instructions: string;
  approval_required: boolean;
  approval_reason: string;
};

type PlanDay = {
  date: string; // YYYY-MM-DD
  posts: PlanPost[];
};

type Plan = {
  horizon_start_date: string;
  horizon_end_date: string;
  days: PlanDay[];
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing environment variable: ${name}`);
  return v.trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function todayYyyyMmDd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function extractPlanFromResponsesPayload(payload: any): { plan: Plan | null; debugHint: string } {
  // We support multiple possible shapes:
  // 1) payload.output_text is a JSON string
  // 2) payload.output[*].content[*].text is a JSON string
  // 3) payload.output[*].content[*].json is already-parsed JSON (some variants)
  // 4) payload.output[*].content[*].type === "output_json" with { json: ... } (defensive)

  // Helper to validate basic shape (lightweight)
  const looksLikePlan = (x: any): x is Plan => {
    return (
      isObject(x) &&
      typeof x.horizon_start_date === "string" &&
      typeof x.horizon_end_date === "string" &&
      Array.isArray(x.days)
    );
  };

  // Case 1: output_text
  if (typeof payload?.output_text === "string") {
    try {
      const obj = JSON.parse(payload.output_text);
      if (looksLikePlan(obj)) return { plan: obj, debugHint: "from payload.output_text" };
    } catch {
      // continue
    }
  }

  // Case 2/3/4: output[].content[]
  const output = payload?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;

      for (const c of content) {
        // JSON already parsed
        if (c && typeof c === "object" && "json" in c) {
          const maybeJson = (c as any).json;
          if (looksLikePlan(maybeJson)) return { plan: maybeJson, debugHint: "from output.content.json" };
        }

        // Text containing JSON
        const text = (c as any)?.text;
        if (typeof text === "string") {
          try {
            const obj = JSON.parse(text);
            if (looksLikePlan(obj)) return { plan: obj, debugHint: "from output.content.text" };
          } catch {
            // continue
          }
        }

        // Some variants put it at c?.value or c?.output_text etc.
        const maybeStringFields = ["value", "output_text", "content"] as const;
        for (const f of maybeStringFields) {
          const v = (c as any)?.[f];
          if (typeof v === "string") {
            try {
              const obj = JSON.parse(v);
              if (looksLikePlan(obj)) return { plan: obj, debugHint: `from output.content.${f}` };
            } catch {
              // continue
            }
          }
        }
      }
    }
  }

  // As a last resort, if payload itself already looks like Plan (unlikely)
  if (looksLikePlan(payload)) return { plan: payload, debugHint: "from payload root" };

  return { plan: null, debugHint: "no plan found in known fields" };
}

export async function GET() {
  // 1) Auth
  const { userId } = await auth();
  if (!userId) return jsonError("Unauthorized", 401);

  // 2) Env
  let apiKey: string;
  let model: string;

  try {
    apiKey = requireEnv("OPENAI_API_KEY");
    model = requireEnv("OPENAI_MODEL");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Missing env vars.";
    return jsonError(msg, 500);
  }

  // 3) Debug logs
  console.log("[/api/plan] userId:", userId);
  console.log("[/api/plan] OPENAI_API_KEY loaded?:", true);
  console.log("[/api/plan] OPENAI_MODEL:", model);

  const startDate = todayYyyyMmDd();

  const systemInstructions = [
    "You are an expert social media manager for small businesses.",
    "Return ONLY valid JSON that matches the provided JSON Schema.",
    "If a post includes any promotion, discount, limited-time offer, loyalty scheme, giveaway, or price reduction, it MUST set approval_required=true and explain why in approval_reason.",
    "Be realistic, concise, and business-safe.",
    "Do not invent business claims (e.g., awards, number of customers)."
  ].join(" ");

  const userInstructions = [
    `Generate a 7-day posting plan starting from ${startDate}.`,
    "Assume the business is a Beauty/Salon unless profile data says otherwise.",
    "Create 1 post per day (mix formats post/reel/story).",
    "Include captions, hashtags, and media instructions referencing client-provided media."
  ].join(" ");

  // JSON Schema for structured output
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      horizon_start_date: { type: "string" },
      horizon_end_date: { type: "string" },
      days: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string" },
            posts: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  source: { type: "string", enum: ["priority", "scheduled"] },
                  platform: { type: "string", enum: ["instagram", "facebook"] },
                  format: { type: "string", enum: ["post", "reel", "story"] },
                  suggested_time_local: { type: "string" },
                  caption: { type: "string" },
                  hashtags: { type: "array", items: { type: "string" } },
                  media_instructions: { type: "string" },
                  approval_required: { type: "boolean" },
                  approval_reason: { type: "string" }
                },
                required: [
                  "source",
                  "platform",
                  "format",
                  "suggested_time_local",
                  "caption",
                  "hashtags",
                  "media_instructions",
                  "approval_required",
                  "approval_reason"
                ]
              }
            }
          },
          required: ["date", "posts"]
        }
      }
    },
    required: ["horizon_start_date", "horizon_end_date", "days"]
  } as const;

  const body = {
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: systemInstructions }] },
      { role: "user", content: [{ type: "input_text", text: userInstructions }] }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "posting_plan_v1",
        strict: true,
        schema
      }
    }
  };

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const rawText = await resp.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }

    console.log("[/api/plan] OpenAI status:", resp.status);
    console.log("[/api/plan] OpenAI request id:", resp.headers.get("x-request-id") || "(none)");

    if (!resp.ok) {
      const msg =
        (parsed && parsed.error && typeof parsed.error.message === "string" && parsed.error.message) ||
        `OpenAI request failed (HTTP ${resp.status}).`;
      return jsonError(msg, 502);
    }

    if (!parsed) {
      console.log("[/api/plan] Raw OpenAI response (non-JSON):", rawText.slice(0, 2000));
      return jsonError("OpenAI returned non-JSON response. Check server logs.", 502);
    }

    const { plan, debugHint } = extractPlanFromResponsesPayload(parsed);

    console.log("[/api/plan] Plan extraction:", debugHint);

    if (!plan) {
      // Log a trimmed version of the payload to help diagnose without flooding logs.
      console.log("[/api/plan] OpenAI payload keys:", Object.keys(parsed));
      console.log("[/api/plan] OpenAI payload preview:", JSON.stringify(parsed).slice(0, 3000));
      return jsonError("OpenAI returned an unexpected format. Check server logs for the raw response.", 502);
    }

    return NextResponse.json({
      plan,
      meta: {
        model,
        generatedAt: new Date().toISOString(),
        extractedFrom: debugHint
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error calling OpenAI.";
    return jsonError(msg, 502);
  }
}
