import test from "node:test";
import assert from "node:assert/strict";
import {
  balancesOf,
  expiryDate,
  gatherState,
  registryForExpiry,
  seriesStrike,
  type Views,
} from "../src/gather.ts";
import type { Kind, MarkSide } from "../src/gateway.ts";

const DAY = "2026-10-29";
const EXPIRY_NS = Date.parse(`${DAY}T20:00:00Z`) * 1e6;
const OTHER_DAY_NS = Date.parse("2026-11-06T20:00:00Z") * 1e6;

function rawSeries(kind: Kind, low: number, expiryNs = EXPIRY_NS, underlying = "ETH") {
  return {
    underlying,
    kind,
    expiry_ns: expiryNs,
    accept_until_ns: expiryNs + 30e9,
    finalize_until_ns: expiryNs + 300e9,
    low_strike: low * 1e6,
    high_strike: (low + 100) * 1e6,
    price_scale: 1e6,
    min_confidence_bps: 3000,
    oracle_feed: `${underlying}-USD`,
    settlement: "Open",
    pending_since_ns: 0,
  };
}

const SERIES: Record<number, unknown> = {
  2: rawSeries("Call", 2_400),
  3: rawSeries("Put", 2_300),
  4: rawSeries("Call", 2_450),
  // Next Friday: same strikes, different day, must not join this ladder.
  5: rawSeries("Call", 2_500, OTHER_DAY_NS),
  6: null,
};

const BOOK: Record<number, unknown[]> = {
  2: [
    {
      offer_id: 7,
      maker: "maker-1.testnet",
      quantity: "3000000",
      premium: "150000",
      unit_premium: "50000",
      taker: null,
      expires_ns: EXPIRY_NS,
    },
  ],
};

function fakeViews(over: Partial<Views> = {}): Views & { calls: string[] } {
  const calls: string[] = [];
  const track = (name: string) => {
    calls.push(name);
  };
  return {
    calls,
    async seriesIds() {
      track("seriesIds");
      return Object.keys(SERIES).map(Number);
    },
    async getSeries(seriesId) {
      track(`getSeries:${seriesId}`);
      return SERIES[seriesId] ?? null;
    },
    async getBook(seriesId) {
      track(`getBook:${seriesId}`);
      return BOOK[seriesId] ?? [];
    },
    async getBids(seriesId) {
      track(`getBids:${seriesId}`);
      return seriesId === 2
        ? [
            {
              bid_id: 8,
              owner: "bidder-9.testnet",
              quantity: "3000000",
              premium: "120000",
              unit_premium: "40000",
              expires_ns: EXPIRY_NS,
            },
          ]
        : [];
    },
    async getPoolPrices(seriesIds, quantityUnits) {
      track(`getPoolPrices:${seriesIds.join("-")}:${quantityUnits}`);
      // The vault prices every listed series at a 0.0500 mid: 0.0520 loaded in,
      // 0.0400 haircut out, in one-contract integers.
      return seriesIds.map((seriesId) => ({
        series_id: seriesId,
        quantity: quantityUnits,
        mid_units: "50000",
        entry_units: "52000",
        exit_units: "40000",
        stamp_ns: EXPIRY_NS,
        age_ns: 1_000_000_000,
      }));
    },
    async getPoolState() {
      track("getPoolState");
      return {
        equity: "1000000150000",
        reserved: "299850000",
        venue_locked: "6000",
        venue: "0",
        consolation: "0",
        shares: "1000000000000",
        free_equity: "999700300000",
        utilisation_bps: "2",
        open_tickets: 1,
        venue_account: "admin.testnet",
        margin_bps: 400,
        impact_bps: 1000,
      };
    },
    async getPositions() {
      track("getPositions");
      return [
        {
          ticket_id: 1,
          series_id: 2,
          side: "long",
          maker: "vault.testnet",
          quantity: "3000000",
          cost: "156000",
          premium: "156000",
          collateral: "300000000",
          kind: "Call",
          underlying: "ETH",
          low_strike: "2400000000",
          high_strike: "2500000000",
          price_scale: "1000000",
          expiry_ns: EXPIRY_NS,
          settlement: "Open",
          fixed_price: null,
        },
      ];
    },
    async getBalance(account) {
      track(`getBalance:${account}`);
      return account === "you.testnet" ? "96880000" : "0";
    },
    async getLpShares(account) {
      track(`getLpShares:${account}`);
      // The whole vault: the fixture's 1,000,000 shares at 1,000,000.15 of equity.
      return account === "you.testnet" ? "1000000000000" : "0";
    },
    async getLpValue(account) {
      track(`getLpValue:${account}`);
      return account === "you.testnet" ? "1000000150000" : "0";
    },
    async expectedCustody() {
      track("expectedCustody");
      return "45000000000000";
    },
    async ftBalanceOf(account) {
      track(`ftBalanceOf:${account}`);
      // The contract holds the venue's whole money; a trader's own token wallet
      // is a different number, and the screen has to tell them apart.
      return account === "you.testnet" ? "12000000" : "45000000000000";
    },
    async stats() {
      track("stats");
      return {
        series_count: 6,
        offer_count: 8,
        ticket_count: 2,
        withdrawal_count: 1,
        open_offer_count: 1,
        open_bid_count: 1,
        open_ticket_count: 1,
        pending_withdrawal_count: 0,
        total_available: "96880000",
        total_offer_collateral: "300000000",
        total_bid_escrow: "120000",
        total_ticket_collateral: "0",
        total_ticket_premium: "0",
        total_pending_withdrawals: "0",
      };
    },
    ...over,
  };
}

function fakeMarks(missing: string[] = []) {
  return {
    side(_asset: "ETH" | "BTC", kind: Kind, strike: number): MarkSide | null {
      if (missing.includes(`${kind}|${strike}`)) return null;
      return {
        mark: 0.05,
        bid: 0.045,
        ask: 0.055,
        markIv: 0.45,
        bidIv: 0.44,
        askIv: 0.46,
        delta: 0.1,
        gamma: 0.002,
        vega: 0.4,
        theta: -0.01,
        low: strike,
        high: strike + 100,
      };
    },
  };
}

test("a series belongs to the cell its payoff is struck at", () => {
  assert.equal(seriesStrike({ kind: "Put", low: 2_300, high: 2_400 }), 2_400);
  assert.equal(seriesStrike({ kind: "Call", low: 2_400, high: 2_500 }), 2_400);
});

test("an expiry reads as the day the screen lists", () => {
  assert.equal(expiryDate(EXPIRY_NS), DAY);
  assert.equal(expiryDate(OTHER_DAY_NS), "2026-11-06");
  assert.equal(expiryDate(Date.parse(`${DAY}T00:00:00.000Z`) * 1e6), DAY);
});

test("a registry is built for one expiry and asset, and skips what the chain cannot read", () => {
  const pairs = Object.entries(SERIES).map(([id, raw]) => [Number(id), raw]) as Array<
    [number, unknown]
  >;
  const registry = registryForExpiry(pairs, DAY, "ETH");
  assert.equal(registry.list.length, 3, "series 5 is next week and 6 does not parse");
  assert.equal(registry.idFor("ETH", "Call", 2_400), 2);
  assert.equal(registry.idFor("ETH", "Put", 2_400), 3, "the put is struck at its high leg");
  assert.equal(registry.idFor("ETH", "Call", 2_500), null, "not this expiry");
  assert.equal(registry.idFor("BTC", "Call", 2_400), null, "and never the other asset's series");
  assert.equal(registry.info(4)?.high, 2_550);
  assert.equal(registry.info(99), null);
  assert.deepEqual(registryForExpiry(pairs, DAY, "BTC").list, [], "no BTC series this day");
  assert.equal(registryForExpiry([], DAY, "ETH").list.length, 0);
  assert.deepEqual(registry.all().map((info) => info.seriesId), [2, 3, 4]);
});

test("a trade refuses an expiry the chain does not list instead of borrowing one", () => {
  // Two ladders an hour apart. A request for a third must not quietly answer with
  // one of them: that is how a click on a one-hour market got planned against a
  // ladder a week out, at a price the trader never saw.
  const at = (h: number) => Date.now() + h * 3_600_000;
  const row = (low: string, ns: number) => ({
    underlying: "ETH", kind: "Call", expiry_ns: String(Math.round(ns * 1e6)),
    accept_until_ns: String(Math.round((ns + 60_000) * 1e6)), finalize_until_ns: String(Math.round((ns + 600_000) * 1e6)),
    low_strike: low, high_strike: "2225000000", price_scale: "1000000", min_confidence_bps: 3000,
    oracle_feed: "ETH-USD", settlement: "Open",
  });
  const pairs: Array<[number, unknown]> = [[1, row("2125000000", at(1))], [2, row("2125000000", at(25))]];
  const near = String(Math.round(at(1) * 1e6));
  assert.equal(registryForExpiry(pairs, near, "ETH", false).idFor("ETH", "Call", 2125), 1);
  assert.equal(registryForExpiry(pairs, near, "ETH", false).list.length, 1, "one ladder, not both");
  const missing = String(Math.round(at(5) * 1e6));
  assert.equal(registryForExpiry(pairs, missing, "ETH", false).list.length, 0, "strict: nothing borrowed");
  // The screen still shows something: it falls back to the nearest ladder the
  // chain does hold, which is a display decision and not a trade.
  assert.equal(registryForExpiry(pairs, missing, "ETH").idFor("ETH", "Call", 2125), 1);
});

test("the chain alone decides which strikes the ladder can trade", async () => {
  const state = await gatherState({
    asset: "ETH",
    expiry: DAY,
    strikes: [2_400, 2_450, 2_500],
    account: "you.testnet",
    vault: "vault.testnet",
    views: fakeViews(),
    marks: fakeMarks(),
    spot: 2_350,
  });
  assert.equal(state.source, "contract");
  assert.equal(state.spot, 2_350);
  assert.equal(state.chain.length, 3);

  const at2400 = state.chain[0];
  assert.equal(at2400.call?.seriesId, 2);
  assert.equal(at2400.call?.ask, 0.05, "maker-1's resting offer, not the model's 0.055");
  assert.equal(at2400.call?.bid, 0.04);
  assert.equal(at2400.call?.mark, 0.05);
  assert.equal(at2400.call?.markIv, 0.45);
  assert.equal(at2400.call?.takeAskFrom, "book");
  assert.equal(at2400.put?.seriesId, 3, "the 2.3k/2.4k put is the same cell");
  assert.equal(at2400.put?.ask, 0.052, "with nothing resting on it, the ask is the vault's own price");
  assert.equal(at2400.put?.takeAskFrom, "pool");

  const at2450 = state.chain[1];
  assert.equal(at2450.call?.seriesId, 4);
  assert.equal(at2450.call?.takeAskFrom, "pool", "nothing resting, so the vault is the maker");
  assert.equal(at2450.call?.takeAsk, 0.052);
  assert.equal(at2450.call?.askCount, 0);

  const at2500 = state.chain[2];
  assert.equal(at2500.call?.seriesId, null);
  assert.equal(at2500.call?.mark, 0.05, "the engine still has a price");
  assert.equal(at2500.call?.settlement, "open");

  assert.equal(state.pool.equity, 1_000_000.15);
  assert.equal(state.pool.reserved, 299.85);
  assert.equal(state.pool.venueLocked, 0.006);
  assert.equal(state.openTickets, 1);
  assert.equal(state.seriesCount, 6, "the contract's own count, not the filtered list");
  assert.equal(state.custody.conserved, true);
  assert.deepEqual(state.you, { account: "you.testnet", available: 96.88, wallet: 12 },
    "the venue balance and the token wallet are two different numbers");
  assert.deepEqual(state.lp, {
    account: "you.testnet",
    shares: 1_000_000,
    value: 1_000_000.15,
    // The whole equity is worth 1,000,000.15 but 299.85 of it is committed to
    // open worst cases, so an LP holding every share cannot leave yet.
    exitable: false,
  }, "the exit is quoted and gated by the contract's own numbers");
  assert.equal(state.orders.length, 2, "one offer and one bid on the listed series");
  assert.deepEqual(
    state.positions.rows.map((row) => [row.series, row.mark, row.againstPool]),
    [["ETH C2400/2500", 0.05, true]],
  );
  assert.equal(state.positions.rows[0].exitUnit, 0.04, "the vault's haircut quote is the exit");
  assert.equal(state.positions.totals.closable, 1, "and the rail says it can be closed");
});

test("a series the venue has not quoted has no vault side to take", async () => {
  const state = await gatherState({
    asset: "ETH",
    expiry: DAY,
    strikes: [2_400, 2_450],
    account: "you.testnet",
    vault: "vault.testnet",
    views: fakeViews({ getPoolPrices: async () => [] }),
    marks: fakeMarks(),
    spot: 2_350,
  });
  const at2400 = state.chain[0];
  assert.equal(at2400.call?.poolAsk, null, "the engine's mark is not a price the vault will trade at");
  assert.equal(at2400.call?.poolBid, null);
  assert.equal(at2400.call?.takeAsk, 0.05, "a resting offer is still a counterparty");
  assert.equal(at2400.call?.takeAskFrom, "book");
  assert.equal(at2400.put?.takeAsk, null, "with nobody resting either there is nothing to buy");
  assert.equal(at2400.put?.ask, 0.055, "and the model's spread still reads as a mark, not as a fill");
  assert.equal(state.positions.rows[0].exitUnit, null, "a ticket with no quote has no exit price to show");
  assert.equal(state.positions.totals.closable, 0, "the rail will not offer a close the contract would refuse");
});

test("a cell the engine cannot price still shows the chain", async () => {
  const state = await gatherState({
    asset: "ETH",
    expiry: DAY,
    strikes: [2_400],
    account: "you.testnet",
    vault: "vault.testnet",
    views: fakeViews(),
    marks: fakeMarks(["Call|2400"]),
    spot: null,
  });
  const cell = state.chain[0].call;
  assert.ok(cell);
  assert.equal(cell?.ask, 0.05);
  assert.equal(cell?.mark, 0.05, "with no model the resting quote is the mark");
  assert.equal(cell?.markIv, null);
  assert.equal(state.spot, null, "no index print is reported as none, not zero");
  assert.equal(state.positions.rows[0].mark, null, "and no position can be marked");
});

test("only the series for this expiry are read from the chain", async () => {
  const views = fakeViews();
  await gatherState({
    asset: "ETH",
    expiry: DAY,
    strikes: [2_400],
    account: "you.testnet",
    vault: "vault.testnet",
    views,
    marks: fakeMarks(),
    spot: 1,
  });
  assert.ok(views.calls.includes("getSeries:5"), "every id is read to learn its day");
  assert.ok(!views.calls.includes("getBook:5"), "but a series from another day is not quoted");
  assert.ok(!views.calls.includes("getBook:6"));
  assert.ok(views.calls.includes("getBook:2"));
  // The vault's prices come in one batch, for the series on this ladder only, at
  // the one-contract size the screen shows. Series 5 is next week's and 6 does
  // not parse; neither belongs in the read.
  const priced = views.calls.find((name) => name.startsWith("getPoolPrices:"));
  assert.equal(priced, "getPoolPrices:2-3-4:1000000");
  assert.equal(views.calls.filter((name) => name.startsWith("getPoolPrices")).length, 1, "one read, not one per cell");
  assert.equal(views.calls.filter((name) => name === "expectedCustody").length, 1);
});

test("balances are read per account in token units", async () => {
  const balances = await balancesOf(fakeViews(), ["you.testnet", "maker-1.testnet"]);
  assert.deepEqual(balances, { "you.testnet": 96.88, "maker-1.testnet": 0 });
});

test("a ticket is marked from its own cell, not from the expiry on screen", async () => {
  const read = (expiry: string) =>
    gatherState({
      asset: "ETH",
      expiry,
      strikes: [2_400],
      account: "you.testnet",
      vault: "vault.testnet",
      views: fakeViews(),
      marks: fakeMarks(),
      spot: 2_400,
    });

  const here = await read(DAY);
  assert.equal(here.positions.rows[0].mark, 0.05, "the grid on screen holds this series");

  // Next Friday's chip, same ticket. That registry is empty, but a holder's
  // position cannot become unmarked because somebody looked at another day.
  const elsewhere = await read("2026-11-06");
  assert.equal(elsewhere.chain[0].call?.seriesId ?? null, null, "nothing of this ticket's is listed there");
  assert.equal(elsewhere.positions.rows[0].mark, 0.05, "and it is still valued");
  assert.equal(elsewhere.positions.totals.closable, 1);
});
