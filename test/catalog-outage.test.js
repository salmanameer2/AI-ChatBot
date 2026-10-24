"use strict";

// A catalog outage must never certify an arbitrary or newly seen model as
// free. Only IDs already shipped in the bundled allowlist may use the fallback.
process.env.OPENROUTER_API_KEY = "test-key-never-logged";
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

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
    return jsonResponse({ error: { message: "catalog unavailable" } }, 503);
  }

  if (url === "https://openrouter.ai/api/v1/chat/completions") {
    openRouterCalls.push({
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return jsonResponse({
      choices: [{ message: { content: "Bundled fallback reply" } }],
    });
  }

  return realFetch(input, init);
};

const app = require("../server");
const { verifyModelIsStillFree } = require("../server");

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

test("catalog outage falls back only for bundled allowlisted IDs", async () => {
  const bundled = await verifyModelIsStillFree("openrouter/free");

  assert.deepEqual(bundled, { ok: true, checked: false });

  for (const model of [
    "minimax/minimax-m3.1-flash",
    "deepseek/deepseek-v4.1-flash",
    "qwen/qwen3.8-flash",
    "z-ai/glm-5.3-flash",
  ]) {
    const result = await verifyModelIsStillFree(model);

    assert.equal(result.ok, false, `${model} must not be certified`);
    assert.equal(result.code, "model_not_allowed");
  }
});

test("chat still works for an allowlisted model during a catalog outage", async () => {
  openRouterCalls.length = 0;

  const { response, data } = await postChat({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.status, 200);
  assert.equal(data.message, "Bundled fallback reply");
  assert.equal(openRouterCalls.length, 1);
});

test("paid target-family models stay rejected during a catalog outage", async () => {
  openRouterCalls.length = 0;

  for (const model of [
    "minimax/minimax-m3.1-flash",
    "deepseek/deepseek-v4.1-flash",
    "qwen/qwen3.8-flash",
    "z-ai/glm-5.3-flash",
  ]) {
    const { response, data } = await postChat({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    assert.equal(response.status, 400, `${model} should be rejected`);
    assert.equal(data.error.code, "model_not_allowed");
  }

  assert.equal(openRouterCalls.length, 0, "must not call any unverified model");
});
