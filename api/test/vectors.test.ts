import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, planAction, type Context } from "../src/actions.ts";
import {
  fromUnits,
  mergeSide,
  SCALE,
  toUnits,
  type LadderSide,
  type MarkSide,
  type PoolPrice,
} from "../src/gateway.ts";

/**
 * The browser plans a trade; the contract decides whether it happens. These
 * vectors are Rust's answer for the same sizes, so this suite proves the plan
 * the screen would sign is fundable and never asks the vault to pay more than
 * the ticket can return — the two ways an order can be correct on the page and
 * wrong at execution.
 */
const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(here, "../../testdata/trade-vectors.json"), "utf8"));
const rows: Array<Record<string, unknown>> = doc.rows;

function contextFor(row: Record<string, unknown>): Context {
  const mid = Number(row.mid_units) / Number(SCALE);
  const price: PoolPrice = {
    seriesId: 7,
    midUnits: String(row.mid_units),
    entryUnits: String(row.entry_units),
    exitUnits: String(row.exit_units),
    stampNs: 0,
    ageNs: 0,
  };
  const mark: MarkSide = {
    mark: mid,
    bid: mid,
    ask: mid,
    markIv: null,
    bidIv: null,
    askIv: null,
    delta: 0,
    gamma: 0,
    vega: 0,
    theta: 0,
    low: 100,
    high: 200,
  };
  return {
    you: "you.testnet",
    vault: "vault.testnet",
    priceScale: Number(SCALE),
    seriesFor: () => ({
      seriesId: 7,
      asset: "ETH",
      kind: "Put",
      strike: 150,
      low: 100,
      high: 200,
      expiryNs: 1_793_272_900_000_000_000,
      settlement: "open",
    }),
    side: mergeSide(mark, [], [], 7, "open", price) as LadderSide,
    price,
    positions: [],
  };
}

test("every planned hold covers the mid the contract charges and stays under the payoff", () => {
  assert.ok(rows.length >= 30, "the vector file is populated");
  for (const row of rows) {
    const contracts = Number(row.contracts);
    const label = `${contracts}x @ ${row.mid_units} units (${row.margin_bps}/${row.impact_bps})`;
    const calls = planAction(
      { type: "buy", asset: "ETH", kind: "Put", strike: 150, quantity: contracts, limit: 99, hold: true },
      contextFor(row),
    );
    assert.equal(calls.length, 1, label);
    assert.equal(calls[0].method, "pool_buy_held", label);
    assert.equal(calls[0].args.quantity, String(row.quantity_units), label);
    const budget = BigInt(String(calls[0].args.max_total_premium));
    const holdEntry = BigInt(String(row.hold_entry_units));
    const worstCase = BigInt(String(row.max_payout_units));
    assert.ok(
      budget >= holdEntry,
      `${label}: budget ${budget} does not cover the ${holdEntry} the contract charges`,
    );
    assert.ok(
      budget <= worstCase,
      `${label}: budget ${budget} would price a ticket above its ${worstCase} worst case`,
    );
  }
});

test("token units round-trip at the scale the plans are written in", () => {
  for (const row of rows) {
    for (const field of ["mid_units", "entry_units", "exit_units", "max_payout_units"]) {
      const units = BigInt(String(row[field]));
      assert.equal(toUnits(fromUnits(units)), units, `${field} of ${row.contracts}x`);
    }
  }
});

test("the description of a hold is the trade the contract will execute", () => {
  const body = { type: "buy", asset: "ETH", kind: "Put", strike: 150, quantity: 3, limit: 99, hold: true };
  const context = contextFor(rows[0]);
  const calls = planAction(body, context);
  assert.equal(calls[0].args.quantity, "3000000");
  assert.equal(
    describe(calls, body, context),
    "bought and held 3x at the mid, no fee — no early close",
  );
});
