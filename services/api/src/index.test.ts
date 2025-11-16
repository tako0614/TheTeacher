import { describe, expect, it } from "vitest";

import { app } from "./index";

describe("api worker", () => {
  it("responds to /health", async () => {
    const res = await app.request("/health");
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("validates /ai/proxy payloads", async () => {
    const bad = await app.request("/ai/proxy", { method: "POST", body: "{}" });
    expect(bad.status).toBe(400);

    const good = await app.request("/ai/proxy", {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
    });
    expect(good.status).toBe(200);
    const json = await good.json();
    expect(json.request.prompt).toBe("hello");
  });
});
