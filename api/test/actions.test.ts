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
import { type LadderSide, type MarkSide, type PoolPrice, type PositionRow, mergeSide, normalizePositions } from "../src/gateway.ts";

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
  gamma: 0,
  vega: 0,
  theta: 0,
  low: 2_400,
  high: 2_500,
};

/**
 * The vault's published price, exactly as `get_pool_prices` answers: one
 * contract at a 0.0500 mid costs 0.0520 loaded and exits at 0.0450 haircut.
 * `THREE` is the same quote for the three-contract order most of these plans
 * are sized at, and the ceiling is over the whole ticket, not three times the
 * price for one.
 */
const ONE: PoolPrice = {
  seriesId: 2,
  midUnits: "50000",
  entryUnits: "52000",
  exitUnits: "45000",
  stampNs: 1_793_272_900_000_000_000,
  ageNs: 0,
};
const THREE: PoolPrice = { ...ONE, entryUnits: "156000", exitUnits: "135000" };

function sideOf(over: Partial<LadderSide> = {}): LadderSide {
  return { ...(mergeSide(MARK, [], [], 2, "open", ONE) as LadderSide), ...over };
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
    price: THREE,
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

test("a buy with nobody resting goes to the pool, at the venue's own mid", () => {
  const calls = planAction({ type: "buy", asset: "ETH", kind: "Call", strike: 2_400, quantity: 3, limit: 0.052 }, context());
  assert.equal(calls.length, 1);
  assert.equal(first(calls).method, "pool_buy");
  assert.equal(first(calls).args.series_id, 2);
  assert.equal(first(calls).args.quantity, "3000000");
  assert.equal(first(calls).args.mid_units, undefined, "there is no price argument for a caller to lie with");
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

test("a buy the market has already outpriced is refused before anything is signed", () => {
  // The limit came from a read one poll old and the venue has moved up to a
  // 0.0600 mid. The contract would call the budget too small; saying what
  // happened, in the price the trader can act on, is the gateway's job — and it
  // is the contract's own total it compares against, not a per-contract guess.
  const six: PoolPrice = { ...ONE, midUnits: "60000", entryUnits: "62400", exitUnits: "54000" };
  const side = sideOf({ takeAsk: 0.0624, takeAskFrom: "pool", poolAsk: 0.0624, ask: 0.0624 });
  assert.throws(
    () => planAction({ type: "buy", strike: 2_400, quantity: 1, limit: 0.055 }, context({ side, price: six })),
    /the ask moved to 0\.0624 · more than 1% past your 0\.0550/,
  );
  // At the new price the same click plans normally.
  const plans = planAction({ type: "buy", strike: 2_400, quantity: 1, limit: 0.0624 }, context({ side, price: six }));
  assert.equal(first(plans).method, "pool_buy");
  assert.equal(first(plans).args.max_total_premium, "62400", "the bound follows the quote the vault is on");
  // And a cell the vault refuses to write, with no one resting behind it, has no
  // price to buy at: 0.00 would be a number a click could not fill.
  assert.throws(
    () =>
      planAction(
        { type: "buy", strike: 2_400, quantity: 1, limit: 0.05 },
        context({ side: sideOf({ takeAsk: null, takeAskFrom: null, ask: 0, poolAsk: null }), price: null }),
      ),
    /nothing is offering/,
  );
  // The belt-and-braces half: a book price to route by is not a vault quote to
  // trade at, so a plan with nothing published still refuses rather than
  // inventing a mid.
  assert.throws(
    () => planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0.052 }, context({ price: null })),
    /vault is not writing/,
  );
});

test("a market buy pays the price the venue is quoting, within 1%", () => {
  // The ladder the trader read is one poll old. A half-percent move is the index
  // doing its job, not a different trade, so the order fills at the contract's
  // own number rather than bouncing off a limit nobody meant as a ceiling.
  const drifted: PoolPrice = { ...THREE, midUnits: "50250", entryUnits: "157000" };
  const calls = planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0.052 }, context({ price: drifted }));
  assert.equal(first(calls).method, "pool_buy");
  assert.equal(first(calls).args.mid_units, undefined, "the venue moved its quote; the order carries no price to agree to");
  assert.equal(first(calls).args.max_total_premium, "157000", "the budget rises to what the contract charges");
  assert.equal(describe(calls, { type: "buy", quantity: 3, limit: 0.052 }, context({ price: drifted })),
    "bought 3x from the pool at 0.0523 all-in");

  // Beyond a percent, the click was never an agreement to this price.
  assert.throws(
    () =>
      planAction(
        { type: "buy", strike: 2_400, quantity: 3, limit: 0.052 },
        context({ price: { ...THREE, entryUnits: "158000" } }),
      ),
    /the ask moved to 0\.0527 · more than 1% past your 0\.0520/,
  );
  // Cheaper is never a problem: the budget stays the trader's own.
  const cheaper = planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0.052 }, context());
  assert.equal(first(cheaper).args.max_total_premium, "156000");
});

test("a book take gets the same tolerance, in the offer's own units", () => {
  const calls = planAction(
    { type: "buy", strike: 2_400, quantity: 3, limit: 0.05 },
    context({ side: sideOf({ takeAsk: 0.0502, takeAskFrom: "book", bestOfferId: 0 }) }),
  );
  assert.equal(first(calls).method, "fill_market_order");
  assert.equal(first(calls).args.max_total_premium, "150600", "3 × the resting offer, not 3 × the stale screen");
  assert.throws(
    () =>
      planAction(
        { type: "buy", strike: 2_400, quantity: 3, limit: 0.05 },
        context({ side: sideOf({ takeAsk: 0.0512, takeAskFrom: "book", bestOfferId: 0 }) }),
      ),
    /more than 1%/,
  );
});

test("the vault's price is read for the whole quantity, never multiplied", () => {
  // Three contracts cost 0.1560, which is 0.0520 each only because the ceiling
  // lands even here. A planner that multiplied the one-contract ask would be a
  // planner that occasionally signed a budget the contract calls too small.
  const calls = planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0.052 }, context());
  assert.equal(first(calls).args.mid_units, undefined);
  assert.equal(describe(calls, { type: "buy", quantity: 3, limit: 0.052 }, context()), "bought 3x from the pool at 0.0520 all-in");
  assert.throws(
    () => planAction({ type: "buy", strike: 2_400, quantity: 3, limit: 0 }, context()),
    /limit price/,
    "a click with no price is not a click with a cheap price",
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
  assert.equal(first(toPool).args.min_exit_units, null, "a close with no floor asks for nothing");

  const fromBook = normalizePositions([{ ...POSITION, maker: "maker-1.testnet" }], "vault.testnet");
  const toPerson = planAction(
    { type: "close", strike: 2_400, quantity: 3, ticket: 1, limit: 0.045 },
    context({ positions: fromBook }),
  );
  assert.equal(first(toPerson).method, "close_ticket");
  assert.equal(first(toPerson).args.min_unit_premium, "45000");
  const noFloor = planAction({ type: "close", strike: 2_400, ticket: 1 }, context({ positions: fromBook }));
  assert.equal(first(noFloor).args.min_unit_premium, null);
  assert.throws(() => planAction({ type: "sell", strike: 2_400 }, context()), /writing a ticket needs a price/);

  // Into the vault the trader cannot name a price either, only refuse one: the
  // floor travels as `min_exit_units`, 1% under the price the rail showed for the
  // ticket's three contracts — and a quote that has already fallen under it is
  // said out loud instead of signed into a reverted close.
  const floored = planAction({ type: "sell", strike: 2_400, ticket: 1, limit: 0.045 }, context());
  assert.equal(first(floored).args.min_exit_units, "133650");
  assert.throws(
    () => planAction({ type: "sell", strike: 2_400, ticket: 1, limit: 0.06 }, context()),
    /the exit fell to 0\.0450 · more than 1% under your 0\.0600/,
  );
});

test("a sell that names no ticket writes one: into a bid that pays, or resting", () => {
  // Someone is bidding 0.048 for this cell and the trader asked 0.045: the
  // contract takes the bid and the writer posts the width.
  const crossing = planAction(
    { type: "sell", strike: 2_400, quantity: 2, limit: 0.045 },
    context({ side: sideOf({ bid: 0.048, bestBidId: 7, bidSize: 2 }) }),
  );
  assert.equal(first(crossing).method, "fill_bid");
  assert.equal(first(crossing).args.bid_id, 7);

  // Asked more than anyone is bidding, so nothing fills and the quote rests.
  const resting = planAction({ type: "sell", strike: 2_400, quantity: 2, limit: 0.06 }, context());
  assert.equal(first(resting).method, "post_offer");
  assert.equal(first(resting).args.premium, "120000");

  // A bid that pays but is a different size also rests: `fill_bid` takes the
  // whole bid, and a writer must not be handed a ticket they did not size.
  const wrongSize = planAction(
    { type: "sell", strike: 2_400, quantity: 2, limit: 0.045 },
    context({ side: sideOf({ bid: 0.048, bestBidId: 7, bidSize: 5 }) }),
  );
  assert.equal(first(wrongSize).method, "post_offer");
});

test("a sell against the pool needs the venue's price for that ticket's series", () => {
  assert.throws(
    () => planAction({ type: "sell", strike: 2_400, ticket: 1 }, context({ price: null })),
    /no live price/,
  );
  // The cell on screen is not the holder's series: a quote for a different one
  // would be a mid the contract refuses, so the plan refuses first.
  assert.throws(
    () => planAction({ type: "sell", strike: 2_400, ticket: 1 }, context({ price: { ...THREE, seriesId: 9 } })),
    /no live price/,
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
    "bought 3x from the pool at 0.0520 all-in",
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
