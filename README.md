# Optionality Adapter & Utilities (`optionality-adapter`)

TypeScript HTTP/RPC gateway adapter, per-wallet NEAR account isolation, 1Click/Intents confidential funding adapter, copy-trading service, and Model Context Protocol (MCP) utilities for **Optionality**.

## Repository Structure

- **`api/src/chain.ts`** — NEAR RPC transport, per-wallet isolated subaccount provisioning, transaction signing, and sandbox gas management.
- **`api/src/actions.ts`** — Transaction planner and builder for pool holds, order book takes, post-only bids/asks, cancellations, and settlements.
- **`api/src/gather.ts` & `api/src/gateway.ts`** — Multi-contract chain state aggregator, volatility smile assembler, NEP-141 unit converter, and unsigned transaction envelope builder.
- **`api/src/copy-trading.ts` & `api/src/confidential-intents.ts`** — 1Click/Intents confidential funding verification, TEE mandate lifecycle, and CEX-style leaderboard adapter.
- **`api/src/server.ts`** — HTTP API gateway (`:8790`) connecting NEAR contracts, the Rust pricing engine, and the web interface.
- **`mcp/`** — Model Context Protocol (MCP) server exposing Optionality market state, quotes, and transaction planning to AI agents.
- **`docs/`** — Protocol architecture, threat model, API route table, and operational runbooks.

## Test & Run

```bash
npm test
npm start
```
