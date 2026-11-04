# Introducing Optionality: Bounded Options on NEAR

> **Live on NEAR Testnet:** [`options.sable-knee.testnet`](https://testnet.nearblocks.io/address/options.sable-knee.testnet) · **Collateral Token:** [`token.sable-knee.testnet`](https://testnet.nearblocks.io/address/token.sable-knee.testnet) · **Oracle Committee:** [`oracle.sable-knee.testnet`](https://testnet.nearblocks.io/address/oracle.sable-knee.testnet)

---

## What is Optionality?

Optionality is a **fully on-chain, player-vs-pool options exchange** built natively on the NEAR blockchain.

Existing decentralized options venues force users to either navigate complex order books with portfolio margins and liquidation risk (like Derive/Lyra) or accept opaque vault pricing. Optionality takes a fundamentally different design path:

1. **Zero liquidations.** Every position is a defined bounded vertical spread (call spread or put spread). The buyer's downside is strictly capped at the premium paid; the seller's or pool's liability is strictly capped at the spread width minus premium. Nobody ever gets liquidated.
2. **Gross worst-case reservation (`Σ max_payout ≤ equity`).** The vault reserves the absolute worst-case liability for every open ticket at the moment of creation. LP withdrawals cannot remove funds needed for pending settlements. The pool is mathematically solvent on every block.
3. **Multi-seat oracle committee.** Option settlements are not decided by a single admin key or centralized feed. A 4-seat committee (`venue-index`, `kraken`, `okx`, `pyth`) with a quorum of 2 cryptographically signs individual price observations. The oracle contract requires consensus before fixing any expiry price.
4. **Loser consolation lottery.** Unlucky option buyers are automatically enrolled in a daily consolation lottery draw. A dedicated bucket accumulates a fraction of turnover, returning consolation value to expired out-of-the-money holders while remaining provably unfarmable.
5. **Native NEAR UX with Zero Gateway Custody.** Users sign all transactions directly through their own NEAR wallet (MyNearWallet via NEAR Wallet Selector). The web gateway computes unsigned transaction execution plans (`/plan`), leaving private keys strictly inside the user's browser.

---

## Live Public Testnet Deployment

The complete Optionality protocol is deployed, operational, and transaction-verified on the NEAR testnet:

| Contract | Testnet Account ID | Explorer Link |
|---|---|---|
| **Options Venue** | `options.sable-knee.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/options.sable-knee.testnet) |
| **Mock Collateral (`bUSD`)** | `token.sable-knee.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/token.sable-knee.testnet) |
| **Price Oracle Committee** | `oracle.sable-knee.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/oracle.sable-knee.testnet) |
| **Venue Administrator** | `sable-knee.testnet` | [View on NearBlocks](https://testnet.nearblocks.io/address/sable-knee.testnet) |

### Verified On-Chain Trading Lifecycle

The end-to-end lifecycle has been verified against the live testnet deployment (`scripts/testnet-smoke.mjs`), with real public transaction hashes:

- **Collateral Faucet Claim:** [`CqS2i1vGZaQm3KJ9CW5XZnLrnUgFj3TmQ4WNsLsWU266`](https://testnet.nearblocks.io/txns/CqS2i1vGZaQm3KJ9CW5XZnLrnUgFj3TmQ4WNsLsWU266) (1,000 test bUSD minted)
- **Venue Deposit:** [`HAjJn7ZtRY4yRtaqo7nUVgfkCSEp31F3Wy8Duu7REqAs`](https://testnet.nearblocks.io/txns/HAjJn7ZtRY4yRtaqo7nUVgfkCSEp31F3Wy8Duu7REqAs) (500 bUSD escrowed via `ft_transfer_call`)
- **Series Creation:** [`4MXvVgsRY95PMz7PkC7qpRw7ijRwQRjuY5kkjNKccEyA`](https://testnet.nearblocks.io/txns/4MXvVgsRY95PMz7PkC7qpRw7ijRwQRjuY5kkjNKccEyA) (Series #42 created with storage rent)
- **Pool Quote Posting:** [`D63FfESzyH5xeaEpmVftEJSR3B1M96qkD9SszQaUwKfq`](https://testnet.nearblocks.io/txns/D63FfESzyH5xeaEpmVftEJSR3B1M96qkD9SszQaUwKfq) (Ladder quote written)
- **Ticket Buy:** [`28TpGYdim7jkxTBmhuvUhNAdWPJWipM1uTA6BC9GnceT`](https://testnet.nearblocks.io/txns/28TpGYdim7jkxTBmhuvUhNAdWPJWipM1uTA6BC9GnceT) (Ticket #2 bought from vault)
- **Early Exit / Close:** [`A8dqwtNywcFj2beePiAeodVvQ7DocxQGd1dCDNaG1ynw`](https://testnet.nearblocks.io/txns/A8dqwtNywcFj2beePiAeodVvQ7DocxQGd1dCDNaG1ynw) (Ticket #2 closed early for 24.75 bUSD)
- **Hold Ticket Buy:** [`6Z1sB27dd4JEeQYPiGgKR9zUXMVfDaGiP9x7FmDyxE1G`](https://testnet.nearblocks.io/txns/6Z1sB27dd4JEeQYPiGgKR9zUXMVfDaGiP9x7FmDyxE1G) (Ticket #3 purchased with Hold flag)
- **Committee Settlement:** [`5cDEQh4AZsH5iwNrbCshU2xVH3s3eu4PfvFd72MsvkSm`](https://testnet.nearblocks.io/txns/5cDEQh4AZsH5iwNrbCshU2xVH3s3eu4PfvFd72MsvkSm) (Fixed by Kraken, OKX, and Venue Index; 50.00 bUSD payout credited)
- **Withdrawal:** [`DojCccppFqZ32ENpuDMBEcDwZLZgfQF6sRDqS8ZZgKCe`](https://testnet.nearblocks.io/txns/DojCccppFqZ32ENpuDMBEcDwZLZgfQF6sRDqS8ZZgKCe) (Funds returned to testnet wallet)
- **Custody Check:** verified on-chain that tokens held exactly equal expected liabilities (`100,425.375 bUSD`).

---

## Architectural Deep Dive

### 1. The Bounded Payoff Primitive

Unlike vanilla call and put options with infinite tails or liquidation cliffs, Optionality trades **bounded spreads**:

$$\text{Payoff}_{\text{Call}}(S_T) = q \times \operatorname{clamp}(S_T - K_{\text{low}},\, 0,\, K_{\text{high}} - K_{\text{low}})$$
$$\text{Payoff}_{\text{Put}}(S_T) = q \times \operatorname{clamp}(K_{\text{high}} - S_T,\, 0,\, K_{\text{high}} - K_{\text{low}})$$

The maximum possible payoff is fixed at creation:

$$M = q \times (K_{\text{high}} - K_{\text{low}})$$

Because $M$ is bounded and immutable:
- The buyer can never lose more than their premium.
- The pool can never pay out more than $M$.
- Every contract is 100% cash-covered in escrow from the first block.

### 2. Player-vs-Pool with Strict Accounting Invariants

The vault segregates funds into four distinct accounting buckets:

1. **`equity`**: LP capital backing pool obligations.
2. **`reserved`**: Gross maximum payout reserved for open pool-written tickets ($\sum M$).
3. **`venue`**: Accrued trading margins earned by the venue operator upon final settlement.
4. **`consolation`**: Escrow pool reserved exclusively for the loser lottery draw.

**The Golden Invariant:**
$$\text{Total Custody} = \text{User Available Balances} + \text{Equity} + \text{Venue Accrual} + \text{Consolation Pot} + \text{Pending Withdrawals}$$

This invariant is asserted on-chain on every state mutation.

### 3. State Rent Management on NEAR

On NEAR, contracts pay annual storage rent for state stored on-chain (~10 yoctoNEAR per byte). Without explicit storage accounting, a busy DeFi contract will silently drain its gas balance and revert all operations.

Optionality implements native storage rent economics:
- `create_series` requires attached rent covering the 344-byte permanent series row.
- `set_pool_quote` only charges rent when a new ladder cell is created; re-quoting existing cells costs zero rent.
- Overpayment is automatically refunded to the caller.
- `storage_deposit()` allows anyone to contribute to the venue's rent reserve.
- `get_storage_state()` provides transparent real-time views of byte usage and account rent funding.

---

## Testing & Verification Rigor

Financial software must be proved through adversarial testing, not happy-path demos. The Optionality codebase is protected by **340 automated tests** across seven distinct verification layers:

```
[Layer 1: Unit Tests] ───────► 150+ example cases in Rust & TypeScript
[Layer 2: Properties] ───────► 11 proptest suites verifying mathematical bounds over thousands of inputs
[Layer 3: Stateful Fuzzing] ──► 220-step randomized multi-user session re-checking balance sheet on every step
[Layer 4: Adversarial] ──────► Double settlement, replayed quotes, FOK atomicity, unauthorized calls
[Layer 5: Cross-Language] ───► Rust-generated trade vectors executed against TypeScript planner
[Layer 6: Browser E2E] ──────► Playwright browser automation with video capture, a11y, and stress testing
[Layer 7: Public Testnet] ───► Automated smoke tests against live testnet contracts with verified receipts
```

Run the complete test suite locally:
```bash
cd near-mvp
bash scripts/test.sh    # Runs all 340 tests across Rust and TypeScript
```

---

## Try It on Testnet

You can run the full UI and connect your MyNearWallet testnet account:

### 1. Clone & Build
```bash
git clone https://github.com/OptionalityHQ/core.git
cd optionality/near-mvp
npm install
bash scripts/build.sh
node sim/build-demo.mjs
```

### 2. Launch Testnet Services
```bash
NEAR_ADMIN_CREDENTIALS=~/.near-credentials/testnet/sable-knee.testnet.json scripts/testnet.sh
```

### 3. Open the Interface
Navigate to `http://127.0.0.1:8790` in your browser:
1. Click **Connect Wallet** (connects MyNearWallet testnet).
2. Click **Claim 1,000 bUSD** to receive test collateral from the faucet.
3. Click **Deposit** to transfer test collateral into the exchange.
4. Select an expiry ladder, choose your strike band, and click **Buy** or **Hold**.
5. Approve the transaction in your wallet.

---

## Summary of Deliverables

- **Rust Smart Contracts:** `bounded-options`, `price-oracle`, `mock-ft` with full NEP-141 & storage rent compliance.
- **High-Performance Pricing Engine:** Real-time multi-exchange WebSocket ingest (Coinbase, Binance, Bybit) with automated volatility surface generation.
- **Oracle Committee Daemon:** Multi-process Ed25519 signer architecture with durable key persistence.
- **Frontend & Gateway:** High-density, institutional-grade trading terminal with live order tape, volatility smile charts, and NEAR Wallet Selector integration.
- **Comprehensive Documentation:** 11 detailed architecture, testing, and operational runbook guides.
- **Verified Public Testnet Deployment:** Live on NEAR testnet with full on-chain lifecycle receipts.
