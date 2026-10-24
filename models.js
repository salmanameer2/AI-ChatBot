"use strict";

/**
 * Central list of models the chatbot is allowed to use.
 *
 * Every entry below was checked against OpenRouter's public model catalog:
 * https://openrouter.ai/api/v1/models
 *
 * Only models whose prompt AND completion price are exactly 0 are listed here.
 * Keep the `:free` suffix where OpenRouter uses one. When OpenRouter changes
 * its catalog, update this file and run `npm run verify:models`.
 *
 * A price is only accepted when OpenRouter actually provides it and it parses
 * to exactly zero. Missing, null, empty, or malformed prices are never treated
 * as free.
 *
 * `openrouter/free` is OpenRouter's free-only router. It picks another free
 * model for each request and may use image-capable free models when needed.
 */

const FREE_MODELS_VERIFIED_AT = "2026-10-24";

/**
 * Model families this project is set up to support. The live catalog is
 * audited by `npm run verify:models`; a model may only be added to
 * `FREE_MODELS` when OpenRouter reports both prices as exactly zero.
 */
const TARGET_MODEL_FAMILIES = Object.freeze([
  { id: "minimax", name: "MiniMax", prefixes: ["minimax/"] },
  { id: "deepseek", name: "DeepSeek", prefixes: ["deepseek/"] },
  { id: "qwen", name: "Qwen", prefixes: ["qwen/"] },
  {
    id: "glm",
    name: "GLM (Z.ai / Zhipu AI)",
    prefixes: ["z-ai/", "zhipu/", "zhipuai/", "thudm/"],
  },
]);

const PROVIDER_LABELS = Object.freeze({
  openrouter: "OpenRouter",
  nvidia: "NVIDIA",
  thinkingmachines: "Thinking Machines",
  poolside: "Poolside",
  cohere: "Cohere",
  liquid: "Liquid AI",
  recursive: "Recursive",
  minimax: "MiniMax",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  "z-ai": "Z.ai",
  zhipu: "Zhipu AI",
  zhipuai: "Zhipu AI",
  thudm: "Zhipu AI",
});

// As of 2026-10-24, MiniMax, DeepSeek, Qwen, and GLM (Z.ai / Zhipu AI) had no
// models whose prompt AND completion prices were both exactly zero. Do not add
// their paid endpoints here; re-run `npm run verify:models` and add a model only
// after the live catalog reports zero for both prices.
const FREE_MODELS = [
  {
    id: "openrouter/free",
    name: "Auto (Free Model)",
    shortName: "Auto",
    provider: "OpenRouter",
    description:
      "OpenRouter picks an available free model that fits your request, including image support when needed.",
    category: "Automatic",
    tags: ["Auto", "Vision"],
    vision: true,
    contextWindow: 200000,
    pricing: "free",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra",
    shortName: "Nemotron Ultra",
    provider: "NVIDIA",
    description:
      "NVIDIA's large mixture-of-experts reasoning model for complex, multi-step questions.",
    category: "Reasoning",
    tags: ["Reasoning", "Long context"],
    vision: false,
    contextWindow: 1000000,
    pricing: "free",
  },
  {
    id: "thinkingmachines/inkling:free",
    name: "Inkling",
    shortName: "Inkling",
    provider: "Thinking Machines",
    description:
      "Thinking Machines' multimodal model for general reasoning, coding, and image inputs.",
    category: "General",
    tags: ["Vision", "Reasoning"],
    vision: true,
    contextWindow: 1048576,
    pricing: "free",
  },
  {
    id: "poolside/laguna-s-2.1:free",
    name: "Laguna S 2.1",
    shortName: "Laguna S",
    provider: "Poolside",
    description:
      "Poolside's coding-agent model for code generation, debugging, and terminal-style tasks.",
    category: "Coding",
    tags: ["Coding", "Agents"],
    vision: false,
    contextWindow: 262144,
    pricing: "free",
  },
  {
    id: "cohere/north-mini-code:free",
    name: "North Mini Code",
    shortName: "North Mini",
    provider: "Cohere",
    description:
      "Cohere's compact agentic coding model for fast code assistance.",
    category: "Coding",
    tags: ["Coding", "Fast"],
    vision: false,
    contextWindow: 256000,
    pricing: "free",
  },
  {
    id: "liquid/lfm-2.5-2.6b:free",
    name: "LFM2.5 2.6B",
    shortName: "LFM2.5",
    provider: "Liquid AI",
    description:
      "Liquid AI's small, quick model for short answers, extraction, and lightweight tasks.",
    category: "Fast",
    tags: ["Fast", "Lightweight"],
    vision: false,
    contextWindow: 65536,
    pricing: "free",
  },
  {
    id: "recursive/flint-v1.0:free",
    name: "Flint v1.0",
    shortName: "Flint",
    provider: "Recursive",
    description:
      "Recursive's coding-agent mixture-of-experts model with a long context window.",
    category: "Coding",
    tags: ["Coding", "Agents"],
    vision: false,
    contextWindow: 262144,
    pricing: "free",
  },
];

const DEFAULT_MODEL_ID = "openrouter/free";

const MODEL_IDS = new Set(FREE_MODELS.map((model) => model.id));

if (MODEL_IDS.size !== FREE_MODELS.length) {
  throw new Error("FREE_MODELS contains duplicate model IDs.");
}

function getModelById(modelId) {
  return FREE_MODELS.find((model) => model.id === modelId) || null;
}

function isAllowedModel(modelId) {
  return MODEL_IDS.has(modelId);
}

function getProviderLabel(modelId) {
  const providerId = String(modelId || "")
    .replace(/^~/, "")
    .split("/")[0]
    .toLowerCase();

  return PROVIDER_LABELS[providerId] || providerId || "Unknown";
}

/**
 * OpenRouter reports prices as decimal strings (or numbers). Only an explicit
 * zero is acceptable. `null`, `undefined`, empty strings, booleans, and
 * malformed values must never be coerced to 0 by `Number()`.
 */
function isZeroPrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value === 0;
  }

  if (typeof value !== "string") return false;

  const text = value.trim();
  return /^(?:0+(?:\.0*)?|\.0+)$/.test(text);
}

function isFreePricing(pricing) {
  return (
    Boolean(pricing) &&
    typeof pricing === "object" &&
    isZeroPrice(pricing.prompt) &&
    isZeroPrice(pricing.completion)
  );
}

function isVerifiedFreeCatalogEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    entry.id.trim() !== "" &&
    isFreePricing(entry.pricing)
  );
}

module.exports = {
  FREE_MODELS,
  DEFAULT_MODEL_ID,
  FREE_MODELS_VERIFIED_AT,
  TARGET_MODEL_FAMILIES,
  getModelById,
  getProviderLabel,
  isAllowedModel,
  isFreePricing,
  isVerifiedFreeCatalogEntry,
};
