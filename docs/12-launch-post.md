# Introducing Optionality: No-Slippage, Zero-Liquidation Options & Private Copy Trading on NEAR

> **Live on NEAR Testnet:** [`options.sable-knee.testnet`](https://testnet.nearblocks.io/address/options.sable-knee.testnet) · **Collateral Token:** [`token.sable-knee.testnet`](https://testnet.nearblocks.io/address/token.sable-knee.testnet) · **Oracle Committee:** [`oracle.sable-knee.testnet`](https://testnet.nearblocks.io/address/oracle.sable-knee.testnet)
> **TEE Hardware Attestation:** Verified on-chain via OutLayer ([`tx 6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1`](https://testnet.nearblocks.io/txns/6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1))

---

## What is Optionality?

Optionality is a **fully on-chain, player-vs-pool options exchange and private copy trading protocol** built natively on NEAR.

Decentralized options protocols typically suffer from three crippling problems:
1. **Liquidation cascades & portfolio margin complexity:** protocols like Derive/Lyra mimic CeFi margin engines, exposing users to liquidation risk, oracle latency arbitrage, and complex collateral requirements.
2. **Zero privacy:** every trade, strike, size, and PnL is permanently exposed on public ledgers, making copy trading susceptible to predatory front-running and copycat exploitation.
3. **Fragmented UX:** users are forced to calculate delta, gamma, and complex payoff graphs across abstract chains instead of seeing positions anchored directly to time and price.

Optionality takes a radically different approach:

- **Zero Liquidations:** All positions are strictly bounded vertical spreads. Buyers risk only the premium paid; pool liability is capped at the spread width minus premium. No liquidations ever occur.
- **Gross Worst-Case Reservation (`Σ max_payout ≤ equity`):** The vault reserves the absolute worst-case liability for every open ticket at inception. The pool is mathematically solvent on every block.
- **4-Seat Cryptographic Oracle Committee:** Settlement is governed by a multi-seat committee (`venue-index`, `kraken`, `okx`, `pyth`) requiring quorum consensus before fixing any expiry price.
- **Native Browser Wallet Signing (Zero Server Custody):** Users sign all trades in their own wallet (MyNearWallet via NEAR Wallet Selector). The web gateway computes unsigned transaction execution plans (`/plan`), never touching private keys.
- **Interactive Positions & Expiry Timeline Chart:** A continuous time-versus-price visual canvas where traders can inspect listed spread walls, track open position moneyness, and click any wall to trade directly with their wallet.
- **Private Copy Trading Subscriptions (TEE Enclave + Shielded Funding):** A confidential execution architecture powered by OutLayer hardware-attested TEEs and Defuse Intents shielded funding, enabling creators to monetize proprietary option strategies without revealing wallet linkage or trade parameters to front-runners.
- **Loser Consolation Lottery:** Unlucky option buyers are automatically enrolled in a daily lottery draw funded by a dedicated fraction of venue turnover.

---

## Live Public Testnet Deployment

The complete protocol is deployed and verified on NEAR testnet:

| Contract | Testnet Account ID | Explorer Link |
|---|---|---|
| **Options Venue** | `options.sable-knee.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/options.sable-knee.testnet) |
| **Mock Collateral (`bUSD`)** | `token.sable-knee.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/token.sable-knee.testnet) |
| **Price Oracle Committee** | `oracle.sable-knee.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/oracle.sable-knee.testnet) |
| **Venue Administrator** | `sable-knee.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/sable-knee.testnet) |

### Verified On-Chain Trading Lifecycle Receipts

Every stage of the options lifecycle has been executed against live NEAR testnet RPC with public transaction receipts (`near-mvp/data/testnet-lifecycle.json`):

| Step | Method | Public Transaction Hash | Verification Outcome |
|---|---|---|---|
| **Collateral Faucet** | `mint` | [`CqS2i1vGZaQm3KJ9CW5XZnLrnUgFj3TmQ4WNsLsWU266`](https://testnet.nearblocks.io/txns/CqS2i1vGZaQm3KJ9CW5XZnLrnUgFj3TmQ4WNsLsWU266) | 1,000 test bUSD minted to visitor |
| **Venue Deposit** | `ft_transfer_call` | [`HAjJn7ZtRY4yRtaqo7nUVgfkCSEp31F3Wy8Duu7REqAs`](https://testnet.nearblocks.io/txns/HAjJn7ZtRY4yRtaqo7nUVgfkCSEp31F3Wy8Duu7REqAs) | 500 bUSD escrowed in options venue |
| **Early Withdrawal** | `withdraw` | [`9ZGTugMd99kqMExYKSvDyucLRLRvp1eqF4k8PBr8uqxf`](https://testnet.nearblocks.io/txns/9ZGTugMd99kqMExYKSvDyucLRLRvp1eqF4k8PBr8uqxf) | 50 bUSD withdrawn back to wallet |
| **Series Creation** | `create_series` | [`4MXvVgsRY95PMz7PkC7qpRw7ijRwQRjuY5kkjNKccEyA`](https://testnet.nearblocks.io/txns/4MXvVgsRY95PMz7PkC7qpRw7ijRwQRjuY5kkjNKccEyA) | ETH 2375–2425 Call spread created with storage rent |
| **Batch Quote** | `set_pool_quote` | [`D63FfESzyH5xeaEpmVftEJSR3B1M96qkD9SszQaUwKfq`](https://testnet.nearblocks.io/txns/D63FfESzyH5xeaEpmVftEJSR3B1M96qkD9SszQaUwKfq) | Ladder quoted at 25.00 bUSD mid |
| **Pool Market Buy** | `pool_buy` | [`28TpGYdim7jkxTBmhuvUhNAdWPJWipM1uTA6BC9GnceT`](https://testnet.nearblocks.io/txns/28TpGYdim7jkxTBmhuvUhNAdWPJWipM1uTA6BC9GnceT) | Ticket #2 bought from vault, worst-case reserved |
| **Early Close** | `pool_close` | [`A8dqwtNywcFj2beePiAeodVvQ7DocxQGd1dCDNaG1ynw`](https://testnet.nearblocks.io/txns/A8dqwtNywcFj2beePiAeodVvQ7DocxQGd1dCDNaG1ynw) | Ticket #2 closed early for 24.75 bUSD exit value |
| **Buy & Hold** | `pool_buy_held` | [`6Z1sB27dd4JEeQYPiGgKR9zUXMVfDaGiP9x7FmDyxE1G`](https://testnet.nearblocks.io/txns/6Z1sB27dd4JEeQYPiGgKR9zUXMVfDaGiP9x7FmDyxE1G) | Ticket #3 purchased with Hold flag to maturity |
| **Committee Fix** | *consensus* | On-chain state transition | 3 seats (`kraken`, `okx`, `venue-index`) agreed and fixed price |
| **Ticket Settlement** | `settle_ticket` | [`5cDEQh4AZsH5iwNrbCshU2xVH3s3eu4PfvFd72MsvkSm`](https://testnet.nearblocks.io/txns/5cDEQh4AZsH5iwNrbCshU2xVH3s3eu4PfvFd72MsvkSm) | Ticket #3 settled: 50.00 bUSD maximum payout credited |
| **Final Withdrawal** | `withdraw` | [`DojCccppFqZ32ENpuDMBEcDwZLZgfQF6sRDqS8ZZgKCe`](https://testnet.nearblocks.io/txns/DojCccppFqZ32ENpuDMBEcDwZLZgfQF6sRDqS8ZZgKCe) | Remaining balance withdrawn to user wallet |
| **Custody Check** | `custody` | On-chain invariant assertion | Conserved: held tokens equal liabilities (`100,425.375 bUSD`) |

---

## Core Feature Highlights

### 1. Visual Positions & Expiry Timeline Chart (`/chart`)

Traditional option chains present a spreadsheet grid of delta, gamma, and bid/ask columns that obscure the real relationship between price, strike boundaries, and time.

Optionality introduces a native **Positions & Expiry Timeline Chart**:
- **Continuous Timeline (X-Axis):** Plots observed session prices leading up to future expiry dates across 24-hour and 7-day horizons.
- **Price Geometry (Y-Axis):** Scaled to the underlying asset index.
- **Color-Coded Expiry Walls:** Every listed spread is visually mapped as a bounding corridor (green for Call spreads, red for Put spreads) between its lower and upper strikes.
- **Real-Time Moneyness & Intrinsic Value:** Badges immediately show whether a position is In-The-Money (`ITM`) or Out-Of-The-Money (`OTM`) along with countdowns to expiry.
- **Click-to-Trade Integration:** Clicking on any spread wall directly opens an order modal, queries live pool quotes from the contract, and prepares an unsigned transaction for one-click approval in MyNearWallet.

### 2. Private Copy Trading Subscriptions & Confidential TEE Architecture

Public copy trading is fundamentally flawed: malicious bots monitor the mempool or chain events, front-running followers and degrading copy trade execution.

Optionality solves this through **Confidential TEE Execution & Shielded Funding**:
- **Attested TEE Worker:** Built and verified on [OutLayer](https://app.outlayer.ai) using Intel SGX / TDX hardware enclaves. The worker was published to FastFS ([`wasm hash 0ff283...`](https://test.fastfs.io/sable-knee.testnet/outlayer.testnet/0ff283fb61333a1adacc99e23147426287a5195b82667a93c3b1020e62f45c3c.wasm), [`tx EPYAsZFn...`](https://testnet.nearblocks.io/txns/EPYAsZFnDcL7ahz1qReTMmkTt2RgmjceraomfmzCqx54)), executed on NEAR testnet ([`tx 6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1`](https://testnet.nearblocks.io/txns/6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1)), and verified via hardware attestation proofs.
- **Isolated Private Ledger (`near-mvp/private-ledger`):** An encrypted state machine managing pseudonymous identities (Ed25519 keys), atomic subscription payments, private trade journals, and autonomous follower copy mandates.
- **Autonomous Follower Execution:** Followers sign spending mandates with strictly enforced parameters (allowed asset, maximum expiry, budget cap, and loss-floor exit rules). When the strategy creator trades, followers are copied in the *same* state transition, preventing front-running and duplicate executions.
- **Shielded Funding Preflight:** Integrated with Defuse Intents SDK (`@defuse-protocol/intents-sdk`) requesting `confidentiality: advanced` to shield initial funding, eliminating public wallet linkage.
- **Padded Transport (`near-mvp/confidential-protocol`):** Enforces constant-size encrypted envelopes (ChaCha20-Poly1305) to eliminate side-channel packet-size analysis.

### 3. State-Rent Economics on NEAR

On NEAR, smart contracts pay recurring storage rent for state stored on-chain. Without explicit storage accounting, a busy DeFi venue will quietly drain its balance and fail all transactions.

Optionality implements full storage rent economics across all contracts:
- `create_series` charges exact byte costs (`SERIES_STATE_BYTES = 344`).
- `set_pool_quotes` charges rent **only for new cells** (`QUOTE_STATE_BYTES = 88`); re-quoting existing cells adds zero state and costs zero rent.
- `mock-ft` charges `ACCOUNT_STORAGE_BYTES = 128` on initial registration.
- Any excess attached deposit is automatically refunded to the caller via `Promise::transfer`.
- Public views (`get_storage_state()`) expose real-time byte usage and funding health.

### 4. Zero-Custody Browser Wallet Signing

Traders never share their private keys with the server or gateway:
- Embedded NEAR Wallet Selector supports MyNearWallet on testnet.
- Gateway endpoint `/plan` parses trade intents into unsigned NEAR FunctionCall transactions with computed gas and attached storage deposits.
- The user reviews and signs the transaction directly in their wallet.

---

## Testing & Verification Rigor

Financial software requires comprehensive verification. Optionality is backed by **372 automated tests** across seven distinct layers:

```
[1. Unit Tests] ────────────► 150+ example cases in Rust & TypeScript
[2. Property Suites] ───────► 11 proptest suites verifying mathematical bounds over thousands of inputs
[3. Stateful Session Fuzz] ──► 220-step randomized multi-user session asserting custody on every step
[4. Adversarial Suites] ────► Replay protection, double settlement, FOK atomicity, unauthorized calls
[5. Cross-Language Vectors] ─► Rust-generated trade vectors executed against TypeScript gateway
[6. Browser E2E] ───────────► Playwright browser automation with video capture and a11y checks
[7. Public Testnet Smoke] ──► Automated end-to-end lifecycle verification against live testnet contracts
```

Run the entire suite locally:
```bash
cd near-mvp
bash scripts/test.sh    # Builds wasm, runs 280 Rust tests + 92 TypeScript tests
```

---

## Quickstart: How to Run & Try It

### 1. Build and Launch
```bash
git clone https://github.com/OptionalityHQ/core.git
cd optionality/near-mvp
npm install
bash scripts/build.sh
node sim/build-demo.mjs
```

### 2. Run Against Live Testnet
```bash
NEAR_ADMIN_CREDENTIALS=~/.near-credentials/testnet/sable-knee.testnet.json scripts/testnet.sh
```

### 3. Open the Interface
Navigate to `http://127.0.0.1:8790`:
1. Connect your **MyNearWallet** testnet account.
2. Click **Claim 1,000 bUSD** from the faucet.
3. Click **Deposit** to fund your venue balance.
4. Open the **Chart** tab to inspect live expiry walls and place orders directly from the visual timeline.
5. Confirm transactions in your wallet.

---

## Complete Project Documentation

| # | Document | Topic |
|---|---|---|
| 1 | [Hackathon MVP](01-hackathon-mvp.md) | Problem statement, design decisions, and bounded spread mechanics |
| 2 | [On-chain Integration](02-onchain-integration.md) | Lifecycle mechanics, cross-contract calls, and gas management |
| 3 | [Loser Consolation](03-loser-consolation.md) | Payout math, lottery accumulation, and unfarmable design |
| 4 | [Pool Architecture](04-pool-architecture.md) | Player-vs-pool vault buckets, accounting invariants, and phase table |
| 5 | [Red Team](05-red-team.md) | Security testing, attack vectors, vulnerabilities found and fixed |
| 6 | [Gateway API](06-gateway-api.md) | REST/SSE endpoints (`/state`, `/plan`, `/faucet`, `/chart-series`, `/chart-quote`) |
| 7 | [Runbook](07-runbook.md) | Operational guide, health checks, testnet commands, failure modes |
| 8 | [Testing](08-testing.md) | Seven testing layers, mathematical proofs, and finding logs |
| 10 | [Testnet](10-testnet.md) | Deployed contract addresses, storage rent economics, verified receipts |
| 11 | [Private Copy Trading & Chart](11-private-copy-trading-and-chart.md) | TEE architecture, OutLayer hardware attestation, private ledger, and visual timeline chart |
| 12 | [Launch Post](12-launch-post.md) | Project announcement, explorer links, and testnet verification guide |
