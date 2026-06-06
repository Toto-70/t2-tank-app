const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const MAX_IMAGE_DATA_URL_LENGTH = 8_000_000;

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request, env);
    if (!isOriginAllowed(request, env)) {
      return jsonResponse({ error: "Origin not allowed" }, 403, corsHeaders);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 500, corsHeaders);
    }

    try {
      const payload = await request.json();
      const imageDataUrl = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl : "";

      if (!isSupportedImageDataUrl(imageDataUrl)) {
        return jsonResponse({ error: "Invalid imageDataUrl" }, 400, corsHeaders);
      }

      const odometerReading = await readOdometerWithOpenAI(imageDataUrl, env);
      return jsonResponse(odometerReading, 200, corsHeaders);
    } catch (error) {
      console.error("Odometer reading failed:", error.message);
      return jsonResponse({ error: error.message || "Odometer reading failed" }, 500, corsHeaders);
    }
  },
};

async function readOdometerWithOpenAI(imageDataUrl, env) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || DEFAULT_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Read the odometer mileage from this classic car speedometer photo.",
                "Only use the mechanical odometer window labeled miles, not the large speed scale numbers.",
                "The rightmost red digit is tenths of a mile.",
                "Return the complete mileage as miles with exactly one decimal place.",
                "Estimate confidence as a percentage from 0 to 100.",
                "If the number is partially obscured, use your best reading and lower the confidence percentage.",
                "Do not explain your reasoning.",
              ].join(" "),
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "odometer_reading",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              odometerMiles: {
                type: "number",
                description: "The odometer reading in miles. The red rightmost digit is the decimal tenths digit.",
              },
              visibleDigits: {
                type: "string",
                description: "The visible odometer digits, without spaces. Include the red tenths digit at the end.",
              },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
              confidencePercent: {
                type: "integer",
                minimum: 0,
                maximum: 100,
                description: "Estimated probability that the odometer reading is correct.",
              },
              notes: {
                type: "string",
                description: "Short note about ambiguity, glare, or partial visibility. Empty string if none.",
              },
            },
            required: ["odometerMiles", "visibleDigits", "confidence", "confidencePercent", "notes"],
          },
        },
      },
      max_output_tokens: 1600,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!payload) {
    throw new Error(`OpenAI returned HTTP ${response.status} without JSON`);
  }

  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI request failed");
  }

  if (payload.status && payload.status !== "completed") {
    const reason = payload.incomplete_details?.reason || payload.error?.message || "unknown reason";
    throw new Error(`OpenAI response was ${payload.status}: ${reason}`);
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error(`No structured output returned (${describeResponseOutput(payload)})`);
  }

  const parsed = JSON.parse(outputText);
  return {
    odometerMiles: Number(parsed.odometerMiles),
    visibleDigits: String(parsed.visibleDigits || ""),
    confidence: parsed.confidence || "low",
    confidencePercent: normalizeConfidencePercent(parsed.confidencePercent, parsed.confidence),
    notes: String(parsed.notes || ""),
  };
}

function normalizeConfidencePercent(confidencePercent, confidence) {
  const numericConfidence = Number(confidencePercent);
  if (Number.isFinite(numericConfidence)) {
    return Math.max(0, Math.min(100, Math.round(numericConfidence)));
  }

  if (confidence === "high") {
    return 95;
  }

  if (confidence === "medium") {
    return 75;
  }

  return 45;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  for (const outputItem of payload.output || []) {
    if (typeof outputItem.text === "string") {
      return outputItem.text;
    }

    for (const contentItem of outputItem.content || []) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        return contentItem.text;
      }

      if (typeof contentItem.text === "string") {
        return contentItem.text;
      }

      if (contentItem.text && typeof contentItem.text.value === "string") {
        return contentItem.text.value;
      }

      if (contentItem.parsed) {
        return JSON.stringify(contentItem.parsed);
      }

      if (contentItem.json) {
        return JSON.stringify(contentItem.json);
      }

      if (contentItem.type === "refusal" && typeof contentItem.refusal === "string") {
        throw new Error(`OpenAI refused the image request: ${contentItem.refusal}`);
      }
    }
  }

  return "";
}

function describeResponseOutput(payload) {
  const outputTypes = (payload.output || [])
    .map((outputItem) => {
      const contentTypes = (outputItem.content || [])
        .map((contentItem) => contentItem.type || "unknown-content")
        .join(",");
      return `${outputItem.type || "unknown"}[${contentTypes}]`;
    })
    .join("; ");

  return `status=${payload.status || "unknown"}, output=${outputTypes || "empty"}`;
}

function isSupportedImageDataUrl(value) {
  return (
    value.length <= MAX_IMAGE_DATA_URL_LENGTH &&
    /^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)
  );
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const isAllowedOrigin = allowedOrigins.length === 0 || allowedOrigins.includes(origin);

  return {
    "Access-Control-Allow-Origin": isAllowedOrigin ? origin || "*" : allowedOrigins[0] || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);
}

function jsonResponse(payload, status, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
