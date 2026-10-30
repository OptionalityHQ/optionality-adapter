import test from "node:test";
import assert from "node:assert/strict";
import { projectSmile } from "../src/smile.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const raw = {
  asset: "ETH",
  spot: 2_300,
  atmVol: 0.6,
  expiries: [
    {
      expiryNs: String(NOW * 1e6 + 3_600e9),
      years: 0.000114,
      points: [
        { strike: 2_400, vol: 0.57 },
        { strike: 2_200, vol: 0.64 },
        { strike: 2_300, vol: 0.6 },
      ],
    },
    { expiryNs: String(NOW * 1e6 + 12 * 3_600e9), years: 0.00137, points: [] },
  ],
};

test("the smile is named, sorted, and keeps the engine's numbers", () => {
  const view = projectSmile(raw, NOW);
  assert.ok(view);
  assert.equal(view.spot, 2_300);
  assert.equal(view.atmVol, 0.6);
  assert.equal(view.curves.length, 1, "a tenor with no points is not a curve");
  assert.deepEqual(view.curves[0].points.map((point) => point.strike), [2_200, 2_300, 2_400], "ascending");
  assert.equal(view.curves[0].points[1].vol, 0.6, "the vol is the engine's, untouched");
  assert.ok(view.curves[0].label.length > 0, "and the tenor has a name");
});

test("a body the gateway does not recognise is refused, not drawn empty", () => {
  assert.equal(projectSmile(null, NOW), null);
  assert.equal(projectSmile({}, NOW), null);
  assert.equal(projectSmile({ expiries: "nope" }, NOW), null);
  const noIndex = projectSmile({ ...raw, spot: null }, NOW);
  assert.equal(noIndex?.spot, null, "no index is a missing marker, not a zero");
});
