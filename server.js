"use strict";

require("dotenv").config({ quiet: true });

const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  FREE_MODELS,
  DEFAULT_MODEL_ID,
  FREE_MODELS_VERIFIED_AT,
  getModelById,
  isAllowedModel,
  isFreePricing,
} = require("./models");

const app = express();

const PORT = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
const HOST = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
const OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || "").trim();
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Vercel exposes the deployment host without a protocol. Locally we keep the
// old localhost fallback so the OpenRouter HTTP-Referer header still works.
function resolveAppUrl() {
  const explicit = String(process.env.APP_URL || "").trim();
  if (explicit) return explicit;

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) return `https://${String(vercelHost).trim()}`;

  return `http://localhost:${PORT}`;
}

const APP_URL = resolveAppUrl();

const REQUEST_TIMEOUT_MS = 120_000;
const CATALOG_TIMEOUT_MS = 8_000;
const CATALOG_CACHE_MS = 10 * 60 * 1000;

const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 32_000;
// Base64 inflates images by ~33%, and Vercel caps request bodies at 4.5 MB.
// 3 MB of raw image bytes leaves room for the JSON envelope and chat history.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES_PER_REQUEST = 1;

const PUBLIC_DIR = path.join(__dirname, "public");

const SYSTEM_PROMPT =
  "You are a helpful, concise AI assistant inside a chat widget. " +
  "Answer clearly and use plain language. If you are unsure, say so.";

const VISION_MODEL_NAMES = FREE_MODELS.filter((model) => model.vision)
  .map((model) => model.name)
  .join(", ");

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

class ValidationError extends Error {
  constructor(message, code = "invalid_request") {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.status = 400;
  }
}

function sendApiError(res, status, code, message, extra = {}) {
  return res.status(status).json({
    error: {
      code,
      status,
      message,
      ...extra,
    },
  });
}

function sanitizeDetail(value) {
  if (typeof value !== "string") return null;

  let text = value.replace(/\s+/g, " ").trim();

  // Never echo the server's key if an upstream message happens to contain it.
  if (OPENROUTER_API_KEY) {
    text = text.split(OPENROUTER_API_KEY).join("[redacted]");
  }

  return text.slice(0, 240) || null;
}

function parseRetryAfter(headerValue) {
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(Math.ceil(seconds), 3600);
}

/* -------------------------------------------------------------------------- */
/* Request validation                                                         */
/* -------------------------------------------------------------------------- */

function parseImagePart(part, counters) {
  const url = part?.image_url?.url;

  if (typeof url !== "string" || !url.startsWith("data:image/")) {
    throw new ValidationError(
      "Images must be sent as base64 data URLs.",
      "invalid_image",
    );
  }

  const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(
    url,
  );

  if (!match) {
    throw new ValidationError(
      "Unsupported image format. Use a PNG, JPEG, WebP, or GIF image.",
      "invalid_image",
    );
  }

  const mime = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const base64 = match[2];

  // Reject before decoding anything huge.
  if (base64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) {
    throw new ValidationError(
      "The image is too large. Please use an image under 3 MB.",
      "image_too_large",
    );
  }

  const byteLength = Buffer.byteLength(base64, "base64");
  if (byteLength === 0) {
    throw new ValidationError("The attached image is empty.", "invalid_image");
  }
  if (byteLength > MAX_IMAGE_BYTES) {
    throw new ValidationError(
      "The image is too large. Please use an image under 3 MB.",
      "image_too_large",
    );
  }

  counters.images += 1;
  if (counters.images > MAX_IMAGES_PER_REQUEST) {
    throw new ValidationError(
      "Please attach only one image per message.",
      "too_many_images",
    );
  }

  return {
    type: "image_url",
    image_url: { url: `data:image/${mime};base64,${base64}` },
  };
}

function normalizeContent(content, role, counters) {
  if (typeof content === "string") {
    const text = content.trim();

    if (!text) {
      throw new ValidationError(
        role === "assistant"
          ? "Assistant messages cannot be empty."
          : "A message cannot be empty.",
        "empty_message",
      );
    }

    if (text.length > MAX_MESSAGE_CHARS) {
      throw new ValidationError(
        `Each message must be ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters or fewer.`,
        "message_too_long",
      );
    }

    counters.chars += text.length;
    return text;
  }

  if (!Array.isArray(content)) {
    throw new ValidationError(
      "Message content must be text or a list of content parts.",
      "invalid_message",
    );
  }

  if (role !== "user") {
    throw new ValidationError(
      "Only user messages may contain attachments.",
      "invalid_message",
    );
  }

  const parts = [];

  for (const part of content) {
    if (!part || typeof part !== "object") {
      throw new ValidationError("Invalid message content part.", "invalid_message");
    }

    if (part.type === "text") {
      if (typeof part.text !== "string") {
        throw new ValidationError("Invalid text content part.", "invalid_message");
      }

      const text = part.text.trim();
      if (!text) continue;

      if (text.length > MAX_MESSAGE_CHARS) {
        throw new ValidationError(
          `Each message must be ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters or fewer.`,
          "message_too_long",
        );
      }

      counters.chars += text.length;
      parts.push({ type: "text", text });
      continue;
    }

    if (part.type === "image_url") {
      parts.push(parseImagePart(part, counters));
      continue;
    }

    throw new ValidationError(
      "Unsupported content type. Use text or image_url parts.",
      "invalid_message",
    );
  }

  if (parts.length === 0) {
    throw new ValidationError("A message cannot be empty.", "empty_message");
  }

  return parts;
}

function normalizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new ValidationError("Send at least one message.", "invalid_messages");
  }

  if (rawMessages.length > MAX_MESSAGES) {
    throw new ValidationError(
      `Conversations are limited to ${MAX_MESSAGES} messages per request.`,
      "too_many_messages",
    );
  }

  const counters = { chars: 0, images: 0 };
  const messages = [];

  for (const raw of rawMessages) {
    if (!raw || typeof raw !== "object") {
      throw new ValidationError("Invalid message.", "invalid_message");
    }

    if (raw.role !== "user" && raw.role !== "assistant") {
      throw new ValidationError(
        "Messages must use the user or assistant role.",
        "invalid_role",
      );
    }

    messages.push({
      role: raw.role,
      content: normalizeContent(raw.content, raw.role, counters),
    });
  }

  if (messages[messages.length - 1].role !== "user") {
    throw new ValidationError(
      "The last message must be from the user.",
      "invalid_messages",
    );
  }

  if (counters.chars > MAX_TOTAL_CHARS) {
    throw new ValidationError(
      "This conversation is too long. Clear the chat or start a shorter one.",
      "conversation_too_long",
    );
  }

  return { messages, imageCount: counters.images };
}

/* -------------------------------------------------------------------------- */
/* Live free-pricing check                                                    */
/* -------------------------------------------------------------------------- */

let catalogCache = {
  expiresAt: 0,
  byId: null,
};

let catalogFailureUntil = 0;

async function loadCatalog() {
  if (catalogCache.byId && Date.now() < catalogCache.expiresAt) {
    return catalogCache.byId;
  }

  if (Date.now() < catalogFailureUntil) {
    throw new Error("a recent catalog check failed");
  }

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`catalog responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data?.data)) {
      throw new Error("catalog response was malformed");
    }

    const byId = new Map(data.data.map((model) => [model.id, model]));
    catalogCache = {
      byId,
      expiresAt: Date.now() + CATALOG_CACHE_MS,
    };
    catalogFailureUntil = 0;

    return byId;
  } catch (error) {
    // Avoid making every chat request wait for the catalog timeout when
    // OpenRouter's catalog endpoint is temporarily unreachable.
    catalogFailureUntil = Date.now() + 60_000;
    throw error;
  }
}

/**
 * Re-check OpenRouter's catalog before sending a request. This protects the
 * user if a model that used to be free starts charging. A model is accepted
 * only when OpenRouter supplies both prices and each one is exactly zero.
 *
 * If the catalog itself is unreachable, fall back to the bundled allowlist only
 * for IDs that were already verified and shipped in `models.js`. A catalog
 * outage must never certify an arbitrary or newly seen model as free.
 */
async function verifyModelIsStillFree(modelId) {
  // Defense in depth: never verify an ID that is not in the bundled allowlist.
  if (!isAllowedModel(modelId)) {
    return {
      ok: false,
      code: "model_not_allowed",
      message:
        "That model is not on the free-model allowlist. Choose a model from the selector.",
    };
  }

  let byId;

  try {
    byId = await loadCatalog();
  } catch (error) {
    console.warn(
      `[models] Could not refresh free-model pricing (${error.message}). ` +
        "Using the bundled verified allowlist.",
    );
    return { ok: true, checked: false };
  }

  const entry = byId.get(modelId);

  if (!entry) {
    return {
      ok: false,
      code: "model_unavailable",
      message:
        "That model is no longer listed on OpenRouter. Choose another free model.",
    };
  }

  if (!isFreePricing(entry.pricing)) {
    return {
      ok: false,
      code: "model_not_free",
      message:
        "OpenRouter no longer marks that model as free. Choose another free model.",
    };
  }

  return { ok: true, checked: true };
}

/* -------------------------------------------------------------------------- */
/* Upstream error mapping                                                     */
/* -------------------------------------------------------------------------- */

function mapUpstreamError(status, data, retryAfterHeader) {
  const detail = sanitizeDetail(data?.error?.message);
  const retryAfter = parseRetryAfter(retryAfterHeader);
  const base = { detail, retryAfter };

  switch (status) {
    case 400:
      return {
        status: 400,
        code: "invalid_request",
        message:
          "OpenRouter rejected the request. The conversation may be too long for this model, or the model rejected a parameter.",
        ...base,
      };
    case 401:
      return {
        status: 502,
        code: "server_auth_error",
        message:
          "The server's OpenRouter API key was rejected. Check OPENROUTER_API_KEY in .env locally or in Vercel Project Settings -> Environment Variables, then redeploy.",
        ...base,
      };
    case 402:
      return {
        status: 402,
        code: "insufficient_credits",
        message:
          "OpenRouter reports a credit or account restriction for this request. Free models do not require paid credits, but your account must be in good standing. Check your OpenRouter account, then retry.",
        ...base,
      };
    case 403:
      return {
        status: 403,
        code: "forbidden",
        message:
          "OpenRouter blocked this request. This can happen when an account restriction or content moderation applies.",
        ...base,
      };
    case 404:
      return {
        status: 404,
        code: "model_unavailable",
        message:
          "The selected free model is no longer available. Choose another free model and try again.",
        ...base,
      };
    case 408:
      return {
        status: 504,
        code: "upstream_timeout",
        message:
          "The model provider took too long to respond. Retry, or choose a smaller/faster free model.",
        ...base,
      };
    case 429:
      return {
        status: 429,
        code: "rate_limited",
        message:
          "The free-model rate limit was reached. Wait a moment and retry, or choose another free model.",
        ...base,
      };
    case 503:
      return {
        status: 503,
        code: "provider_unavailable",
        message:
          "No provider is currently available for this free model. Try another free model.",
        ...base,
      };
    case 502:
      return {
        status: 502,
        code: "provider_error",
        message:
          "The model provider is temporarily unavailable. Retry, or choose another free model.",
        ...base,
      };
    default:
      return {
        status: 502,
        code: "upstream_error",
        message:
          "OpenRouter could not complete the request. Retry, or choose another free model.",
        ...base,
      };
  }
}

function extractAssistantText(data) {
  const message = data?.choices?.[0]?.message;
  if (!message) return "";

  if (typeof message.refusal === "string" && !message.content) {
    return message.refusal.trim();
  }

  let content = message.content;

  if (Array.isArray(content)) {
    content = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }

  return typeof content === "string" ? content.trim() : "";
}

/* -------------------------------------------------------------------------- */
/* Middleware                                                                 */
/* -------------------------------------------------------------------------- */

app.disable("x-powered-by");

// Vercel (and `vercel dev`) terminate TLS and forward requests through a
// proxy. Trusting exactly one hop lets express-rate-limit read the real client
// IP from X-Forwarded-For instead of treating every visitor as the proxy.
// The local server binds to 127.0.0.1 by default, so this is safe in dev too.
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// Mark API responses as uncacheable before body parsing, so even JSON parse
// errors and 413s cannot be cached by a CDN.
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Vercel Functions reject request bodies above 4.5 MB before Express sees
// them. Keeping the parser just under that limit gives a clear JSON 413.
app.use(express.json({ limit: "4.5mb", strict: true }));

// On Vercel this counter lives in each function instance, so it is a
// best-effort burst guard rather than a global quota. See the README.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    res.setHeader("Retry-After", "60");
    sendApiError(
      res,
      429,
      "local_rate_limited",
      "Too many requests from this browser. Wait a minute, then try again.",
      { retryAfter: 60 },
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

// Serve only the frontend files. Server code, package files, and .env are never
// exposed as static assets. On Vercel the files in public/ are served by the
// CDN before requests reach this Express app; these routes keep local
// development and tests working with the same URLs.
const STATIC_ROUTES = [
  { route: "/", file: "index.html" },
  { route: "/index.html", file: "index.html" },
  { route: "/style.css", file: "style.css" },
  { route: "/script.js", file: "script.js" },
  { route: "/favicon.svg", file: "favicon.svg" },
];

for (const entry of STATIC_ROUTES) {
  app.get(entry.route, (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(PUBLIC_DIR, entry.file));
  });
}

// Browsers and crawlers still request /favicon.ico directly; point them at the
// SVG icon instead of answering with an empty response.
app.get("/favicon.ico", (req, res) => {
  res.redirect(302, "/favicon.svg");
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(OPENROUTER_API_KEY),
    defaultModel: DEFAULT_MODEL_ID,
    modelCount: FREE_MODELS.length,
    verifiedAt: FREE_MODELS_VERIFIED_AT,
  });
});

app.get("/api/models", (req, res) => {
  res.json({
    models: FREE_MODELS,
    defaultModel: DEFAULT_MODEL_ID,
    verifiedAt: FREE_MODELS_VERIFIED_AT,
    note:
      "Free models only. OpenRouter free-tier limits apply, and availability can change.",
  });
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const rawModel = req.body?.model;

  if (
    rawModel !== undefined &&
    (typeof rawModel !== "string" || !rawModel.trim())
  ) {
    return sendApiError(
      res,
      400,
      "invalid_model",
      "The model must be a non-empty string from the free-model allowlist.",
    );
  }

  const requestedModel =
    typeof rawModel === "string" && rawModel.trim()
      ? rawModel.trim()
      : DEFAULT_MODEL_ID;

  const model = getModelById(requestedModel);

  if (!model) {
    return sendApiError(
      res,
      400,
      "model_not_allowed",
      "That model is not on the free-model allowlist. Choose a model from the selector.",
      { model: requestedModel },
    );
  }

  let normalized;

  try {
    normalized = normalizeMessages(req.body?.messages);
  } catch (error) {
    if (error instanceof ValidationError) {
      return sendApiError(res, error.status, error.code, error.message, {
        model: model.id,
        modelName: model.name,
      });
    }
    throw error;
  }

  if (normalized.imageCount > 0 && !model.vision) {
    return sendApiError(
      res,
      400,
      "image_not_supported",
      `${model.name} cannot read images. Choose ${
        VISION_MODEL_NAMES || "Auto (Free Model)"
      }, or remove the attachment.`,
      { model: model.id, modelName: model.name },
    );
  }

  if (!OPENROUTER_API_KEY) {
    return sendApiError(
      res,
      503,
      "not_configured",
      "The server is missing OPENROUTER_API_KEY. Add it to .env locally or in Vercel Project Settings -> Environment Variables, then redeploy.",
      { model: model.id, modelName: model.name },
    );
  }

  const pricingCheck = await verifyModelIsStillFree(model.id);

  if (!pricingCheck.ok) {
    return sendApiError(res, 409, pricingCheck.code, pricingCheck.message, {
      model: model.id,
      modelName: model.name,
    });
  }

  const payload = {
    model: model.id,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...normalized.messages,
    ],
    max_tokens: 2048,
    temperature: 0.7,
    stream: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "HTTP-Referer": APP_URL,
        "X-Title": "Free AI Chatbot",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const responseText = await upstream.text();

    if (responseText.length > 1_000_000) {
      return sendApiError(
        res,
        502,
        "invalid_upstream_response",
        "OpenRouter returned an unusually large response. Try again or choose another free model.",
        { model: model.id, modelName: model.name },
      );
    }

    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    if (!upstream.ok) {
      const mapped = mapUpstreamError(
        upstream.status,
        data,
        upstream.headers.get("retry-after"),
      );

      console.error(
        `[chat] OpenRouter error ${upstream.status} for ${model.id}: ` +
          (sanitizeDetail(data?.error?.message) || "no details"),
      );

      return sendApiError(res, mapped.status, mapped.code, mapped.message, {
        detail: mapped.detail,
        retryAfter: mapped.retryAfter,
        model: model.id,
        modelName: model.name,
      });
    }

    if (data?.error) {
      const mapped = mapUpstreamError(
        Number(data.error.code) || 502,
        data,
        upstream.headers.get("retry-after"),
      );

      return sendApiError(res, mapped.status, mapped.code, mapped.message, {
        detail: mapped.detail,
        retryAfter: mapped.retryAfter,
        model: model.id,
        modelName: model.name,
      });
    }

    const reply = extractAssistantText(data);

    if (!reply) {
      return sendApiError(
        res,
        502,
        "empty_response",
        "The model returned an empty response. Retry, or choose another free model.",
        { model: model.id, modelName: model.name },
      );
    }

    return res.json({
      message: reply,
      model: data?.model || model.id,
      modelName: model.name,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendApiError(
        res,
        504,
        "upstream_timeout",
        "The model took too long to respond. Retry, or choose a smaller/faster free model.",
        { model: model.id, modelName: model.name },
      );
    }

    console.error(`[chat] Upstream request failed for ${model.id}: ${error.message}`);

    return sendApiError(
      res,
      502,
      "network_error",
      "Could not reach OpenRouter. Check the server's internet connection, then retry.",
      { model: model.id, modelName: model.name },
    );
  } finally {
    clearTimeout(timeout);
  }
});

// Unknown API route.
app.use("/api", (req, res) => {
  sendApiError(res, 404, "not_found", "API endpoint not found.");
});

// Anything else.
app.use((req, res) => {
  res.status(404).type("text/plain").send("Not found");
});

// JSON parse errors, oversized bodies, and unexpected failures.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error?.type === "entity.too.large") {
    return sendApiError(
      res,
      413,
      "payload_too_large",
      "The request is too large. Please use a smaller image or shorter message.",
    );
  }

  if (error instanceof SyntaxError && "body" in error) {
    return sendApiError(
      res,
      400,
      "invalid_json",
      "The request body must be valid JSON.",
    );
  }

  console.error("[server] Unhandled error:", error?.message || error);

  return sendApiError(
    res,
    500,
    "server_error",
    "Something went wrong on the server. Please try again.",
  );
});

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`\nFree AI Chatbot running at ${APP_URL}`);
    console.log(`Local address: http://localhost:${PORT} (bound to ${HOST}:${PORT})`);
    console.log(
      OPENROUTER_API_KEY
        ? "OPENROUTER_API_KEY loaded from the environment."
        : "WARNING: OPENROUTER_API_KEY is not set. Add it to .env and restart.",
    );
    console.log(`Models: ${FREE_MODELS.length} verified free models\n`);
  });
}

module.exports = app;

// Exported so the pricing-policy tests can exercise the catalog-outage path
// directly. The Express app remains the default export.
module.exports.verifyModelIsStillFree = verifyModelIsStillFree;
