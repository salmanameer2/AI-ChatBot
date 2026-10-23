"use strict";

// This file tests the OpenRouter integration. It must never make a real
// network request: global.fetch is replaced with a small fake below.
process.env.OPENROUTER_API_KEY = "test-key-never-logged";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { FREE_MODELS } = require("../models");
const app = require("../server");

const realFetch = global.fetch;
const openRouterCalls = [];

let chatResponse = () => {
  throw new Error("chat handler was not configured");
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function catalogResponse() {
  const data = FREE_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    context_length: model.contextWindow,
    pricing: {
      // Treat this model as paid so the "no longer free" guard can be tested.
      prompt:
        model.id === "nvidia/nemotron-3-ultra-550b-a55b:free" ? "0.000001" : "0",
      completion:
        model.id === "nvidia/nemotron-3-ultra-550b-a55b:free" ? "0.000002" : "0",
    },
  }));

  return jsonResponse({ data });
}

global.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;

  if (url === "https://openrouter.ai/api/v1/models") {
    return catalogResponse();
  }

  if (url === "https://openrouter.ai/api/v1/chat/completions") {
    openRouterCalls.push({
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return chatResponse();
  }

  return realFetch(input, init);
};

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

test("reports that the server is configured", async () => {
  const response = await realFetch(`${baseUrl}/api/health`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.configured, true);
});

test("sends the selected model and history to OpenRouter", async () => {
  openRouterCalls.length = 0;

  chatResponse = () =>
    jsonResponse({
      model: "google/gemma-4-31b-it:free",
      choices: [{ message: { content: "Hello from the mocked model." } }],
    });

  const { response, data } = await postChat({
    model: "google/gemma-4-31b-it:free",
    messages: [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
    ],
  });

  assert.equal(response.status, 200);
  assert.equal(data.message, "Hello from the mocked model.");
  assert.equal(data.model, "google/gemma-4-31b-it:free");
  assert.equal(openRouterCalls.length, 1);

  const call = openRouterCalls[0];
  assert.equal(call.body.model, "google/gemma-4-31b-it:free");
  assert.equal(call.body.messages[0].role, "system");
  assert.deepEqual(
    call.body.messages.slice(1).map((message) => message.role),
    ["user", "assistant", "user"],
  );
  assert.equal(call.body.messages.at(-1).content, "Second question");
  assert.equal(call.headers.Authorization, "Bearer test-key-never-logged");

  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes("test-key-never-logged"));
});

test("maps a 429 rate-limit response to a clear error", async () => {
  chatResponse = () =>
    jsonResponse(
      { error: { message: "Provider rate limit exceeded for this model." } },
      429,
      { "Retry-After": "12" },
    );

  const { response, data } = await postChat({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 429);
  assert.equal(data.error.code, "rate_limited");
  assert.equal(data.error.retryAfter, 12);
  assert.match(data.error.message, /rate limit/i);
  assert.match(data.error.message, /another free model/i);
});

test("maps a 402 account/credit response without suggesting a paid fallback", async () => {
  chatResponse = () =>
    jsonResponse({ error: { message: "Insufficient credits" } }, 402);

  const { response, data } = await postChat({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 402);
  assert.equal(data.error.code, "insufficient_credits");
  assert.match(data.error.message, /credit or account restriction/i);
  assert.match(data.error.message, /account must be in good standing/i);
});

test("maps a 404 to a model-unavailable message", async () => {
  chatResponse = () =>
    jsonResponse({ error: { message: "No endpoints found for model" } }, 404);

  const { response, data } = await postChat({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 404);
  assert.equal(data.error.code, "model_unavailable");
  assert.match(data.error.message, /no longer available/i);
});

test("maps a 503 provider outage to a retryable error", async () => {
  chatResponse = () =>
    jsonResponse({ error: { message: "No provider available" } }, 503);

  const { response, data } = await postChat({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 503);
  assert.equal(data.error.code, "provider_unavailable");
  assert.match(data.error.message, /another free model/i);
});

test("rejects a model that OpenRouter no longer prices at zero", async () => {
  openRouterCalls.length = 0;

  const { response, data } = await postChat({
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 409);
  assert.equal(data.error.code, "model_not_free");
  assert.match(data.error.message, /no longer marks that model as free/i);
  assert.equal(openRouterCalls.length, 0, "must not call the paid model");
});

test("returns an empty-response error instead of a blank bubble", async () => {
  chatResponse = () =>
    jsonResponse({
      choices: [{ message: { role: "assistant", content: "   " } }],
    });

  const { response, data } = await postChat({
    model: "google/gemma-4-31b-it:free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 502);
  assert.equal(data.error.code, "empty_response");
});

test("never echoes the server API key in upstream error details", async () => {
  chatResponse = () =>
    jsonResponse(
      {
        error: {
          message: "Upstream echoed test-key-never-logged in its error text",
        },
      },
      500,
    );

  const { response, data } = await postChat({
    model: "google/gemma-4-31b-it:free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 502);
  assert.equal(data.error.detail, "Upstream echoed [redacted] in its error text");
  assert.ok(!JSON.stringify(data).includes("test-key-never-logged"));
});
