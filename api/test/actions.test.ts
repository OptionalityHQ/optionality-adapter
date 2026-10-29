import test from "node:test";
import assert from "node:assert/strict";
import {
  assetOf,
  type Call,
  contractsOf,
  describe,
  kindOf,
  legsOf,
  planAction,
  type Context,
} from "../src/actions.ts";
import { type LadderSide, type MarkSide, type PositionRow, mergeSide, normalizePositions } from "../src/gateway.ts";

const POSITION = {
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
  expiry_ns: 1_793_272_900_000_000_000,
  settlement: "Open",
  fixed_price: null,
};

const MARK: MarkSide = {
  mark: 0.05,
  bid: 0.045,
  ask: 0.055,
  markIv: null,
  bidIv: null,
  askIv: null,
  delta: 0.1,
  poolAsk: 0.052,
  poolBid: 0.04,
};

function sideOf(over: Partial<LadderSide> = {}): LadderSide {
  return { ...(mergeSide(MARK, [], [], 2, "open") as LadderSide), ...over };
}

function context(over: Partial<Context> = {}): Context {
  return {
    you: "you.testnet",
    vault: "vault.testnet",
    priceScale: 1_000_000,
    seriesFor: () => ({
      seriesId: 2,
      asset: "ETH",
      kind: "Call",
      strike: 2_400,
      low: 2_400,
      high: 2_500,
      expiryNs: 1_793_272_900_000_000_000,
      settlement: "open",
    }),
    side: sideOf(),
    mid: 0.05,
    positions: normalizePositions([POSITION], "vault.testnet") as PositionRow[],
    ...over,
  };
}

const first = (calls: Call[]): Call => calls[0];

test("the asset and kind defaults are the screen's defaults", () => {
  assert.equal(assetOf("BTC"), "BTC");
  assert.equal(assetOf("ETH"), "ETH");
  assert.equal(assetOf(undefined), "ETH", "anything unrecognised is the asset on screen");
  assert.equal(assetOf("sol"), "ETH");
  assert.equal(kindOf("Call"), "Call");
  assert.equal(kindOf(undefined), "Put");
});

test("quantity is whole contracts or nothing", () => {
  assert.equal(contractsOf(3), 3);
  assert.equal(contractsOf("2"), 2);
  assert.equal(contractsOf(undefined), 1);
  assert.equal(contractsOf(3.7), 3, "a fractional contract cannot exist");
  assert.throws(() => contractsOf(0), /at least one/);
  assert.throws(() => contractsOf(-2), /at least one/);
  assert.throws(() => contractsOf("abc"), /at least one/);
});

test("a buy with nobody resting goes to the pool, at the model's mid", () => {
  const calls = planAction({ type: "buy", asset: "ETH", kind: "Call", strike: 2_400, quantity: 3, limit: 0.052 }, context());
  assert.equal(calls.length, 1);
  assert.equal(first(calls).method, "pool_buy");
  assert.equal(first(calls).args.series_id, 2);
  assert.equal(first(calls).args.quantity, "3000000");
  assert.equal(first(calls).args.mid_units, "50000", "the mid is what the pool prices from, not the ask");
  assert.equal(first(calls).args.max_total_premium, "156000", "the limit becomes the budget");
  assert.equal(first(calls).tgas, 30n);
});

test("a buy takes the book when a resting offer beats the vault", () => {
  const calls = planAction(
    { type: "buy", strike: 2_400, quantity: 3, limit: 0.05 },
    context({ side: sideOf({ takeAsk: 0.05, takeAskFrom: "book", bestOfferId: 0 }) }),
  );
  assert.equal(first(calls).method, "fill_market_order");
  assert.equal(first(calls).args.max_total_premium, "150000");
  assert.equal(first(calls).args.min_quantity, null);
});

test("the mid comes from the engine or the plan refuses to invent one", () => {
  assert.throws(
    () => planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0.052 }, context({ mid: null })),
    /no mark/,
  );
  assert.throws(
    () => planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0 }, context()),
    /limit price/,
  );
});

test("a buy cannot be planned on a series that has already run off", () => {
  for (const settlement of ["fixed", "void", "pending"] as const) {
    assert.throws(
      () =>
        planAction(
          { type: "buy", strike: 2_400, quantity: 3, limit: 0.052 },
          context({
            seriesFor: () => ({
              seriesId: 2,
              asset: "ETH",
              kind: "Call",
              strike: 2_400,
              low: 2_400,
              high: 2_500,
              expiryNs: 1,
              settlement,
            }),
          }),
        ),
      /already expired/,
    );
  }
  assert.throws(() => planAction({ type: "buy", strike: 2_400 }, context({ seriesFor: () => null })), /unknown series/);
});

test("a post-only buy rests a bid and refuses to cross", () => {
  const resting = planAction(
    { type: "buy", strike: 2_400, quantity: 3, limit: 0.04, postOnly: true },
    context(),
  );
  assert.equal(first(resting).method, "post_bid");
  assert.equal(first(resting).args.premium, "120000");
  assert.equal(first(resting).args.quantity, "3000000");
  assert.throws(
    () => planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0.06, postOnly: true }, context()),
    /would cross the ask 0\.05/,
  );
});

test("a sell against the pool closes into the vault; a sell against a person needs a bidder", () => {
  const toPool = planAction({ type: "sell", strike: 2_400, quantity: 3, ticket: 1 }, context());
  assert.equal(first(toPool).method, "pool_close");
  assert.equal(first(toPool).args.ticket_id, 1);
  assert.equal(first(toPool).args.mid_units, "50000");

  const fromBook = normalizePositions([{ ...POSITION, maker: "maker-1.testnet" }], "vault.testnet");
  const toPerson = planAction(
    { type: "close", strike: 2_400, quantity: 3, ticket: 1, limit: 0.045 },
    context({ positions: fromBook }),
  );
  assert.equal(first(toPerson).method, "close_ticket");
  assert.equal(first(toPerson).args.min_unit_premium, "45000");
  const noFloor = planAction({ type: "close", strike: 2_400, ticket: 1 }, context({ positions: fromBook }));
  assert.equal(first(noFloor).args.min_unit_premium, null);
  assert.throws(() => planAction({ type: "sell", strike: 2_400 }, context()), /names a ticket/);
});

test("a sell against the pool still needs a mark to close at", () => {
  assert.throws(
    () => planAction({ type: "sell", strike: 2_400, ticket: 1 }, context({ mid: null })),
    /no mark to close/,
  );
});

test("a post-only sell rests an offer behind the best bid", () => {
  const resting = planAction(
    { type: "sell", strike: 2_400, quantity: 3, limit: 0.06, postOnly: true },
    context(),
  );
  assert.equal(first(resting).method, "post_offer");
  assert.equal(first(resting).args.premium, "180000");
  assert.equal(first(resting).args.taker, null);
  assert.throws(
    () => planAction({ type: "sell", strike: 2_400, quantity: 3, limit: 0.04, postOnly: true }, context()),
    /would cross the bid 0\.04/,
    "0.045 shown to two decimals is 0.04, and the message quotes what the book holds",
  );
});

test("expiring a series asks the oracle and costs a chained call's gas", () => {
  const calls = planAction({ type: "expire", strike: 2_400 }, context());
  assert.equal(first(calls).method, "request_settlement");
  assert.equal(first(calls).tgas, 90n, "the print arrives in a callback, so prepay for both legs");
  assert.equal(first(calls).contract, "options");
  const settled = context({
    seriesFor: () => ({
      seriesId: 2,
      asset: "ETH",
      kind: "Call",
      strike: 2_400,
      low: 2_400,
      high: 2_500,
      expiryNs: 1,
      settlement: "fixed",
    }),
  });
  assert.throws(() => planAction({ type: "expire", strike: 2_400 }, settled), /already settled/);
});

test("settling claims every ticket on the series, and only once it has fixed", () => {
  assert.throws(
    () => planAction({ type: "settle", strike: 2_400 }, context()),
    /has not settled yet/,
    "claiming a ticket before the series fixes is refused, not silently empty",
  );

  const fixedSeries: Context = {
    ...context(),
    seriesFor: () => ({
      seriesId: 2,
      asset: "ETH",
      kind: "Call",
      strike: 2_400,
      low: 2_400,
      high: 2_500,
      expiryNs: 1,
      settlement: "void",
    }),
  };
  const calls = planAction({ type: "settle", strike: 2_400 }, fixedSeries);
  assert.equal(calls.length, 1);
  assert.equal(first(calls).method, "settle_ticket");
  assert.equal(first(calls).args.ticket_id, 1);
  assert.equal(first(calls).tgas, 30n, "settlement is single-hop");

  const otherSeries = [
    ...fixedSeries.positions,
    { ...fixedSeries.positions[0], ticketId: 9, seriesId: 7 },
  ];
  const two = planAction({ type: "settle", strike: 2_400 }, { ...fixedSeries, positions: otherSeries });
  assert.equal(two.length, 1, "only this series' tickets");
});

test("money moving in and out of the vault names its message and its gas", () => {
  const deposit = first(planAction({ type: "deposit", amount: 100 }, context()));
  assert.equal(deposit.contract, "token");
  assert.equal(deposit.method, "ft_transfer_call");
  assert.equal(deposit.args.msg, "deposit");
  assert.equal(deposit.args.amount, "100000000");
  assert.equal(deposit.tgas, 90n);
  assert.equal(deposit.depositYocto, 1n, "NEP-141 panics on anything but exactly 1 yoctoNEAR attached");

  const pool = first(planAction({ type: "pool-deposit", amount: 1_000_000 }, context()));
  assert.equal(pool.contract, "options", "venue cash buys shares without an FT round trip");
  assert.equal(pool.method, "pool_deposit_from_balance");
  assert.equal(pool.args.amount, "1000000000000");
  assert.equal(pool.depositYocto, undefined, "a bucket move attaches nothing");

  const redeem = first(planAction({ type: "pool-withdraw", shares: 500 }, context()));
  assert.equal(redeem.method, "pool_withdraw");
  assert.equal(redeem.args.shares, "500000000");
  assert.equal(redeem.tgas, 30n, "a redemption credits a balance, it does not transfer");

  const out = first(planAction({ type: "withdraw", amount: 50 }, context()));
  assert.equal(out.method, "withdraw");
  assert.equal(out.tgas, 90n);

  for (const body of [{ type: "deposit", amount: 0 }, { type: "withdraw" }, { type: "pool-withdraw", shares: -1 }]) {
    assert.throws(() => planAction(body as never, context()), /positive/);
  }
});

test("an unknown action is refused before anything is signed", () => {
  assert.throws(() => planAction({ type: "leverage", strike: 2_400 }, context()), /unknown action "leverage"/);
  assert.throws(() => planAction({ type: "" }, context()), /unknown action/);
});

test("every planned call has a sentence the trader can read", () => {
  const sentences: Array<[Call, Record<string, unknown>]> = [
    [first(planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0.052 }, context())), { type: "buy", quantity: 3, limit: 0.052 }],
    [first(planAction({ type: "sell", strike: 2_400, ticket: 1 }, context())), { type: "sell", quantity: 3 }],
    [
      first(planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0.04, postOnly: true }, context())),
      { type: "buy", limit: 0.04 },
    ],
    [
      first(planAction({ type: "sell", strike: 2_400, quantity: 3, limit: 0.06, postOnly: true }, context())),
      { type: "sell", limit: 0.06 },
    ],
    [first(planAction({ type: "expire", strike: 2_400 }, context())), { type: "expire" }],
    [
      first(
        planAction(
          { type: "buy", strike: 2_400, quantity: 3, limit: 0.05 },
          context({ side: sideOf({ takeAsk: 0.05, takeAskFrom: "book", bestOfferId: 0 }) }),
        ),
      ),
      { type: "buy", quantity: 3 },
    ],
    [first(planAction({ type: "close", strike: 2_400, ticket: 1 }, context({ positions: [] }))), { type: "close", quantity: 1 }],
    [first(planAction({ type: "pool-deposit", amount: 10 }, context())), { type: "pool-deposit", amount: 10 }],
    [first(planAction({ type: "deposit", amount: 10 }, context())), { type: "deposit", amount: 10 }],
    [first(planAction({ type: "pool-withdraw", shares: 10 }, context())), { type: "pool-withdraw", shares: 10 }],
    [first(planAction({ type: "withdraw", amount: 10 }, context())), { type: "withdraw", amount: 10 }],
  ];
  const words = sentences.map(([call, body]) => describe([call], body as never, context()));
  assert.deepEqual(words, [
    "bought 3x from the pool at 0.0520",
    "sold 3x back to the pool",
    "bid resting at 0.0400",
    "offer resting at 0.0600",
    "asked the oracle to fix the series",
    "took 3x off the book",
    "sold 1x into a resting bid",
    "deposited 10.00 into the pool",
    "deposited 10.00",
    "redeemed 10.00 shares",
    "withdrew 10.00",
  ]);
  for (const word of words) assert.match(word, /\w/);
  assert.equal(describe([], {}, context()), "done");
});

test("legs come from the same geometry the ladder uses", () => {
  assert.deepEqual(legsOf("ETH", "Put", 2_400), { low: 2_300, high: 2_400 });
  assert.deepEqual(legsOf("BTC", "Call", 100_000), { low: 100_000, high: 104_000 });
});
