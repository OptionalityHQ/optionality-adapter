#!/usr/bin/env node
/**
 * Near-Bounded-Options MCP Server
 * 
 * Exposes the venue as callable tools via Model Context Protocol
 * 
 * Usage: node mcp/index.mjs [--port 8790] [--engine http://127.0.0.1:8791]
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { Chain } from "./api/src/chain.ts";
import { gatherState } from "./api/src/gather.ts";
import { Tape } from "./api/src/gateway.ts";
import { planAction, type Call, describe as describeAction } from "./api/src/actions.ts";
import { History } from "./api/src/history.ts";

const PORT = Number(process.env.PORT || process.argv[2] || "8790");
const ENGINE = process.env.ENGINE || "http://127.0.0.1:8791";
const SESSION = process.env.SESSION || "data/chain-session.json";

// Read session file if exists
let session = null;
try {
    const raw = readFileSync(SESSION, "utf8");
    session = JSON.parse(raw);
} catch (err) {
    console.warn(`Warning: could not load ${SESSION}: ${err.message}`);
}

const engine = new URL(ENGINE).href;

export function json(status, body) {
    return new TextEncoder().encode(JSON.stringify(body));
}

// --- Tool handlers ---

async function readPortfolio(accountId) {
    try {
        const state = await fetch(`${window.location.origin}/state?asset=ETH`).then(r => r.json());
        const positions = state?.positions?.rows || [];
        return {
            success: true,
            portfolio: positions.map(p => ({
                ticketId: Number(p.ticket_id),
                series: p.series,
                side: p.side,
                contracts: Number(p.contracts),
                cost: Number(p.cost),
                mark: p.mark ? Number(p.mark) : null,
                exitUnit: p.exitUnit ? Number(p.exitUnit) : null,
                open: p.open !== null && !isNaN(p.open) ? Number(p.open) : null,
                expiry: p.expiry,
                held: p.held === true,
            }))
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function getLadder(asset, expiry, kind) {
    try {
        const response = await fetch(`${window.location.origin}/state?asset=${asset}&expiry=${expiry}`);
        const state = await response.json();
        if (!response.ok) throw new Error(state.error || "failed to fetch ladder");
        
        const chain = state.chain || [];
        const spot = state.spot ?? null;
        
        return {
            success: true,
            ladder: chain.map(row => {
                const callSide = row.call ? {
                    ask: row.call.ask > 0 ? Number(row.call.ask) : null,
                    bid: row.call.bid > 0 ? Number(row.call.bid) : null,
                    mid: row.call.poolAsk ? Number(row.call.poolAsk) : null,
                    takeAskFrom: row.call.takeAskFrom ?? null,
                    bestOfferId: row.call.bestOfferId ?? null,
                } : null;
                const putSide = row.put ? {
                    ask: row.put.ask > 0 ? Number(row.put.ask) : null,
                    bid: row.put.bid > 0 ? Number(row.put.bid) : null,
                    mid: row.put.poolAsk ? Number(row.put.poolAsk) : null,
                    takeAskFrom: row.put.takeAskFrom ?? null,
                    bestOfferId: row.put.bestOfferId ?? null,
                } : null;
                
                return {
                    strike: row.strike,
                    seriesId: row.settlement === "open" ? row.settlement : null, // will be fixed by contract reads
                    call: callSide,
                    put: putSide,
                };
            }),
            spot,
            expiries: state.expiries || [],
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function buyFromPool(seriesId, quantity, limit, hold, fill) {
    try {
        const result = await fetch("/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                type: hold ? "buy" : "market",
                series_id: seriesId,
                quantity: String(quantity),
                limit: limit ? String(limit) : undefined,
                hold: hold,
                fill: fill,
            })
        });
        const response = await result.json();
        if (!response.ok) throw new Error(response.error || "action failed");
        return {
            success: true,
            message: response.message,
            hash: response.hashes?.[0],
            value: response.values?.[0],
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function closePosition(ticketId, limit) {
    try {
        const result = await fetch("/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                type: "close",
                ticket: String(ticketId),
                limit: limit ? String(limit) : undefined,
            })
        });
        const response = await result.json();
        if (!response.ok) throw new Error(response.error || "action failed");
        return {
            success: true,
            message: response.message,
            hash: response.hashes?.[0],
            value: response.values?.[0],
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function requestSettlement(seriesId) {
    try {
        const result = await fetch("/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                type: "expire",
                series_id: seriesId,
            })
        });
        const response = await result.json();
        if (!response.ok) throw new Error(response.error || "action failed");
        return {
            success: true,
            message: response.message,
            hash: response.hashes?.[0],
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function settleTicket(ticketId) {
    try {
        const result = await fetch("/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                type: "settle",
                ticket: String(ticketId),
            })
        });
        const response = await result.json();
        if (!response.ok) throw new Error(response.error || "action failed");
        return {
            success: true,
            message: response.message,
            hash: response.hashes?.[0],
            value: response.values?.[0],
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function getPoolState() {
    try {
        const state = await fetch("/state?asset=ETH").then(r => r.json());
        return {
            success: true,
            pool: state.pool ?? null,
            custody: state.custody ?? null,
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function getOracleSeats() {
    try {
        const state = await fetch("/state?asset=ETH").then(r => r.json());
        return {
            success: true,
            oracle: state.oracle ?? null,
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function historySession(asset) {
    try {
        const state = await fetch(`/state?asset=${asset}`).then(r => r.json());
        return {
            success: true,
            history: state.history ?? null,
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// --- MCP protocol handler ---

const TOOLS = [
    {
        name: "read_portfolio",
        description: "Read current portfolio positions",
        inputSchema: {
            type: "object",
            properties: {
                account: { type: "string", description: "NEAR account ID (optional)" },
            },
        },
    },
    {
        name: "get_ladder",
        description: "Read market ladder for asset",
        inputSchema: {
            type: "object",
            properties: {
                asset: { type: "string", enum: ["ETH", "BTC"], description: "Asset pair" },
                expiry: { type: "string", description: "Expiry date or stamp (optional)" },
                kind: { type: "string", enum: ["Put", "Call"], description: "Option type (optional)" },
            },
        },
    },
    {
        name: "buy_from_pool",
        description: "Buy option spread from vault at mid or loaded price",
        inputSchema: {
            type: "object",
            properties: {
                series_id: { type: "number", description: "Series ID from ladder" },
                quantity: { type: "number", description: "Number of contracts" },
                limit: { type: "number", description: "Max price per contract (for non-held buys)" },
                hold: { type: "boolean", description: "Hold to expiry: no fee, no early close" },
                fill: { type: "string", description: "'fok' for fill-or-kill on book trades" },
            },
        },
    },
    {
        name: "close_position",
        description: "Sell position back to pool or into resting bid",
        inputSchema: {
            type: "object",
            properties: {
                ticket_id: { type: "number", description: "Ticket ID from portfolio" },
                limit: { type: "number", description: "Min unit premium floor (optional)" },
            },
        },
    },
    {
        name: "request_settlement",
        description: "Request oracle to fix price for a series",
        inputSchema: {
            type: "object",
            properties: {
                series_id: { type: "number", description: "Series ID to settle" },
            },
        },
    },
    {
        name: "settle_ticket",
        description: "Claim payout after series has been fixed",
        inputSchema: {
            type: "object",
            properties: {
                ticket_id: { type: "number", description: "Ticket ID to settle" },
            },
        },
    },
    {
        name: "get_pool_state",
        description: "Read vault buckets and capacity metrics",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "get_oracle_seats",
        description: "Read committee seats and their prices",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "history_session",
        description: "Read session history for asset",
        inputSchema: {
            type: "object",
            properties: {
                asset: { type: "string", enum: ["ETH", "BTC"], description: "Asset pair" },
            },
        },
    },
];

async function handleTool(name, args) {
    switch (name) {
        case "read_portfolio":
            return await readPortfolio(args.account);
        case "get_ladder":
            return await getLadder(args.asset, args.expiry, args.kind);
        case "buy_from_pool":
            return await buyFromPool(args.series_id, args.quantity, args.limit, args.hold, args.fill);
        case "close_position":
            return await closePosition(args.ticket_id, args.limit);
        case "request_settlement":
            return await requestSettlement(args.series_id);
        case "settle_ticket":
            return await settleTicket(args.ticket_id);
        case "get_pool_state":
            return await getPoolState();
        case "get_oracle_seats":
            return await getOracleSeats();
        case "history_session":
            return await historySession(args.asset);
        default:
            return { success: false, error: `Unknown tool: ${name}` };
    }
}

// Serve MCP over SSE or JSON-RPC
createServer(async (req, res) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    
    res.setHeader("Content-Type", "application/json");
    
    if (url.pathname === "/tools") {
        res.end(JSON.stringify({ tools: TOOLS }));
    } else if (url.pathname === "/call") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const parsed = JSON.parse(body);
                const result = handleTool(parsed.tool, parsed.args);
                res.end(JSON.stringify({ result }));
            } catch (error) {
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    } else if (url.pathname === "/" || url.pathname === "/health") {
        res.end(JSON.stringify({
            ok: true,
            engine: engine,
            port: PORT,
            tools: TOOLS.map(t => t.name),
        }));
    } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
    }
}).listen(PORT, () => {
    console.log(`MCP server listening on port ${PORT}`);
    console.log(`Engine: ${engine}`);
    console.log(`Tools available: ${TOOLS.map(t => t.name).join(", ")}`);
});
