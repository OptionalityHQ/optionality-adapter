# Near-Bounded-Options MCP Server

This directory contains the **MCP (Model Context Protocol) server** that exposes the NEAR bounded-options venue as a set of callable tools for AI agents.

## Prerequisites

- Node.js 24.x or later
- The venue running (`bash scripts/venue.sh`)

## Running the MCP Server

```bash
cd near-mvp/mcp
node index.mjs --port 8790
```

The server will listen on port 8790 by default and expose these tools:

## Tools

### Trading

| Tool | Description | Parameters |
|------|-------------|------------|
| `read_portfolio` | Read current portfolio positions | `{ account?: string }` |
| `get_ladder` | Read market ladder for asset | `{ asset: "ETH"|"BTC", expiry?: string, kind?: "Put"|"Call" }` |
| `buy_from_pool` | Buy from vault at mid or loaded price | `{ series_id: number, quantity: number, limit?: number, hold?: boolean, fill?: "fok" }` |
| `close_position` | Sell back to pool or into bid | `{ ticket_id: number, limit?: number }` |
| `post_bid` | Resting bid on book | `{ series_id: number, quantity: number, premium: number, expires_ns?: number }` |
| `cancel_offer` | Cancel resting offer | `{ id: number }` |

### Settlement

| Tool | Description | Parameters |
|------|-------------|------------|
| `request_settlement` | Request oracle fix for series | `{ series_id: number }` |
| `settle_ticket` | Claim payout after fixation | `{ ticket_id: number }` |

### Query

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_series` | Read series details | `{ series_id: number }` |
| `get_pool_state` | Read vault buckets | `{}` |
| `get_oracle_seats` | Read committee seats | `{}` |
| `history_session` | Read session history | `{ asset?: string }` |

## Agent Patterns

Example agent flow:

```javascript
// Read market context
const ladder = await mcp.tools.get_ladder({ asset: "ETH", kind: "Put" });

// Check portfolio
const portfolio = await mcp.tools.read_portfolio();

// Find opportunity near spot
const opportunity = ladder.rows.find(r => Math.abs(r.strike - ladder.spot) < 50);

if (opportunity && !portfolio.some(p => p.seriesId === opportunity.seriesId)) {
  // Execute trade
  const result = await mcp.tools.buy_from_pool({
    series_id: opportunity.seriesId,
    quantity: 1,
    hold: false,
  });
  console.log("Trade executed:", result);
}
```

## Security Model

- Same-origin signing: requests must come from trusted origins (localhost only in sandbox)
- Demo accounts: reset endpoint auto-funds below threshold
- All actions are signed transactions against the sandbox chain

## File Structure

```
mcp/
├── index.mjs         # MCP server implementation
├── tools/            # Individual tool handlers
│   ├── read_portfolio.ts
│   ├── get_ladder.ts
│   ├── buy_from_pool.ts
│   └── ...
├── chain/            # Lightweight client wrapper
└── readme.md         # This file
```

## Future Work

- [ ] Add streaming channels for real-time updates
- [ ] Support multi-account queries
- [ ] Add batch operations
- [ ] Implement rate limiting for public deployments
