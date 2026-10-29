/**
 * What a click on the screen turns into on-chain. Planning is separate from
 * executing so that every routing rule is a pure function with a test: which
 * counterparty a trade goes to, what the buyer's budget is, how much gas a call
 * needs because it chains a transfer.
 *
 * The rule that matters: the vault is the default counterparty. The book is used
 * only when a resting offer actually beats the vault's loaded ask, and the
 * gateway knows that from numbers the chain and the engine already produced.
 */
import {
  type Asset,
  type Kind,
  type LadderSide,
  type PositionRow,
  type Settlement,
  legsFor,
  toUnits,
} from "./gateway.ts";

export interface ResolvedSeries {
  seriesId: number;
  asset: Asset;
  kind: Kind;
  strike: number;
  low: number;
  high: number;
  expiryNs: number;
  settlement: Settlement;
}

export interface Context {
  /** The account the gateway signs with, and the contract's own account. */
  you: string;
  vault: string;
  priceScale: number;
  seriesFor: (asset: Asset, kind: Kind, strike: number) => ResolvedSeries | null;
  /** The ladder cell the trader is looking at, already merged with the chain. */
  side: LadderSide | null;
  /** The engine's mark per contract, in tokens. */
  mid: number | null;
  positions: PositionRow[];
}

export interface Call {
  contract: "options" | "token" | "oracle";
  method: string;
  args: Record<string, string | number | null>;
  /** Tgas. A call that chains a cross-contract transfer must prepay for the
   * transfer *and* its callback, or the contract panics before any state write. */
  tgas: bigint;
  /** NEP-141 `ft_transfer*` refuses anything but exactly 1 yoctoNEAR attached,
   * so the deposit is part of the plan rather than something a runner guesses. */
  depositYocto?: bigint;
}

export interface ActionBody {
  type: string;
  asset?: string;
  kind?: string;
  strike?: number | string;
  quantity?: number | string;
  limit?: number | string;
  postOnly?: boolean;
  ticket?: number | string;
  amount?: number | string;
  shares?: number | string;
  expiry?: string;
}

const TGAS = 30n;
/** `withdraw` attaches 20 Tgas to the transfer and 25 to its callback. */
const CHAINED = 90n;

export function assetOf(value: unknown): Asset {
  return value === "BTC" ? "BTC" : "ETH";
}

export function kindOf(value: unknown): Kind {
  return value === "Call" ? "Call" : "Put";
}

/** Whole contracts only: the contract does not split a ticket, and neither does
 * this planner pretend to. */
export function contractsOf(value: unknown): number {
  const parsed = Math.floor(Number(value ?? 1));
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new RangeError("quantity must be at least one contract");
  }
  return parsed;
}

function requireSeries(context: Context, body: ActionBody): ResolvedSeries {
  const series = context.seriesFor(assetOf(body.asset), kindOf(body.kind), Number(body.strike));
  if (!series) throw new Error("unknown series");
  return series;
}

function requireOpen(series: ResolvedSeries): void {
  if (series.settlement !== "open") throw new Error("this series has already expired");
}

/**
 * A market buy: take the book if a resting offer is cheaper than the vault,
 * otherwise buy from the vault at its loaded price. `limit` is the price the
 * trader agreed to, and it becomes the slippage budget — never the fill price.
 */
function planBuy(context: Context, body: ActionBody): Call[] {
  const series = requireSeries(context, body);
  requireOpen(series);
  const contracts = contractsOf(body.quantity);
  const limit = Number(body.limit);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error("a buy needs a limit price");
  const budget = toUnits(limit * contracts);
  if (body.postOnly) {
    const resting = context.side?.takeAsk;
    if (resting !== null && resting !== undefined && limit >= resting) {
      throw new Error(`post-only bid ${limit.toFixed(2)} would cross the ask ${resting.toFixed(2)}`);
    }
    return [
      {
        contract: "options",
        method: "post_bid",
        args: {
          series_id: series.seriesId,
          quantity: toUnits(contracts).toString(),
          premium: toUnits(limit * contracts).toString(),
          expires_ns: Math.min(series.expiryNs, Date.now() * 1e6 + 3_600e9),
        },
        tgas: TGAS,
      },
    ];
  }
  // The page priced its limit from a read one poll old, and only the vault may
  // write this one. Signing anyway sends a budget the contract will call too
  // small, and "premium above the budget" is a bad way to tell someone the
  // market moved — or that there was never a price to take.
  const now = context.side?.takeAsk;
  if (now === null || now === undefined) {
    throw new Error("nothing is offering this spread: the vault will not write it and no one is resting one");
  }
  if (limit < now) {
    throw new Error(`the ask moved to ${now.toFixed(4)} · your limit was ${limit.toFixed(4)}`);
  }
  if (context.side?.takeAskFrom === "book" && context.side.bestOfferId !== null) {
    return [
      {
        contract: "options",
        method: "fill_market_order",
        args: {
          series_id: series.seriesId,
          quantity: toUnits(contracts).toString(),
          max_total_premium: budget.toString(),
          min_quantity: null,
        },
        tgas: TGAS,
      },
    ];
  }
  if (context.mid === null || context.mid === undefined) {
    throw new Error("no mark to price this series from");
  }
  return [
    {
      contract: "options",
      method: "pool_buy",
      args: {
        series_id: series.seriesId,
        quantity: toUnits(contracts).toString(),
        mid_units: toUnits(context.mid).toString(),
        max_total_premium: budget.toString(),
      },
      tgas: TGAS,
    },
  ];
}

/**
 * A sell. Two different things wear the same word, and the plan has to tell them
 * apart: naming a ticket hands one back (to the vault, or to a bidder), and
 * naming none *writes* one — into a resting bid if one pays, otherwise as an
 * offer that waits.
 */
function planSell(context: Context, body: ActionBody): Call[] {
  const series = requireSeries(context, body);
  const limit = Number(body.limit ?? 0);
  const contracts = contractsOf(body.quantity);
  const offer = (): Call => {
    requireOpen(series);
    return {
      contract: "options",
      method: "post_offer",
      args: {
        series_id: series.seriesId,
        quantity: toUnits(contracts).toString(),
        premium: toUnits(limit * contracts).toString(),
        taker: null,
        expires_ns: Math.min(series.expiryNs, Date.now() * 1e6 + 3_600e9),
      },
      tgas: TGAS,
    };
  };
  if (body.postOnly) {
    const bestBid = context.side?.bid ?? 0;
    if (bestBid > 0 && limit <= bestBid) {
      throw new Error(`post-only offer ${limit.toFixed(2)} would cross the bid ${bestBid.toFixed(2)}`);
    }
    return [offer()];
  }
  const ticket = Number(body.ticket);
  if (Number.isInteger(ticket)) {
    const held = context.positions.find(
      (row) => row.ticketId === ticket && row.side === "long" && row.againstPool,
    );
    if (held) {
      if (context.mid === null || context.mid === undefined) {
        throw new Error("no mark to close this ticket against");
      }
      return [
        {
          contract: "options",
          method: "pool_close",
          args: { ticket_id: ticket, mid_units: toUnits(context.mid).toString() },
          tgas: TGAS,
        },
      ];
    }
    // Not the vault's: hand it to a bidder instead, at or above the trader's floor.
    return [
      {
        contract: "options",
        method: "close_ticket",
        args: {
          ticket_id: ticket,
          min_unit_premium: limit > 0 ? toUnits(limit).toString() : null,
        },
        tgas: TGAS,
      },
    ];
  }
  // No ticket named, so this sell writes one. A resting bid that pays the price
  // asked is the counterparty already standing there: the contract hands the
  // writer the bidder's premium and posts the width as collateral. With nothing
  // to take, the order rests as an offer instead.
  const bestBidId = context.side?.bestBidId ?? null;
  const bestBid = context.side?.bid ?? 0;
  const bestBidSize = context.side?.bidSize ?? 0;
  if (limit <= 0) throw new Error("writing a ticket needs a price");
  // `fill_bid` takes the whole bid, so it is only the trader's order if the size
  // is what they asked for. Anything else rests, rather than filling a ticket of
  // a size nobody agreed to write.
  if (bestBidId !== null && bestBid >= limit && bestBidSize === contracts) {
    return [{ contract: "options", method: "fill_bid", args: { bid_id: bestBidId }, tgas: TGAS }];
  }
  return [offer()];
}

/** Fix the series from the oracle, then claim every ticket on it. Settlement is
 * two transactions because the print arrives in a callback the chain has to run
 * first — planning them together is what lets the screen say "settled N". */
function planExpire(context: Context, body: ActionBody): Call[] {
  const series = requireSeries(context, body);
  if (series.settlement !== "open" && series.settlement !== "pending") {
    throw new Error("this series is already settled");
  }
  return [
    {
      contract: "options",
      method: "request_settlement",
      args: { series_id: series.seriesId },
      tgas: CHAINED,
    },
  ];
}

function planSettle(context: Context, body: ActionBody): Call[] {
  const series = requireSeries(context, body);
  if (series.settlement !== "fixed" && series.settlement !== "void") {
    throw new Error("this series has not settled yet");
  }
  return context.positions
    .filter((row) => row.seriesId === series.seriesId)
    .map((row) => ({
      contract: "options" as const,
      method: "settle_ticket",
      args: { ticket_id: row.ticketId },
      tgas: TGAS,
    }));
}

export function planDeposit(body: ActionBody): Call {
  const value = Number(body.amount);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("amount must be positive");
  return {
    contract: "token",
    method: "ft_transfer_call",
    args: {
      receiver_id: null, // filled by the runner, which alone knows the account ids
      amount: toUnits(value).toString(),
      msg: "deposit",
    },
    tgas: CHAINED,
    depositYocto: 1n,
  };
}

/** Enter the vault with money already at the venue. The contract holds that
 * cash either way, so an FT round trip would only force an LP to withdraw
 * first; `pool_deposit_from_balance` moves the bucket and mints the shares in
 * one call. Wallets holding tokens can still use the `"pool-deposit"` message. */
export function planPoolDeposit(body: ActionBody): Call {
  const value = Number(body.amount);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("amount must be positive");
  return {
    contract: "options",
    method: "pool_deposit_from_balance",
    args: { amount: toUnits(value).toString() },
    tgas: TGAS,
  };
}

export function planPoolWithdraw(body: ActionBody): Call {
  const shares = Number(body.shares ?? body.amount);
  if (!Number.isFinite(shares) || shares <= 0) throw new RangeError("shares must be positive");
  return {
    contract: "options",
    method: "pool_withdraw",
    args: { shares: toUnits(shares).toString() },
    tgas: TGAS,
  };
}

export function planWithdraw(body: ActionBody): Call {
  const value = Number(body.amount);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("amount must be positive");
  return {
    contract: "options",
    method: "withdraw",
    args: { amount: toUnits(value).toString() },
    tgas: CHAINED,
  };
}

/** One entry point, the same shape the screen already posts. */
export function planAction(body: ActionBody, context: Context): Call[] {
  switch (body.type) {
    case "buy":
      return planBuy(context, body);
    case "sell":
    case "close":
      return planSell(context, body);
    case "expire":
      return planExpire(context, body);
    case "settle":
      return planSettle(context, body);
    case "deposit":
      return [planDeposit(body)];
    case "pool-deposit":
      return [planPoolDeposit(body)];
    case "pool-withdraw":
      return [planPoolWithdraw(body)];
    case "withdraw":
      return [planWithdraw(body)];
    default:
      throw new Error(`unknown action "${body.type}"`);
  }
}

/**
 * What the trader should be told after a planned call succeeded. Kept separate
 * from the call so the wording is testable without a chain.
 */
export function describe(calls: Call[], body: ActionBody, context: Context): string {
  const call = calls[0];
  const contracts = Number(body.quantity ?? 1);
  switch (call?.method) {
    case "pool_buy":
      return `bought ${contracts}x from the pool at ${Number(context.side?.takeAsk ?? 0).toFixed(4)}`;
    case "fill_market_order":
      return `took ${contracts}x off the book`;
    case "pool_close":
      return `sold ${contracts}x back to the pool`;
    case "close_ticket":
      return `sold ${contracts}x into a resting bid`;
    case "fill_bid":
      return `wrote ${contracts}x into a resting bid`;
    case "post_bid":
      return `bid resting at ${Number(body.limit).toFixed(4)}`;
    case "post_offer":
      return `offer resting at ${Number(body.limit).toFixed(4)}`;
    case "request_settlement":
      return "asked the oracle to fix the series";
    case "settle_ticket":
      return `settled ${calls.length} ticket(s)`;
    case "ft_transfer_call":
      return `deposited ${Number(body.amount).toFixed(2)}`;
    case "pool_deposit_from_balance":
      return `deposited ${Number(body.amount).toFixed(2)} into the pool`;
    case "pool_withdraw":
      return `redeemed ${Number(body.shares ?? body.amount).toFixed(2)} shares`;
    case "withdraw":
      return `withdrew ${Number(body.amount).toFixed(2)}`;
    default:
      return "done";
  }
}

export function legsOf(asset: Asset, kind: Kind, strike: number): { low: number; high: number } {
  return legsFor(kind, strike, asset);
}
