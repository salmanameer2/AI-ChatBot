"use strict";

const { FREE_MODELS } = require("../models");

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

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

    const prompt = Number(entry.pricing?.prompt);
    const completion = Number(entry.pricing?.completion);
    const isFree =
      Number.isFinite(prompt) &&
      Number.isFinite(completion) &&
      prompt === 0 &&
      completion === 0;

    if (!isFree) failures += 1;

    return {
      model: model.name,
      id: model.id,
      price: isFree ? "free" : `prompt=${prompt}, completion=${completion}`,
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
  console.log("Catalog checked:", new Date().toISOString());
}

main().catch((error) => {
  console.error("Could not verify the model catalog:", error.message);
  process.exitCode = 1;
});
