"use strict";

// Pure model-policy tests. These never touch the network or need an API key;
// catalog entries are mocked so all four target families can be exercised.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FREE_MODELS,
  DEFAULT_MODEL_ID,
  getModelById,
  getProviderLabel,
  isAllowedModel,
  isFreePricing,
  isVerifiedFreeCatalogEntry,
} = require("../models");

// Real IDs from OpenRouter's live catalog. Their current prices are nonzero,
// so none of them may be added to the allowlist.
const FAMILY_MODELS = [
  {
    family: "MiniMax",
    id: "minimax/minimax-m3.1-flash",
    prompt: "0.00000015",
    completion: "0.0000006",
  },
  {
    family: "DeepSeek",
    id: "deepseek/deepseek-v4.1-flash",
    prompt: "0.00000002",
    completion: "0.000001",
  },
  {
    family: "Qwen",
    id: "qwen/qwen3.8-flash",
    prompt: "0.00000015",
    completion: "0.00000047",
  },
  {
    family: "GLM",
    id: "z-ai/glm-5.3-flash",
    prompt: "0.00000015",
    completion: "0.0000005",
  },
];

test("accepts eligible zero-priced models from every target family", () => {
  for (const { family, id } of FAMILY_MODELS) {
    const entry = { id, pricing: { prompt: "0", completion: "0.000000" } };

    assert.equal(isFreePricing(entry.pricing), true, `${family} should be free`);
    assert.equal(
      isVerifiedFreeCatalogEntry(entry),
      true,
      `${family} entry should be verified free`,
    );
  }
});

test("rejects paid models from every target family", () => {
  for (const { family, id, prompt, completion } of FAMILY_MODELS) {
    const entry = { id, pricing: { prompt, completion } };

    assert.equal(
      isFreePricing(entry.pricing),
      false,
      `${family} should be rejected as paid`,
    );
    assert.equal(
      isVerifiedFreeCatalogEntry(entry),
      false,
      `${family} entry should not be verified free`,
    );
    assert.equal(
      isAllowedModel(id),
      false,
      `${family} paid ID must never be allowlisted`,
    );
  }
});

test("rejects missing or malformed prices instead of coercing them to zero", () => {
  const malformed = [
    undefined,
    null,
    {},
    { prompt: "0" },
    { completion: "0" },
    { prompt: null, completion: "0" },
    { prompt: "0", completion: null },
    { prompt: "", completion: "0" },
    { prompt: "0", completion: "   " },
    { prompt: "not-a-number", completion: "0" },
    { prompt: "0x0", completion: "0" },
    { prompt: "1e-400", completion: "0" },
    { prompt: false, completion: "0" },
    { prompt: "0", completion: "0.0000001" },
  ];

  malformed.forEach((pricing, index) => {
    assert.equal(
      isFreePricing(pricing),
      false,
      `malformed pricing at index ${index} must be rejected`,
    );
  });
});

test("rejects a model that changes from free to paid", () => {
  for (const { family, id, completion } of FAMILY_MODELS) {
    const entry = { id, pricing: { prompt: "0", completion: "0" } };

    assert.equal(isVerifiedFreeCatalogEntry(entry), true, `${family} starts free`);

    entry.pricing.completion = completion;

    assert.equal(
      isVerifiedFreeCatalogEntry(entry),
      false,
      `${family} must be rejected after becoming paid`,
    );
  }
});

test("requires a non-empty catalog ID before certifying an entry", () => {
  assert.equal(
    isVerifiedFreeCatalogEntry({ pricing: { prompt: "0", completion: "0" } }),
    false,
  );
  assert.equal(
    isVerifiedFreeCatalogEntry({ id: "", pricing: { prompt: "0", completion: "0" } }),
    false,
  );
  assert.equal(
    isVerifiedFreeCatalogEntry({ id: "   ", pricing: { prompt: "0", completion: "0" } }),
    false,
  );
});

test("keeps the allowlist unique and the default model eligible", () => {
  const ids = FREE_MODELS.map((model) => model.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(getModelById(DEFAULT_MODEL_ID));
  assert.equal(isAllowedModel(DEFAULT_MODEL_ID), true);

  for (const model of FREE_MODELS) {
    assert.equal(typeof model.provider, "string");
    assert.ok(model.provider.trim().length > 0);
  }
});

test("provides readable provider labels for the target families", () => {
  assert.equal(getProviderLabel("minimax/minimax-m3.1-flash"), "MiniMax");
  assert.equal(getProviderLabel("deepseek/deepseek-v4.1-flash"), "DeepSeek");
  assert.equal(getProviderLabel("qwen/qwen3.8-flash"), "Qwen");
  assert.equal(getProviderLabel("z-ai/glm-5.3-flash"), "Z.ai");
  assert.equal(getProviderLabel("thudm/glm-4-9b"), "Zhipu AI");
});
