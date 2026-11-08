import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveMedia } from "../src/media.ts";

test("film supports seeking, suffix ranges, HEAD, and rejects invalid paths/ranges", async () => {
  const directory = mkdtempSync(join(tmpdir(), "optionality-media-"));
  writeFileSync(join(directory, "film.mp4"), "0123456789");
  const server = createServer((request, response) =>
    serveMedia(request, response, directory, request.url!.slice(1)),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const partial = await fetch(`${base}/film.mp4`, {
      headers: { range: "bytes=2-5" },
    });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await partial.text(), "2345");
    const suffix = await fetch(`${base}/film.mp4`, {
      headers: { range: "bytes=-3" },
    });
    assert.equal(await suffix.text(), "789");
    const head = await fetch(`${base}/film.mp4`, { method: "HEAD" });
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(await head.text(), "");
    assert.equal(
      (await fetch(`${base}/film.mp4`, { headers: { range: "bytes=12-" } }))
        .status,
      416,
    );
    assert.equal(
      (await fetch(`${base}/film.mp4`, { headers: { range: "bytes=4-2" } }))
        .status,
      416,
    );
    assert.equal((await fetch(`${base}/%2e%2e%2fsecret`)).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true });
  }
});
