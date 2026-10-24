"use strict";

const {
  FREE_MODELS,
  TARGET_MODEL_FAMILIES,
  isFreePricing,
} = require("../models");

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

function priceLabel(value) {
  return value === undefined || value === null || value === ""
    ? "missing"
    : String(value);
}

function matchesFamily(modelId, family) {
  return family.prefixes.some((prefix) => modelId.startsWith(prefix));
}

async function main() {
  console.log("Checking the free-model allowlist against OpenRouter's catalog...\n");

  const response = await fetch(CATALOG_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter catalog responded with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data?.data)) {
    throw new Error("OpenRouter catalog response was malformed.");
  }

  const byId = new Map(data.data.map((model) => [model.id, model]));
  let failures = 0;

  const rows = FREE_MODELS.map((model) => {
    const entry = byId.get(model.id);

    if (!entry) {
      failures += 1;
      return {
        model: model.name,
        id: model.id,
        price: "not listed",
        status: "MISSING",
      };
    }

    const isFree = isFreePricing(entry.pricing);

    if (!isFree) failures += 1;

    return {
      model: model.name,
      id: model.id,
      price: isFree
        ? "prompt=0, completion=0"
        : `prompt=${priceLabel(entry.pricing?.prompt)}, ` +
          `completion=${priceLabel(entry.pricing?.completion)}`,
      status: isFree ? "OK" : "NO LONGER FREE",
    };
  });

  console.table(rows);

  if (failures > 0) {
    console.error(
      `\n${failures} model(s) could not be verified as free. ` +
        "Remove or replace them in models.js before using them.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${FREE_MODELS.length} allowlisted models are currently free.`);

  console.log(
    "\nTarget-family audit (a model is eligible only when prompt AND completion are exactly 0):",
  );

  for (const family of TARGET_MODEL_FAMILIES) {
    const matches = data.data.filter(
      (model) =>
        typeof model?.id === "string" && matchesFamily(model.id, family),
    );
    const free = matches.filter((model) => isFreePricing(model.pricing));

    console.log(
      `- ${family.name}: ${free.length} eligible free model(s) of ` +
        `${matches.length} listed`,
    );

    for (const model of free) {
      console.log(
        `    ${model.id} (prompt=${priceLabel(model.pricing?.prompt)}, ` +
          `completion=${priceLabel(model.pricing?.completion)})`,
      );
    }
  }

  console.log("\nNot all target families have free models at any given time.");
  console.log("Catalog checked:", new Date().toISOString());
}

main().catch((error) => {
  console.error("Could not verify the model catalog:", error.message);
  process.exitCode = 1;
});
