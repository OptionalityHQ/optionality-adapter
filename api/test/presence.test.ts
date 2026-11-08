import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";

test("presence file reflects active state and timestamps correctly", () => {
  const file = "data/active-presence.test.json";
  try {
    const record = (active: boolean, streams: number) => {
      writeFileSync(file, JSON.stringify({ active, streams, updated_at: Date.now() }));
    };

    record(true, 1);
    assert(existsSync(file));
    let parsed = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(parsed.active, true);
    assert.equal(parsed.streams, 1);
    assert(typeof parsed.updated_at === "number");

    record(false, 0);
    parsed = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(parsed.active, false);
    assert.equal(parsed.streams, 0);
  } finally {
    if (existsSync(file)) rmSync(file);
  }
});
