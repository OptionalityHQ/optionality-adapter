/**
 * Reading the chain into the shape the screen wants. Everything here is driven
 * through a `Views` interface, so the mapping is testable with a fake and the
 * real client stays a thin adapter.
 *
 * The series registry is *derived*, not stored: the contract is the only record
 * of which strikes exist and when they expire, so the gateway reads them back.
 * A side table of ids would be a second truth to keep in agreement — exactly the
 * thing this whole migration exists to remove.
 */
import {
  type Asset,
  type Kind,
  type LadderRow,
  type MarkSide,
  type PoolView,
  type PositionRow,
  type SeriesInfo,
  Tape,
  amount,
  buildCustody,
  buildLadder,
  buildOrders,
  buildPortfolio,
  buildState,
  expiryChips,
  fromUnits,
  normalizeBids,
  normalizeBook,
  normalizePool,
  normalizePositions,
  normalizeSeries,
  seriesDetail,
  seriesStrike,
  tickerFor,
} from "./gateway.ts";
import type { StatePayload } from "./gateway.ts";

export { seriesStrike } from "./gateway.ts";

/** Every read the gateway needs, as the contract exposes it. */
export interface Views {
  seriesIds(): Promise<number[]>;
  getSeries(seriesId: number): Promise<unknown>;
  getBook(seriesId: number, limit: number): Promise<unknown>;
  getBids(seriesId: number, limit: number): Promise<unknown>;
  getPoolState(): Promise<unknown>;
  getPositions(account: string): Promise<unknown>;
  getBalance(account: string): Promise<string | number | bigint>;
  getLpShares(account: string): Promise<string | number | bigint>;
  getLpValue(account: string): Promise<string | number | bigint>;
  expectedCustody(): Promise<string | number | bigint>;
  ftBalanceOf(account: string): Promise<string | number | bigint>;
  stats(): Promise<Record<string, unknown>>;
}

/** The engine's quote for one series, keyed the way the screen addresses cells. */
export interface EngineMarks {
  /** `${kind}|${strike}` → the loaded/haircut quotes and the model's spread. */
  side(asset: Asset, kind: Kind, strike: number): MarkSide | null;
}

/**
 * Which cell a series belongs to lives in `gateway.seriesStrike`, next to the
 * payload that prints it: a put is struck at its high leg and a call at its low
 * one, and two copies of that rule is how a screen and a chain drift apart.
 */

/** Expiry to a day. Nanosecond timestamps lose ~256 ns through JSON numbers,
 * which is days-resolution irrelevant and one fewer format to invent. */
export function expiryDate(expiryNs: number): string {
  return new Date(Math.round(expiryNs / 1e6)).toISOString().slice(0, 10);
}

export interface Registry {
  /** The ladder's address for a cell, or null when this market has none listed. */
  idFor(asset: Asset, kind: Kind, strike: number): number | null;
  info(seriesId: number): SeriesInfo | null;
  all(): SeriesInfo[];
}

/**
 * Registry for one expiry and one asset: the screen shows a single market at a
 * time, so the expiry and the underlying are the filter and the cell is
 * `(kind, strike)`.
 *
 * `expiry` is either a `YYYY-MM-DD` day or the nanosecond stamp the chips carry.
 * The day was enough while a venue listed one batch a day; an hourly engine puts
 * two grids on the same day, and a cell that resolves to whichever series the
 * read happened to see last is a price nobody quoted.
 */
export function registryForExpiry(
  pairs: Array<[number, unknown]>,
  expiry: string,
  asset: Asset,
): Registry & { list: SeriesInfo[]; expiries: SeriesInfo[] } {
  const byId = new Map<number, SeriesInfo>();
  const byCell = new Map<string, number>();
  const list: SeriesInfo[] = [];
  const exact = /^\d+$/.test(expiry);
  for (const [seriesId, raw] of pairs) {
    const info = normalizeSeries(seriesId, raw);
    if (!info || info.asset !== asset) continue;
    if (exact ? String(BigInt(info.expiryNs)) !== expiry : expiryDate(info.expiryNs) !== expiry) continue;
    byId.set(seriesId, info);
    byCell.set(`${info.kind}|${seriesStrike(info)}`, seriesId);
    list.push(info);
  }
  return {
    idFor: (wanted, kind, strike) =>
      wanted === asset ? (byCell.get(`${kind}|${strike}`) ?? null) : null,
    info: (seriesId) => byId.get(seriesId) ?? null,
    all: () => list,
    list,
    expiries: pairs
      .map(([seriesId, raw]) => normalizeSeries(seriesId, raw))
      .filter((info): info is SeriesInfo => info !== null && info.asset === asset),
  };
}

export interface GatherInput {
  asset: Asset;
  expiry: string;
  strikes: number[];
  account: string;
  vault: string;
  /** Reads from the chain. */
  views: Views;
  /** Reads from the engine. */
  marks: EngineMarks;
  spot: number | null;
  /** The cell the page has selected, for the series card. */
  kind?: Kind | null;
  strike?: number | null;
  /** The engine's own index panel, passed through as read. */
  feed?: Record<string, unknown> | null;
  /** The venue tape, advanced by what the chain holds now. */
  tape?: Tape | null;
  /** Accounts whose open tickets belong on the tape — the demo's roles, not a
   * bot list: the venue only ever reports what it can read back. */
  holders?: string[];
}

/** Read one snapshot of the chain and turn it into the screen's payload. */
export async function gatherState(input: GatherInput): Promise<StatePayload> {
  const ids = await input.views.seriesIds();
  // Cap the read: a live venue accumulates series every day, and the screen only
  // shows the ones it can price. Newest first, because that is the expiry in use.
  const recent = ids.slice(-400);
  const pairs: Array<[number, unknown]> = [];
  for (const seriesId of recent) {
    pairs.push([seriesId, await input.views.getSeries(seriesId)]);
  }
  const registry = registryForExpiry(pairs, input.expiry, input.asset);

  const books: Record<number, ReturnType<typeof normalizeBook>> = {};
  const bids: Record<number, ReturnType<typeof normalizeBids>> = {};
  for (const info of registry.list) {
    books[info.seriesId] = normalizeBook(await input.views.getBook(info.seriesId, 50));
    bids[info.seriesId] = normalizeBids(await input.views.getBids(info.seriesId, 50));
  }

  const marksByCell: Record<string, MarkSide> = {};
  for (const kind of ["Put", "Call"] as const) {
    for (const strike of input.strikes) {
      const side = input.marks.side(input.asset, kind, strike);
      // A cell the engine cannot price stays absent: the ladder shows the chain's
      // resting quotes for it and no mark, rather than inventing a mid.
      if (side) marksByCell[`${kind}|${strike}`] = side;
    }
  }

  const chain: LadderRow[] = buildLadder({
    strikes: input.strikes,
    marks: marksByCell,
    books,
    bids,
    series: Object.fromEntries(registry.list.map((info) => [info.seriesId, info])),
    idFor: (kind, strike) => registry.idFor(input.asset, kind, strike),
  });

  const pool: PoolView = normalizePool(await input.views.getPoolState());
  const holders = [...new Set([input.account, ...(input.holders ?? [])])];
  const byHolder = new Map<string, PositionRow[]>();
  for (const who of holders) byHolder.set(who, normalizePositions(await input.views.getPositions(who), input.vault));
  const positions = byHolder.get(input.account) ?? [];
  const observed: Array<{ who: string; position: PositionRow }> = [];
  for (const [who, rows] of byHolder) for (const position of rows) observed.push({ who, position });
  input.tape?.observe(observed, input.spot);
  // A ticket is marked from its own cell, not from the expiry the screen happens
  // to be looking at: the position rail has to value everything a holder owns,
  // including a batch they are not viewing.
  const marksBySeries: Record<number, { mark: number; exitValue: number | null }> = {};
  for (const rows of byHolder.values()) {
    for (const position of rows) {
      const side = marksByCell[`${position.kind}|${seriesStrike(position)}`];
      if (side) marksBySeries[position.seriesId] = { mark: side.mark, exitValue: side.poolBid };
    }
  }

  const stats = await input.views.stats();
  const custody = buildCustody(
    await input.views.expectedCustody(),
    await input.views.ftBalanceOf(input.vault),
    stats,
    pool,
  );
  const orders = buildOrders(
    registry.list.map((info) => ({
      seriesId: info.seriesId,
      ticker: tickerFor(info.asset, info.kind, info.low, info.high),
      levels: books[info.seriesId] ?? [],
    })),
    registry.list.map((info) => ({
      seriesId: info.seriesId,
      ticker: tickerFor(info.asset, info.kind, info.low, info.high),
      levels: bids[info.seriesId] ?? [],
    })),
    input.vault,
  );

  const expiries = expiryChips(registry.expiries, Date.now());
  const selectedNs = registry.list[0]?.expiryNs ?? null;
  const chip =
    selectedNs === null
      ? null
      : expiries.find((entry) => BigInt(entry.ns) === BigInt(selectedNs)) ?? null;
  const selectedId =
    input.kind && input.strike !== null && input.strike !== undefined
      ? registry.idFor(input.asset, input.kind, input.strike)
      : null;
  const series = seriesDetail(
    selectedId === null ? null : registry.info(selectedId),
    selectedId === null ? [] : (books[selectedId] ?? []),
    selectedId === null ? [] : (bids[selectedId] ?? []),
    chip,
  );

  // The rail says what a ticket costs *you*, so it reads your balance off the
  // contract instead of trusting a copy kept beside it.
  const youAvailable = fromUnits(amount(await input.views.getBalance(input.account)));
  // Two different balances, and the difference between them is exactly what a
  // deposit moves: what the contract has credited you, and what the token still
  // holds for you. Showing one and asking for the other is how a screen ends up
  // reporting "insufficient token balance" above a five-million-dollar balance.
  const youWallet = fromUnits(amount(await input.views.ftBalanceOf(input.account)));
  // The seat in the vault, quoted by the contract: `get_lp_value` is the exit's
  // own arithmetic, and the test for leaving is the one the contract applies —
  // free equity has to still cover every open worst case afterwards. One read,
  // so the quoted value and the exit test cannot come from two snapshots.
  const lpValueUnits = amount(await input.views.getLpValue(input.account));
  const lp = {
    account: input.account,
    shares: fromUnits(amount(await input.views.getLpShares(input.account))),
    value: fromUnits(lpValueUnits),
    exitable: fromUnits(lpValueUnits) > 0 && fromUnits(lpValueUnits) <= pool.freeEquity,
  };

  return buildState({
    now: Date.now(),
    spot: input.spot,
    chain,
    positions: buildPortfolio(positions, marksBySeries),
    orders,
    custody,
    pool,
    seriesCount: Number(stats.series_count ?? registry.list.length),
    openTickets: Number(stats.open_ticket_count ?? 0),
    expiries,
    series,
    feed: input.feed ?? null,
    tape: input.tape ?? new Tape(),
    you: { account: input.account, available: youAvailable, wallet: youWallet },
    lp,
    contract: input.vault,
  });
}

/** The per-account balances the rail shows, in one pass. */
export async function balancesOf(views: Views, accounts: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const account of accounts) {
    out[account] = Number(amount(await views.getBalance(account))) / 1e6;
  }
  return out;
}
