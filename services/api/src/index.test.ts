import { describe, expect, it } from "vitest";

import { app } from "./index";

describe("api worker", () => {
  it("responds to /health", async () => {
    const res = await app.request("/health");
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("validates /ai/proxy payloads and returns related matches", async () => {
    const bad = await app.request("/ai/proxy", { method: "POST", body: "{}" });
    expect(bad.status).toBe(400);

    const good = await app.request("/ai/proxy", {
      method: "POST",
      body: JSON.stringify({ prompt: "二次関数の復習" }),
    });
    expect(good.status).toBe(200);
    const json = await good.json();
    expect(json.request.prompt).toBe("二次関数の復習");
    expect(json.toolCalls.length).toBeGreaterThan(0);
    expect(json.related.length).toBeGreaterThan(0);
  });

  it("generates embeddings with a deterministic dimension", async () => {
    const res = await app.request("/ai/embed", {
      method: "POST",
      body: JSON.stringify({ texts: ["mock text", "another"] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dimension).toBeGreaterThan(4);
    expect(json.embeddings).toHaveLength(2);
    expect(json.embeddings[0]).toHaveLength(json.dimension);
  });

  it("runs semantic search with filtering options", async () => {
    const res = await app.request("/search/semantic", {
      method: "POST",
      body: JSON.stringify({
        query: "二次関数",
        topK: 2,
        refType: "learning",
        subject: "math",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.length).toBeLessThanOrEqual(2);
    expect(json.results[0].refType).toBe("learning");
    expect(json.results[0].subject).toBe("math");
  });
});
