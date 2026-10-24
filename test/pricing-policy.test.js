"use strict";

// End-to-end policy tests: the live catalog is mocked to return malformed or
// missing prices for allowlisted models. Those models must be refused before
// any OpenRouter chat request is made.
process.env.OPENROUTER_API_KEY = "test-key-never-logged";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { FREE_MODELS } = require("../models");

const MALFORMED_PRICING = {
  "liquid/lfm-2.5-2.6b:free": { prompt: "0" },
  "cohere/north-mini-code:free": { prompt: null, completion: "0" },
  "recursive/flint-v1.0:free": { prompt: "0", completion: "" },
  "poolside/laguna-s-2.1:free": { prompt: "0x0", completion: "0" },
};

const realFetch = global.fetch;
const openRouterCalls = [];

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

global.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;

  if (url === "https://openrouter.ai/api/v1/models") {
    const data = FREE_MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      context_length: model.contextWindow,
      pricing:
        MALFORMED_PRICING[model.id] || { prompt: "0", completion: "0" },
    }));

    return jsonResponse({ data });
  }

  if (url === "https://openrouter.ai/api/v1/chat/completions") {
    openRouterCalls.push({
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return jsonResponse({
      choices: [{ message: { content: "Zero-priced reply" } }],
    });
  }

  return realFetch(input, init);
};

const app = require("../server");

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

async function postChat(body) {
  const response = await realFetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

test("rejects allowlisted models with missing or malformed live prices", async () => {
  openRouterCalls.length = 0;

  for (const model of Object.keys(MALFORMED_PRICING)) {
    const { response, data } = await postChat({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    assert.equal(response.status, 409, `${model} should be rejected`);
    assert.equal(data.error.code, "model_not_free");
    assert.match(data.error.message, /no longer marks that model as free/i);
  }

  assert.equal(openRouterCalls.length, 0, "must not call a model with bad prices");
});

test("still accepts an allowlisted model with exact zero prices", async () => {
  openRouterCalls.length = 0;

  const { response, data } = await postChat({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 200);
  assert.equal(data.message, "Zero-priced reply");
  assert.equal(openRouterCalls.length, 1);
  assert.equal(openRouterCalls[0].body.model, "openrouter/free");
});
