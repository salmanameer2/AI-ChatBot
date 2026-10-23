"use strict";

/**
 * Central list of models the chatbot is allowed to use.
 *
 * Every entry below was checked against OpenRouter's public model catalog:
 * https://openrouter.ai/api/v1/models
 *
 * Only models whose prompt AND completion price are 0 are listed here.
 * Keep the `:free` suffix where OpenRouter uses one. When OpenRouter changes
 * its catalog, update this file and run `npm run verify:models`.
 *
 * `openrouter/free` is OpenRouter's free-only router. It picks another free
 * model for each request and may use image-capable free models when needed.
 */

const FREE_MODELS_VERIFIED_AT = "2026-10-23";

const FREE_MODELS = [
  {
    id: "openrouter/free",
    name: "Auto (Free Model)",
    shortName: "Auto",
    description:
      "OpenRouter picks an available free model that fits your request, including image support when needed.",
    category: "Automatic",
    tags: ["Auto", "Vision"],
    vision: true,
    contextWindow: 200000,
    pricing: "free",
  },
  {
    id: "google/gemma-4-31b-it:free",
    name: "Gemma 4 31B",
    shortName: "Gemma 4",
    description:
      "Google's 31B multimodal model for general chat, reasoning, and image understanding.",
    category: "General",
    tags: ["Vision", "General"],
    vision: true,
    contextWindow: 262144,
    pricing: "free",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra",
    shortName: "Nemotron Ultra",
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

function getModelById(modelId) {
  return FREE_MODELS.find((model) => model.id === modelId) || null;
}

function isAllowedModel(modelId) {
  return MODEL_IDS.has(modelId);
}

module.exports = {
  FREE_MODELS,
  DEFAULT_MODEL_ID,
  FREE_MODELS_VERIFIED_AT,
  getModelById,
  isAllowedModel,
};
