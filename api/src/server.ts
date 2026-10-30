/**
 * The gateway's I/O half: HTTP in, transactions out. It is deliberately thin —
 * every decision lives in `gateway.ts`, `gather.ts` and `actions.ts`, where it
 * has a test. The one rule this file is allowed to break is arithmetic: if a
 * number is computed here rather than read from the chain or the engine, the
 * boundary has already leaked.
 *
 *   node api/src/server.ts --session data/chain-session.json --engine http://127.0.0.1:8787
 *
 * The chain client is `chain.ts`: signing and JSON-RPC, no product rules.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Chain } from "./chain.ts";
import { type Asset, type Kind, type LadderSide, type PoolPrice, SCALE, Tape, amount, fromUnits, rejectSigning } from "./gateway.ts";
import { type EngineMarks, type Views, type Registry, gatherState, registryForExpiry, seriesStrike } from "./gather.ts";
import { type Call, describe, planAction } from "./actions.ts";
import { marksFromEngine, mergeSide, normalizeBids, normalizeBook, normalizePool, normalizePrices, normalizePositions } from "./gateway.ts";

const arg = (name: string, fallback: string): string => {
  const argv = process.argv;
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

const PORT = Number(arg("--port", "8790"));
const ENGINE = arg("--engine", "http://127.0.0.1:8787");
const SESSION = arg("--session", "data/chain-session.json");
const DEMO = arg("--demo", "demo/index.html");
const STREAM_MS = Number(arg("--stream-ms", "700"));

/** The reads `gather.ts` asks for, mapped onto the contract's own names. */
function viewsFor(chain: Chain): Views {
  return {
    async seriesIds() {
      const stats = (await chain.view("stats")) as { series_count: number };
      return Array.from({ length: stats.series_count }, (_unused, index) => index);
    },
    getSeries: (seriesId) => chain.view("get_series", { series_id: seriesId }),
    getBook: (seriesId, limit) => chain.view("get_book", { series_id: seriesId, limit }),
    getBids: (seriesId, limit) => chain.view("get_bids", { series_id: seriesId, limit }),
    getPoolState: () => chain.view("get_pool_state"),
    // The vault's own prices. Chunked because the contract caps one call at 64
    // series and a two-asset ladder can pass it.
    getPoolPrices: (seriesIds, quantityUnits) =>
      chain.view("get_pool_prices", { series_ids: seriesIds, quantity: quantityUnits }),
    getPositions: (account) => chain.view("get_positions", { account, limit: 100 }),
    getBalance: (account) => chain.view("get_balance", { account_id: account }) as Promise<string>,
    expectedCustody: () => chain.view("expected_custody") as Promise<string>,
    getLpShares: (account) => chain.view("get_lp_shares", { account_id: account }) as Promise<string>,
    getLpValue: (account) => chain.view("get_lp_value", { account_id: account }) as Promise<string>,
    // The token is a different contract, so this read goes around the market
    // client's default destination.
    ftBalanceOf: (account) => chain.ftBalance(account),
    stats: async () => (await chain.view("stats")) as Record<string, unknown>,
  };
}

/**
 * The engine already has a price for every cell; take it as it is. These are its
 * model numbers — the mark and the display spread. The vault's tradeable price is
 * not among them: it is read off the chain with `get_pool_prices`, because the
 * contract only trades at the mid the venue published, in Rust integers.
 */
/** Pull the engine's current ladder, the same rows the screen already renders. */
async function engineRows(
  asset: Asset,
): Promise<{ rows: Array<{ strike: number; put: LadderSide | null; call: LadderSide | null }>; spot: number | null; expiryNs: string }> {
  const response = await fetch(`${ENGINE}/state?asset=${asset}`);
  if (!response.ok) throw new Error(`engine ${asset} state failed: ${response.status}`);
  const body = (await response.json()) as {
    spot: number | null;
    expiryNs: string;
    chain: Array<{
      strike: number;
      put: Record<string, number | string | null> | null;
      call: Record<string, number | string | null> | null;
    }>;
  };
  const side = (raw: Record<string, number | string | null> | null): LadderSide | null => {
    if (raw === null || raw === undefined) return null;
    const nullable = (key: string): number | null =>
      raw[key] === null || raw[key] === undefined ? null : Number(raw[key]);
    return {
      mark: Number(raw.mark ?? 0),
      bid: Number(raw.bid ?? 0),
      ask: Number(raw.ask ?? 0),
      markIv: nullable("markIv"),
      bidIv: nullable("bidIv"),
      askIv: nullable("askIv"),
      delta: Number(raw.delta ?? 0),
      gamma: Number(raw.gamma ?? 0),
      vega: Number(raw.vega ?? 0),
      theta: Number(raw.theta ?? 0),
      bidSize: nullable("bidSize") ?? 0,
      askSize: nullable("askSize") ?? 0,
      bidCount: nullable("bidCount") ?? 0,
      askCount: nullable("askCount") ?? 0,
      bestBidId: nullable("bidId"),
      bestOfferId: nullable("offerId"),
      // The engine has no say in what the vault charges, so it supplies neither
      // of these. A cell the contract has not quoted stays `poolAsk: null` and
      // the screen says the vault is not selling, rather than showing a mark a
      // click cannot fill.
      takeAsk: null,
      takeAskFrom: null,
      seriesId: null,
      settlement: "open",
      // The engine says the legs in the same integer units the contract stores.
      low: fromUnits(amount(raw.low ?? 0)),
      high: fromUnits(amount(raw.high ?? 0)),
    } as LadderSide;
  };
  return {
    rows: body.chain.map((row) => ({ strike: row.strike, put: side(row.put), call: side(row.call) })),
    spot: body.spot,
    // The stamp the cells were marked against. A ladder and a registry have to
    // agree on which batch they are describing, and the engine is the one that
    // decided — not the calendar day, which rolls over at 00:00 UTC and leaves a
    // page whose "today" no longer contains the live grid.
    expiryNs: String(body.expiryNs),
  };
}

/**
 * Which batch the screen is looking at: the stamp an expiry chip carried, the
 * day a link asked for, or — when nothing was asked — the expiry the engine is
 * pricing right now. The day is a poor default: it rolls at 00:00 UTC, and a
 * page opened late in the evening would otherwise be shown a grid that had
 * already run off while tonight's live one sat outside the filter.
 */
function expiryWanted(requested: string, liveExpiryNs: string): string {
  if (/^\d+$/.test(requested)) return requested;
  if (requested.length >= 10) return requested.slice(0, 10);
  return liveExpiryNs;
}

/**
 * The engine's index panel, as the engine wrote it. Nothing is added: a figure
 * computed here would be a second opinion about a price, which is the thing this
 * whole stack is arranged to avoid. Null means the engine is not answering, and
 * the banner says `offline` rather than showing the last number it knew.
 */
async function feedFromEngine(): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${ENGINE}/feed`);
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The page, pointed at whoever is serving it. An empty `MARKET_URL` makes every
 * fetch relative, so the same file works on any port the gateway is on and no
 * build step has to guess the deployment.
 */
function pageFor(htmlPath: string): string {
  return readFileSync(htmlPath, "utf8").replace(
    /const MARKET_URL = "[^"]*";/,
    'const MARKET_URL = ""; /* served by the gateway, so relative is correct */',
  );
}

async function main(): Promise<void> {
  const session = JSON.parse(readFileSync(SESSION, "utf8")) as {
    contracts: { options: string; token: string };
    roles: Record<string, { account: string }>;
  };
  const chain = await Chain.connect(SESSION);
  const views = viewsFor(chain);
  const you = chain.id("you");
  const vault = session.contracts.options;
  // The tape reads the venue the only way a gateway can: by watching what the
  // chain holds. These are the sandbox's funded roles, not a bot roster.
  const tape = new Tape();
  tape.self = you;
  const holders = Object.values(session.roles).map((role) => role.account);
  console.log(`gateway    ${vault}`);
  console.log(`as         ${you}`);
  console.log(`engine     ${ENGINE}`);

  const run = async (calls: Call[]): Promise<Array<{ hash: string; value: unknown }>> => {
    const out: Array<{ hash: string; value: unknown }> = [];
    for (const call of calls) {
      const args = { ...call.args };
      if (args.receiver_id === null) args.receiver_id = vault;
      const target = call.contract === "token" ? session.contracts.token : vault;
      out.push(
        await chain.call("you", call.method, args, {
          gas: call.tgas * 1_000_000_000_000n,
          deposit: (call.depositYocto ?? 0n).toString(),
          contract: target,
        }),
      );
    }
    return out;
  };

  /** Everything an action needs to be planned, read fresh for the POST.
   *
   * `quantity` is the contracts the click is for, because the vault prices a
   * whole quantity — the ceiling it charges for 3 contracts is not 3 times its
   * price for 1, and a plan that guessed would be a plan the contract rejects.
   * `expiry` is what the page asked for, unresolved: an empty string means the
   * batch the engine is live on, never whatever day the clock says. */
  const contextFor = async (
    asset: Asset,
    kind: Kind,
    strike: number,
    expiry: string,
    quantity: number,
  ) => {
    const ids = await views.seriesIds();
    const pairs: Array<[number, unknown]> = [];
    for (const seriesId of ids.slice(-400)) pairs.push([seriesId, await views.getSeries(seriesId)]);
    const { rows, expiryNs: liveExpiry } = await engineRows(asset);
    const registry: Registry = registryForExpiry(pairs, expiryWanted(expiry, liveExpiry), asset);
    const marks = marksFromEngine(rows);
    const seriesId = registry.idFor(asset, kind, strike);
    const info = seriesId === null ? null : registry.info(seriesId);
    // The vault's published price for exactly this quantity, in the integers the
    // contract will trade on. Absent when the venue has no live quote, and then
    // there is no pool trade to plan whatever the model says the cell is worth.
    const contracts = Math.max(1, Math.floor(quantity));
    let price: PoolPrice | null = null;
    if (seriesId !== null && info?.settlement === "open") {
      const raw = await views.getPoolPrices([seriesId], (SCALE * BigInt(contracts)).toString());
      price = normalizePrices(raw).get(seriesId) ?? null;
    }
    // Merged the same way the payload's row is: the engine's model, the book on
    // chain, and which of the two a taker would actually pay. Planning from the
    // model alone would route every order to the vault when a person had already
    // posted cheaper, and would let a post-only or stale-limit check compare
    // against a field that was never there.
    const side = mergeSide(
      marks.side(asset, kind, strike),
      seriesId === null ? [] : normalizeBook(await views.getBook(seriesId, 50)),
      seriesId === null ? [] : normalizeBids(await views.getBids(seriesId, 50)),
      seriesId,
      info?.settlement ?? "open",
      price,
    );
    return {
      you,
      vault,
      priceScale: 1_000_000,
      seriesFor: () =>
        seriesId === null || !info
          ? null
          : {
              seriesId,
              asset: info.asset,
              kind: info.kind,
              strike,
              low: info.low,
              high: info.high,
              expiryNs: info.expiryNs,
              settlement: info.settlement,
            },
      side,
      price,
      positions: normalizePositions(await views.getPositions(you), vault),
    };
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const json = (code: number, body: unknown) =>
      response.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
    if (url.pathname.startsWith("/fonts/")) {
      // The page's own typefaces: one flat segment, no traversal, read before
      // any header is written so a missing file answers 404 instead of killing
      // the venue mid-request.
      const name = url.pathname.slice("/fonts/".length);
      if (!/^[\w][\w.-]*$/.test(name)) return response.writeHead(400).end();
      let bytes: Buffer | null = null;
      try {
        bytes = readFileSync(`${DEMO.slice(0, DEMO.lastIndexOf("/") + 1)}fonts/${name}`);
      } catch {
        bytes = null;
      }
      if (bytes === null) return response.writeHead(404).end();
      return response
        .writeHead(200, { "content-type": "font/woff2", "cache-control": "no-store" })
        .end(bytes);
    }
    if (url.pathname === "/health") return json(200, { ok: true, contract: vault, engine: ENGINE });
    if (url.pathname === "/" || url.pathname === "/index.html") {
      // `no-store` so a rebuilt page cannot hide behind a browser cache.
      return response
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
        .end(pageFor(DEMO));
    }
    if (url.pathname === "/stream") {
      const asset = (url.searchParams.get("asset") === "BTC" ? "BTC" : "ETH") as Asset;
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      const push = async () => {
        const [feed, engine] = await Promise.all([feedFromEngine(), engineRows(asset).catch(() => null)]);
        if (feed === null || engine === null) return;
        // The index, the tape and the counters — not prices. A frame that
        // carried its own quote would be a second number for the same cell, and
        // `/state` is the one read the ticket is priced from.
        response.write(
          `data: ${JSON.stringify({
            index: feed,
            spot: engine.spot,
            tape: tape.rows.slice(0, 8),
            flow: { prints: tape.prints, realised: tape.realised },
          })}\n\n`,
        );
      };
      const timer = setInterval(() => void push(), STREAM_MS);
      void push();
      request.on("close", () => clearInterval(timer));
      return;
    }
    if (url.pathname === "/state") {
      const asset = url.searchParams.get("asset") === "BTC" ? "BTC" : "ETH";
      const wanted = url.searchParams.get("expiry") ?? "";
      // A chip that knows the exact stamp sends it; a link that only knows the
      // day gets the grid listed on that day; nothing at all gets the one the
      // engine is quoting this second.
      const kind = url.searchParams.get("kind") === "Call" ? "Call" : "Put";
      const strike = Number(url.searchParams.get("strike")) || null;
      const requestedAsset = asset as Asset;
      return void (async () => {
        try {
          const [{ rows, spot, expiryNs }, feed] = await Promise.all([engineRows(requestedAsset), feedFromEngine()]);
          const expiry = expiryWanted(wanted, expiryNs);
          const strikes = rows.map((row) => row.strike);
          const state = await gatherState({
            asset: requestedAsset,
            expiry,
            strikes,
            account: you,
            vault,
            views,
            marks: marksFromEngine(rows),
            spot,
            kind: strike === null ? null : (kind as Kind),
            strike,
            feed,
            tape,
            holders,
          });
          json(200, state);
        } catch (error) {
          json(500, { ok: false, error: String(error instanceof Error ? error.message : error) });
        }
      })();
    }
    if (url.pathname === "/action" && request.method === "POST") {
      // Every action signs. Nothing that is not this page, on this machine,
      // gets to ask.
      const foreign = rejectSigning({
        host: request.headers.host,
        origin: request.headers.origin as string | undefined,
      });
      if (foreign !== null) return json(403, { ok: false, error: foreign });
      // The body arrives after this handler returns: waiting for `end` is the
      // only way to see the order at all. Reading it too early is how every
      // action silently arrives as `{}`.
      const readBody = () =>
        new Promise<string>((resolve) => {
          let data = "";
          request.on("data", (chunk) => {
            data += chunk;
          });
          request.on("end", () => resolve(data));
        });
      return void (async () => {
        try {
          const parsed = JSON.parse((await readBody()) || "{}") as {
            type: string;
            asset?: string;
            kind?: string;
            strike?: number;
            quantity?: number | string;
            expiry?: string;
            id?: number | string;
            side?: string;
          };
          const asset = (parsed.asset === "BTC" ? "BTC" : "ETH") as Asset;
          const kind = (parsed.kind === "Call" ? "Call" : "Put") as Kind;
          const context = await contextFor(
            asset,
            kind,
            Number(parsed.strike),
            parsed.expiry ?? "",
            Number(parsed.quantity ?? 1),
          );
          const calls = planAction(parsed as never, context as never);
          const results = await run(calls);
          // What a run-off paid comes off the receipt, not out of this file. The
          // vault's own close answers with one number and `settle_ticket` with
          // [buyer, maker], so both shapes are read here.
          const paidOf = (value: unknown): number => {
            // A second claim on a ticket that has already paid returns nothing at
            // all, and a null read as 0 units is honest — read as NaN it would
            // poison the realised figure for the rest of the session.
            if (value === null || value === undefined) return 0;
            return Number(fromUnits(amount(Array.isArray(value) ? value[0] : value)));
          };
          calls.forEach((call, index) => {
            if (!["pool_close", "close_ticket", "settle_ticket"].includes(call.method)) return;
            tape.paid(you, Number(call.args.ticket_id), paidOf(results[index]?.value), call.method);
          });
          json(200, {
            ok: true,
            // The planner's own sentence, in the trader's words rather than the
            // method name: "bought 2x from the pool at 0.0520", not "pool_buy".
            message: calls.length
              ? `${describe(calls, parsed as never, context as never)} · ${results.length} tx`
              : "nothing to do",
            hashes: results.map((entry) => entry.hash),
            values: results.map((entry) => entry.value),
          });
        } catch (error) {
          json(400, { ok: false, error: String(error instanceof Error ? error.message : error) });
        }
      })();
    }
    return response.writeHead(404).end("not found");
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`listening  http://127.0.0.1:${PORT}  (engine at ${ENGINE})`);
  });
}

await main();
