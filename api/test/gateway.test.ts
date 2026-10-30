import test from "node:test";
import assert from "node:assert/strict";
import {
  type PositionRow,
  type PoolPrice,
  amount,
  buildCustody,
  buildLadder,
  buildOrders,
  buildPortfolio,
  buildState,
  expiryChips,
  fromUnits,
  kfmt,
  legsFor,
  mergeSide,
  normalizeBids,
  normalizeBook,
  normalizePool,
  normalizePositions,
  normalizePrices,
  marksFromEngine,
  normalizeSeries,
  rejectSigning,
  seriesDetail,
  settlementOf,
  seriesKey,
  stepFor,
  Tape,
  tickerFor,
  toUnits,
  widthFor,
} from "../src/gateway.ts";

/** A `get_book` row exactly as the contract returns it: `U128` as strings. */
const BOOK_ROW = {
  offer_id: 0,
  maker: "maker-1.testnet",
  quantity: "3000000",
  premium: "150000",
  unit_premium: "50000",
  taker: null,
  expires_ns: 1_793_272_000_000_000_000,
};

const BID_ROW = {
  bid_id: 4,
  owner: "bidder-1.testnet",
  quantity: "3000000",
  premium: "120000",
  unit_premium: "40000",
  expires_ns: 1_793_272_000_000_000_000,
};

/** One `get_pool_prices` row: the vault's mid and the integers it trades on, in
 * the SDK's dialect — `U128` wrappers as strings, the stamps as numbers. */
const PRICE_JSON = {
  series_id: 2,
  quantity: "1000000",
  mid_units: "50000",
  entry_units: "52000",
  exit_units: "45000",
  stamp_ns: 1_793_272_900_000_000_000,
  age_ns: 1_200_000_000,
};

/** The same price, projected, for the merges that need a vault side. */
const QUOTE: PoolPrice = {
  seriesId: 2,
  midUnits: "50000",
  entryUnits: "52000",
  exitUnits: "45000",
  stampNs: 1_793_272_900_000_000_000,
  ageNs: 1_200_000_000,
};

const POOL_JSON = {
  equity: "1000000150000",
  reserved: "0",
  venue_locked: "0",
  venue: "6000",
  consolation: "0",
  shares: "1000000000000",
  free_equity: "1000000150000",
  utilisation_bps: "0",
  open_tickets: 0,
  venue_account: "admin.testnet",
  margin_bps: 400,
  impact_bps: 1000,
};

const SERIES_JSON = {
  underlying: "ETH",
  kind: "Call",
  expiry_ns: 1_793_272_900_000_000_000,
  accept_until_ns: 1_793_273_000_000_000_000,
  finalize_until_ns: 1_793_302_900_000_000_000,
  // Raw u128, not the U128 wrapper: these arrive as JSON numbers.
  low_strike: 2_400_000_000,
  high_strike: 2_500_000_000,
  price_scale: 1_000_000,
  min_confidence_bps: 3000,
  oracle_feed: "ETH-USD",
  settlement: { Fixed: { price: 2_420_500_000, publish_time_ns: 1_793_272_958_304_000_000 } },
  pending_since_ns: 0,
};

const POSITION_JSON = {
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

test("amount crosses every JSON shape into bigint", () => {
  assert.equal(amount("150000"), 150_000n);
  assert.equal(amount(150_000), 150_000n);
  assert.equal(amount(150_000n), 150_000n);
  assert.equal(amount(null), 0n, "a missing optional amount is zero, not an error");
  assert.equal(amount(undefined), 0n);
});

test("amount refuses what a float cannot have held exactly", () => {
  assert.throws(() => amount(Number.MAX_SAFE_INTEGER + 1), /beyond float precision/);
  assert.throws(() => amount("1.5"), /not an integer/);
  assert.throws(() => amount("-1"), /not an integer/);
  assert.throws(() => amount("abc"), /not an integer/);
});

test("units convert at six decimals and mean the atom they show", () => {
  assert.equal(toUnits(3), 3_000_000n);
  assert.equal(toUnits(0.156), 156_000n, "a float artifact must not become a whole atom");
  assert.equal(toUnits(0.05), 50_000n);
  assert.equal(toUnits(22.62), 22_620_000n);
  assert.equal(toUnits(0.0000004), 0n, "below half an atom there is nothing to send");
  assert.equal(fromUnits(156_000n), 0.156);
  assert.equal(fromUnits(amount(POOL_JSON.equity)), 1_000_000.15);
  assert.throws(() => toUnits(Number.POSITIVE_INFINITY), /not a price/);
  assert.throws(() => toUnits(Number.NaN), /not a price/);
});

test("the ladder geometry matches the screen", () => {
  assert.equal(stepFor("ETH"), 25);
  assert.equal(stepFor("BTC"), 1_000);
  assert.equal(widthFor("ETH"), 100);
  assert.equal(widthFor("BTC"), 4_000);
  assert.deepEqual(legsFor("Put", 2_400, "ETH"), { low: 2_300, high: 2_400 });
  assert.deepEqual(legsFor("Call", 2_400, "ETH"), { low: 2_400, high: 2_500 });
  assert.deepEqual(legsFor("Call", 100_000, "BTC"), { low: 100_000, high: 104_000 });
});

test("a series is addressed by the screen's key and labelled by the tape's ticker", () => {
  assert.equal(seriesKey("ETH", "2026-10-29T20:00:00Z", "Call", 2_400), "ETH|2026-10-29|Call|2400");
  assert.equal(tickerFor("ETH", "Call", 2_400, 2_500), "ETH C2400/2500");
  assert.equal(tickerFor("ETH", "Put", 2_300, 2_400), "ETH P2300/2400");
  assert.equal(tickerFor("BTC", "Call", 100_000, 104_000), "BTC C100k/104k");
  // The whole point: the two cells a 25-grid actually offers must not share a label.
  assert.notEqual(
    tickerFor("ETH", "Call", 2_375, 2_475),
    tickerFor("ETH", "Call", 2_400, 2_500),
    "a label that names two instruments is not a label",
  );
  assert.equal(kfmt(2_450), "2450", "an ETH strike is printed as itself");
  assert.equal(kfmt(950), "950", "below a thousand the number is the label");
  assert.equal(kfmt(60_000), "60000", "a BTC strike keeps its thousands");
  assert.equal(kfmt(100_000), "100k", "above a hundred thousand the digit is free");
});

test("both settlement encodings collapse to one word", () => {
  assert.equal(settlementOf("Open"), "open");
  assert.equal(settlementOf("Pending"), "pending");
  assert.equal(settlementOf("Void"), "void");
  assert.equal(settlementOf("Fixed { price: 1, publish_time_ns: 2 }"), "fixed");
  assert.deepEqual(settlementOf({ Fixed: { price: 1 } }), "fixed");
  assert.equal(settlementOf(null), "open");
});

test("get_book rows normalise into screen units, cheapest first as the chain ordered them", () => {
  const book = normalizeBook([BOOK_ROW, { ...BOOK_ROW, offer_id: 1, unit_premium: "70000" }]);
  assert.equal(book.length, 2);
  assert.equal(book[0].offerId, 0);
  assert.equal(book[0].quantity, 3);
  assert.equal(book[0].unitPremium, 0.05);
  assert.equal(book[0].premium, 0.15);
  assert.equal(book[1].unitPremium, 0.07);
  assert.equal(book[0].taker, null);
  assert.deepEqual(normalizeBook(null), [], "a missing view is an empty book, not a crash");
});

test("a reserved offer keeps its taker so the screen can say so", () => {
  const book = normalizeBook([{ ...BOOK_ROW, taker: "someone.testnet" }]);
  assert.equal(book[0].taker, "someone.testnet");
});

test("get_bids normalises the same way", () => {
  const bids = normalizeBids([BID_ROW]);
  assert.equal(bids[0].bidId, 4);
  assert.equal(bids[0].owner, "bidder-1.testnet");
  assert.equal(bids[0].unitPremium, 0.04);
  assert.equal(bids[0].quantity, 3);
});

test("the pool view exposes both margin buckets separately", () => {
  const pool = normalizePool(POOL_JSON);
  assert.equal(pool.equity, 1_000_000.15);
  assert.equal(pool.venueLocked, 0);
  assert.equal(pool.venue, 0.006);
  assert.equal(pool.shares, 1_000_000);
  assert.equal(pool.freeEquity, 1_000_000.15);
  assert.equal(pool.utilisationBps, 0);
  assert.equal(pool.marginBps, 400);
  assert.equal(pool.impactBps, 1000);
  assert.equal(pool.venueAccount, "admin.testnet");
  const empty = normalizePool(null);
  assert.equal(empty.equity, 0);
  assert.equal(empty.utilisationBps, 0);
});

test("a series reads its strikes from raw numbers and its state from JSON", () => {
  const series = normalizeSeries(2, SERIES_JSON);
  assert.equal(series?.asset, "ETH");
  assert.equal(series?.kind, "Call");
  assert.equal(series?.low, 2_400);
  assert.equal(series?.high, 2_500);
  assert.equal(series?.settlement, "fixed");
  assert.equal(series?.minConfidenceBps, 3000);
  assert.equal(normalizeSeries(2, null), null);
});

test("a position names its counterparty so a close can be routed", () => {
  const rows = normalizePositions([POSITION_JSON], "vault.testnet");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.series, "ETH C2400/2500");
  assert.equal(row.contracts, 3);
  assert.equal(row.cost, 0.156);
  assert.equal(row.maxPayout, 300);
  assert.equal(row.settlement, "open");
  assert.equal(row.againstPool, true);
  assert.equal(row.fixedPrice, null);

  const againstPerson = normalizePositions(
    [{ ...POSITION_JSON, maker: "maker-1.testnet", side: "short" }],
    "vault.testnet",
  );
  assert.equal(againstPerson[0].againstPool, false);
  assert.equal(againstPerson[0].side, "short");
  assert.deepEqual(normalizePositions([{ ...POSITION_JSON, side: "weird" }], "vault.testnet"), []);
});

test("a resting quote beats the model, and the vault is still a candidate", () => {
  const mark = {
    mark: 0.05,
    bid: 0.045,
    ask: 0.055,
    markIv: 0.45,
    bidIv: 0.44,
    askIv: 0.46,
    delta: 0.1,
    low: 2_400,
    high: 2_500,
  };
  // The vault's price for one contract: 0.0520 loaded, 0.0450 haircut. It comes
  // from `get_pool_prices`, not from the model — which is the point: the engine
  // marks the market and only the contract prices a ticket.
  const merged = mergeSide(mark, normalizeBook([BOOK_ROW]), normalizeBids([BID_ROW]), 2, "open", QUOTE);
  assert.equal(merged?.ask, 0.05, "the book's 0.05 is a price with collateral behind it");
  assert.equal(merged?.bid, 0.04);
  assert.equal(merged?.askSize, 3);
  assert.equal(merged?.bidSize, 3);
  assert.equal(merged?.askCount, 1);
  assert.equal(merged?.bestOfferId, 0);
  assert.equal(merged?.bestBidId, 4);
  assert.equal(merged?.mark, 0.05, "the mark is still the model's");
  assert.equal(merged?.markIv, 0.45);
  assert.equal(merged?.poolAsk, 0.052);
  assert.equal(merged?.poolBid, 0.045);
  assert.equal(merged?.poolQuoteAgeS, 1.2, "how old the venue's standing price is, in seconds");
  assert.equal(merged?.takeAsk, 0.05);
  assert.equal(merged?.takeAskFrom, "book");

  const thinner = mergeSide(mark, [], [], 2, "open", QUOTE);
  assert.equal(thinner?.ask, 0.052, "with nobody resting, the ask is what the vault charges, not its model's spread");
  assert.equal(thinner?.bid, 0.045, "the bid stays the model's: the vault does not buy writes");
  assert.equal(thinner?.takeAskFrom, "pool", "the vault is the only maker left");
  assert.equal(thinner?.takeAsk, 0.052);
  assert.equal(thinner?.bidCount, 0);

  // No quote published is not a quote of zero: the cell has no vault side at
  // all, and a planner reading it finds nothing to agree to.
  const unquoted = mergeSide(mark, [], [], 2, "open", null);
  assert.equal(unquoted?.poolAsk, null);
  assert.equal(unquoted?.poolBid, null);
  assert.equal(unquoted?.poolQuoteAgeS, null);
  assert.equal(unquoted?.takeAsk, null, "a mark is not a price anyone can take");
  assert.equal(unquoted?.ask, 0.055, "and only then does the model's spread stand as the display");

  const bookOnly = mergeSide(null, normalizeBook([BOOK_ROW]), [], 2, "fixed");
  assert.equal(bookOnly?.ask, 0.05);
  assert.equal(bookOnly?.mark, 0.05, "with no mark the ask is the only price there is");
  assert.equal(bookOnly?.settlement, "fixed");
  assert.equal(mergeSide(null, [], [], null, "open"), null, "nothing to show");
});

test("the ladder is one row per strike with both sides", () => {
  const marks = {
    "Call|2400": {
      mark: 0.05,
      bid: 0.045,
      ask: 0.055,
      markIv: null,
      bidIv: null,
      askIv: null,
      delta: 0.1,
      low: 2_400,
      high: 2_500,
    },
  };
  const ladder = buildLadder({
    strikes: [2_350, 2_400],
    marks,
    books: { 2: normalizeBook([BOOK_ROW]) },
    bids: {},
    series: { 2: normalizeSeries(2, SERIES_JSON) },
    prices: { 2: QUOTE },
    idFor: (kind, strike) => (kind === "Call" && strike === 2_400 ? 2 : null),
  });
  assert.equal(ladder.length, 2);
  assert.equal(ladder[0].strike, 2_350);
  assert.equal(ladder[0].call, null);
  assert.equal(ladder[0].put, null);
  assert.equal(ladder[1].call?.seriesId, 2);
  assert.equal(ladder[1].call?.ask, 0.05);
  assert.equal(ladder[1].call?.poolAsk, 0.052, "the vault's side is the price the contract charges");
  assert.equal(ladder[1].call?.settlement, "fixed", "the row carries the series' own state");
  assert.equal(ladder[1].put, null);
});

test("orders are the whole resting book, best price first", () => {
  const orders = buildOrders(
    [{ seriesId: 2, ticker: "ETH C2.4k/2.5k", levels: normalizeBook([BOOK_ROW]) }],
    [{ seriesId: 2, ticker: "ETH C2.4k/2.5k", levels: normalizeBids([BID_ROW]) }],
    "vault.testnet",
  );
  assert.equal(orders.length, 2);
  assert.equal(orders[0].side, "sell", "0.05 sorts above 0.04");
  assert.equal(orders[0].price, 0.05);
  assert.equal(orders[1].side, "buy");
  assert.equal(orders[1].who, "bidder-1.testnet");
  assert.equal(orders[1].againstPool, false);
  const pooled = buildOrders(
    [{ seriesId: 2, ticker: "t", levels: normalizeBook([{ ...BOOK_ROW, maker: "vault.testnet" }]) }],
    [],
    "vault.testnet",
  );
  assert.equal(pooled[0].who, "the pool");
  assert.equal(pooled[0].againstPool, true);
});

test("a position is marked only when it can actually be closed", () => {
  const open = normalizePositions([POSITION_JSON], "vault.testnet")[0];
  const book = buildPortfolio([open], { 2: { mark: 0.08, exitValue: 0.072, bid: 0.06 } }, Date.UTC(2026, 9, 30, 12));
  const row = book.rows[0];
  assert.equal(row.mark, 0.08);
  // The vault pays its own exit for a ticket it made, and the unrealised number
  // is that price minus what it cost — never the mid, which the trader cannot
  // realise.
  assert.equal(row.exitUnit, 0.072);
  assert.equal(row.open, 0.072 * 3 - 0.156, "one contract's price against the whole ticket's cost");
  assert.equal(row.againstPool, true);
  assert.equal(row.closable, true);
  assert.equal(row.closeBlock, null);
  assert.equal(row.seriesKey.split("|")[2], "Call", "the close button addresses the cell, not the id");

  // A ticket a person made is not the vault's to buy back: it is worth whatever
  // the best bidder is resting, and with nobody resting there is no number.
  const fromBook = normalizePositions([{ ...POSITION_JSON, maker: "maker-1.testnet" }], "vault.testnet")[0];
  const priced = buildPortfolio([fromBook], { 2: { mark: 0.08, exitValue: 0.072, bid: 0.05 } }).rows[0];
  assert.equal(priced.exitUnit, 0.05, "a bidder's price, not the vault's exit");
  assert.equal(priced.open, 0.05 * 3 - 0.156);
  const unbid = buildPortfolio([fromBook], { 2: { mark: 0.08, exitValue: 0.072, bid: null } }).rows[0];
  assert.equal(unbid.open, null);
  assert.equal(unbid.closeBlock, "no bidder has priced this ticket");

  // A settled series has nothing left to close, however live the mark looks.
  const expired = normalizePositions([{ ...POSITION_JSON, settlement: "Void" }], "vault.testnet")[0];
  const voided = buildPortfolio([expired], { 2: { mark: 0.08, exitValue: null, bid: null } }).rows[0];
  assert.equal(voided.mark, null);
  assert.equal(voided.open, null);
  assert.equal(voided.closeBlock, "series void");

  const shortSide = normalizePositions([{ ...POSITION_JSON, side: "short" }], "vault.testnet")[0];
  assert.equal(buildPortfolio([shortSide], { 2: { mark: 0.08, exitValue: 0.07, bid: null } }).rows[0].mark, null);

  const unmarked = buildPortfolio([open], {}).rows[0];
  assert.equal(unmarked.mark, null, "no mark is not the same as a mark of zero");
  assert.equal(unmarked.cost, 0.156, "the facts still show");
  assert.equal(unmarked.closeBlock, "no mark yet");

  const totals = buildPortfolio([open], { 2: { mark: 0.08, exitValue: 0.072, bid: 0.06 } }).totals;
  assert.equal(totals.positions, 1);
  assert.equal(totals.closable, 1);
  assert.equal(totals.atRisk, 0.156, "a long spread can only lose what it cost");
});

test("custody compares two chain numbers and reports every bucket", () => {
  const stats = {
    total_available: "96880000",
    total_offer_collateral: "0",
    total_bid_escrow: "0",
    total_ticket_collateral: "0",
    total_ticket_premium: "0",
    total_pending_withdrawals: "0",
  };
  const good = buildCustody("45000000000000", "45000000000000", stats, normalizePool(POOL_JSON));
  assert.equal(good.conserved, true);
  assert.equal(good.expected, 45_000_000);
  assert.equal(good.held, 45_000_000);
  assert.deepEqual(
    good.buckets.map((bucket) => bucket.name),
    [
      "available",
      "offer collateral",
      "bid escrow",
      "ticket collateral",
      "ticket premium",
      "pending withdrawals",
      "pool equity",
      "margin locked",
      "margin earned",
      "consolation",
    ],
  );
  assert.equal(good.buckets.find((bucket) => bucket.name === "pool equity")?.tokens, 1_000_000.15);
  const bad = buildCustody("1000000", "999999", stats, normalizePool(POOL_JSON));
  assert.equal(bad.conserved, false);
});

test("the payload says where its numbers came from", () => {
  const state = buildState({
    now: 1,
    spot: 2_350,
    chain: [],
    positions: { rows: [], totals: { open: 0, atRisk: 0, positions: 0, closable: 0 } },
    orders: [],
    custody: buildCustody("0", "0", {}, normalizePool(null)),
    pool: normalizePool(POOL_JSON),
    seriesCount: 3,
    openTickets: 1,
    expiries: [],
    series: null,
    feed: null,
    tape: new Tape(),
    you: { account: "you.test", available: 5_000, wallet: 12 },
    lp: { account: "you.test", shares: 1_000, value: 1_000, exitable: true },
    contract: "vault.testnet",
  });
  assert.equal(state.source, "contract");
  assert.equal(state.spot, 2_350);
  assert.equal(state.seriesCount, 3);
  assert.deepEqual(Object.keys(state), [
    "now",
    "spot",
    "chain",
    "positions",
    "orders",
    "custody",
    "pool",
    "seriesCount",
    "openTickets",
    "expiries",
    "series",
    "feed",
    "trades",
    "volumeBuckets",
    "tape",
    "you",
    "lp",
    "contract",
    "source",
  ]);
});

test("the expiry strip comes from the chain's own series", () => {
  const now = Date.parse("2026-10-30T10:00:00Z");
  const at = (hours: number) => BigInt(Math.round((now + hours * 3_600_000) * 1e6));
  const infos = [
    { seriesId: 1, asset: "ETH" as const, kind: "Put" as const, low: 2_200, high: 2_300, expiryNs: Number(at(1)), settlement: "open" as const, fixedPrice: null, minConfidenceBps: 3_000 },
    { seriesId: 2, asset: "ETH" as const, kind: "Call" as const, low: 2_300, high: 2_400, expiryNs: Number(at(1)), settlement: "open" as const, fixedPrice: null, minConfidenceBps: 3_000 },
    { seriesId: 3, asset: "ETH" as const, kind: "Call" as const, low: 2_300, high: 2_400, expiryNs: Number(at(25)), settlement: "open" as const, fixedPrice: null, minConfidenceBps: 3_000 },
  ];
  const chips = expiryChips(infos, now);
  assert.equal(chips.length, 2, "one chip per expiry the chain actually has, not per day");
  assert.equal(chips[0].dte, 1);
  assert.match(chips[0].label, /11:00 UTC$/);
  assert.match(chips[1].label, /31 Oct/, "the next day is dated, not clocked");
  // The stamp is text so a nanosecond epoch survives a trip through the page.
  assert.equal(chips[0].ns, String(at(1)));
});

test("a series card states the chain's facts and its resting quotes", () => {
  const info = { seriesId: 7, asset: "ETH" as const, kind: "Put" as const, low: 2_200, high: 2_300, expiryNs: 1, settlement: "fixed" as const, fixedPrice: 2_250.5, minConfidenceBps: 3_000 };
  const card = seriesDetail(
    info,
    [{ offerId: 1, maker: "maker.test", quantity: 2, unitPremium: 9.5, premium: 19, expiresNs: 0, taker: null }],
    [{ bidId: 2, owner: "you.test", quantity: 1, unitPremium: 8, premium: 8, expiresNs: 0 }],
    { ns: "1", iso: "x", label: "11:00 UTC", dte: 1 },
  );
  assert.equal(card?.strike, 2_300, "a put is struck at its high leg");
  assert.equal(card?.settledPrice, 2_250.5);
  assert.equal(card?.settlement, "fixed");
  assert.equal(card?.offers[0]?.who, "maker.test");
  assert.equal(card?.bids[0]?.price, 8, "unit premium, so the depth panel needs no division");
  assert.equal(seriesDetail(null, [], [], null), null);
});

test("the tape records what the chain wrote and what it paid", () => {
  const tape = new Tape();
  const position = (ticketId: number, premium: number): PositionRow => ({
    ticketId, seriesId: 1, side: "long", series: "ETH C2350/2450", asset: "ETH", kind: "Call",
    contracts: 2, cost: premium, premium, maxPayout: 200, low: 2_350, high: 2_450,
    expiryNs: 1, settlement: "open", fixedPrice: null, againstPool: true,
  });
  const at = Date.parse("2026-10-30T10:00:00Z");
  tape.self = "you.test";
  const added = tape.observe([{ who: "you.test", position: position(0, 12.4) }], 2_360, at);
  assert.equal(added.length, 1);
  assert.match(added[0].text, /^10:00:00 you bought 2 ETH C2350\/2450 @ 6\.2000$/, added[0].text);
  assert.equal(added[0].side, "buy");
  assert.equal(added[0].size, 2);
  assert.equal(added[0].price, 6.2, "the premium the contract escrowed, per contract");
  assert.equal(tape.buckets[0].premium, 12.4);
  assert.equal(tape.buckets[0].notional, 2 * 2_360);

  // The same ticket on the next pass is not a new print.
  assert.equal(tape.observe([{ who: "you.test", position: position(0, 12.4) }], 2_360, at + 100).length, 0);
  assert.equal(tape.prints, 1);

  // A payout arrives from the receipt; realised is the only subtraction here and
  // both of its operands came off the chain.
  tape.paid("you.test", 0, 15.5);
  assert.equal(tape.realised, 15.5 - 12.4);
  assert.equal(tape.closed[0].proceeds, 15.5);
  assert.equal(tape.closed[0].pnl, 15.5 - 12.4);
  assert.equal(tape.closed[0].via, "the pool");

  const gone = tape.observe([], 2_360, at + 200);
  assert.equal(gone[0].side, "close");
  assert.equal(gone[0].size, 0, "a run-off has no size to show");
  assert.equal(tape.buckets.length, 1, "and it adds nothing to volume");
});

test("the vault's price list keeps the integers and keys them by series", () => {
  const prices = normalizePrices([PRICE_JSON, { ...PRICE_JSON, series_id: 3, entry_units: "104000" }]);
  assert.equal(prices.size, 2);
  assert.deepEqual(prices.get(2), QUOTE);
  assert.equal(prices.get(3)?.entryUnits, "104000", "a string amount stays a string, not a rounded float");
  // A contract that has nothing to say answers with an empty list, and a call
  // that failed answers with nothing at all. Neither is a price of zero.
  assert.equal(normalizePrices([]).size, 0);
  assert.equal(normalizePrices(null).size, 0);
  assert.equal(normalizePrices([{ series_id: 2 }]).size, 0, "a row with no price is not a price");
  assert.equal(normalizePrices([PRICE_JSON, PRICE_JSON]).size, 1, "one series, one quote");
});

test("engine marks are addressed by cell, never by series id", () => {  const rung = (mark: number): LadderSide => ({
    mark,
    bid: mark * 0.9,
    ask: mark * 1.04,
    markIv: 0.6,
    bidIv: null,
    askIv: null,
    delta: 0.5,
    gamma: 0.01,
    vega: 0.2,
    theta: -0.03,
    bidSize: 0,
    askSize: 0,
    bidCount: 0,
    askCount: 0,
    bestBidId: null,
    bestOfferId: null,
    poolAsk: mark * 1.04,
    poolBid: mark * 0.9,
    low: 2_400,
    high: 2_500,
  });
  // Strike 2400 and series id 2 exist in the same snapshot, on purpose: the bug
  // this pins down was a map keyed by strike being read with an id, which made
  // every pool buy answer "no mark to price this series from".
  const marks = marksFromEngine([
    { strike: 2_400, put: rung(0.4), call: rung(0.05) },
    { strike: 2, put: rung(0.5), call: null },
  ]);
  assert.equal(marks.side("ETH", "Call", 2_400)?.mark, 0.05);
  assert.equal(marks.side("ETH", "Call", 2_400)?.low, 2_400, "the legs travel with the price");
  assert.equal(marks.side("ETH", "Call", 2_400)?.high, 2_500);
  assert.equal(marks.side("ETH", "Call", 2_400)?.vega, 0.2, "and so does the risk table");
  assert.equal(marks.side("ETH", "Put", 2_400)?.mark, 0.4);
  assert.equal(marks.side("ETH", "Put", 2)?.mark, 0.5);
  assert.equal(marks.side("ETH", "Call", 2), null, "this rung has no call");
  assert.equal(marks.side("ETH", "Call", 2_375), null, "an unlisted strike is not a cell");
  assert.deepEqual(Object.keys(marks), ["side"], "no id-keyed lookup exists to misuse");
});

test("a listing name cannot bring markup into the payload", () => {
  // The contract refuses these now, and the projection does not depend on it:
  // the underlying is coerced to one of two assets, so whatever a series was
  // named with never reaches the page, an explorer or a log line.
  const hostile = normalizeSeries(7, {
    underlying: "<img src=x onerror=alert(1)>",
    kind: "Call",
    low_strike: 2_400_000_000,
    high_strike: 2_500_000_000,
    expiry_ns: 1,
    settlement: "Open",
    min_confidence_bps: 3_000,
  });
  assert.equal(hostile?.asset, "ETH", "an unknown name is not a second BTC");
  assert.doesNotMatch(JSON.stringify(hostile), /onerror|<img/, "the name never enters the payload");
});

test("only this page, on this machine, may ask the gateway to sign", () => {
  assert.equal(rejectSigning({ host: "127.0.0.1:8790" }), null, "a scripted client names no origin");
  assert.equal(rejectSigning({ host: "localhost:8790", origin: "http://localhost:8790" }), null);
  assert.equal(rejectSigning({ host: "127.0.0.1:8790", origin: "http://127.0.0.1:8790" }), null);

  // A page on another site, and a domain that rebound to loopback, both look
  // exactly like the venue to a socket and nothing like it to a browser.
  assert.match(String(rejectSigning({ host: "127.0.0.1:8790", origin: "http://evil.example" })), /not this venue/);
  assert.match(String(rejectSigning({ host: "evil.example:8790", origin: "http://evil.example:8790" })), /loopback/);
  assert.match(String(rejectSigning({ host: "attacker.example" })), /loopback/);
  assert.match(String(rejectSigning({})), /must name its host/);
});
