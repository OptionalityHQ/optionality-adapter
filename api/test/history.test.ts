import test from "node:test";
import assert from "node:assert/strict";
import { History } from "../src/history.ts";

test("the session history keeps one point a second, not one a poll", () => {
  const history = new History(10, 1_000);
  history.push("ETH", { atMs: 1_000, spot: 2_300, open: 0 });
  // Four reads inside the same second: the chart's right edge follows the newest,
  // and the series does not grow a point per poll.
  for (const [atMs, spot] of [[1_200, 2_301], [1_500, 2_302], [1_900, 2_303]]) {
    history.push("ETH", { atMs, spot, open: 0 });
  }
  assert.equal(history.series("ETH").points.length, 1);
  assert.equal(history.series("ETH").points[0].spot, 2_303, "the head is the last thing the gateway saw");
  assert.equal(history.series("ETH").points[0].atMs, 1_900);

  history.push("ETH", { atMs: 2_000, spot: 2_304, open: 0.01 });
  assert.equal(history.series("ETH").points.length, 2, "a second later is a second point");
});

test("an old sample falls off the far end", () => {
  const history = new History(3, 1_000);
  for (let step = 0; step < 6; step += 1) {
    history.push("ETH", { atMs: 1_000 + step * 1_000, spot: 2_300 + step, open: 0 });
  }
  const series = history.series("ETH");
  assert.equal(series.points.length, 3);
  assert.equal(series.points[0].spot, 2_303, "the newest three, oldest first");
  assert.equal(series.points[2].spot, 2_305);
});

test("the series says how much it actually covers", () => {
  const history = new History(10, 1_000);
  history.push("ETH", { atMs: 10_000, spot: 2_300, open: null });
  history.push("ETH", { atMs: 40_000, spot: 2_310, open: 0.02 });
  const series = history.series("ETH");
  assert.equal(series.spanS, 30, "thirty seconds of samples, not thirty minutes");
  assert.equal(series.sampledEveryS, 1);

  const empty = new History(10, 1_000).series("ETH");
  assert.deepEqual(empty.points, []);
  assert.equal(empty.spanS, 0, "a process that just started has no history to claim");
});

test("an unmarked position is a gap in the line, not a zero", () => {
  const history = new History(10, 1_000);
  history.push("ETH", { atMs: 1_000, spot: 2_300, open: null });
  assert.equal(history.series("ETH").points[0].open, null, "nothing to mark is not a flat PnL");
});

test("each asset has its own line", () => {
  const history = new History(10, 1_000);
  history.push("ETH", { atMs: 1_000, spot: 2_300, open: 0 });
  history.push("BTC", { atMs: 1_500, spot: 77_000, open: 0 });
  assert.deepEqual(history.series("ETH").points.map((p) => p.spot), [2_300]);
  assert.deepEqual(history.series("BTC").points.map((p) => p.spot), [77_000], "a chart is one market");
  assert.deepEqual(history.series("SOL").points, [], "a market never read has no line to draw");
});
