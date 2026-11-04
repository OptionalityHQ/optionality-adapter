# 10 · Testnet

What it takes to put this in front of strangers, how it is built, and what is verified on-chain.

The short version: **the venue is live on NEAR testnet.** All three contracts are deployed,
the storage-rent bug that would have killed a public venue is fixed on both the options contract
and the mock token, the gateway serves the screen with browser wallet signing (MyNearWallet),
a test collateral faucet is active, and a complete end-to-end lifecycle has been verified on
the public testnet with on-chain receipts.

## Live testnet deployment

Deployed to NEAR testnet under the account `sable-knee.testnet` using `scripts/deploy-testnet.sh`:

| Role | Contract Account | Responsibility |
|---|---|---|
| Venue Admin | `sable-knee.testnet` | sweeps earned margins, sets fee terms, owns the token & oracle |
| Options Venue | `options.sable-knee.testnet` | player-vs-pool vault, books, held tickets, custody conservation |
| Test Collateral | `token.sable-knee.testnet` | NEP-141 mock dollar (`bUSD`, 6 decimals), funded storage rent |
| Settlement Oracle | `oracle.sable-knee.testnet` | 4-seat committee (`venue-index`, `kraken`, `okx`, `pyth`), quorum 2 |

Configuration file: `data/testnet-session.json`.

## How the testnet stack runs

```bash
# 1. Start the complete testnet service stack:
scripts/testnet.sh
```

`scripts/testnet.sh` supervises three coordinated processes:

1. **Pricing Engine (`target/debug/engine`):** ingests live price feeds (Coinbase, Binance, Bybit)
   for ETH and BTC, derives the real-time median index, volatility smile and option grid, and serves
   them on port `8791`.
2. **Testnet Operator (`target/debug/chain-host --testnet-session`):**
   - Loads durable signer keys from `data/testnet-seats/` (written with `0600` permissions)
     and boots the 4 signer processes (`tools/oracle-signer`).
   - Verifies the local seats match the registered public keys on `oracle.sable-knee.testnet`.
   - Discovers unlisted expiry rungs from the pricing engine and creates them via `create_series`
     (attaching state rent).
   - Quotes the ladder cells in batches via `set_pool_quotes` as the venue account.
   - Runs the background oracle relay: feeds signed observations into the oracle contract,
     detects expired series, fixes the settlement price via committee consensus, and settles
     matured tickets.
3. **Gateway (`api/src/server.ts`):**
   - Connects to testnet RPC (`https://rpc.testnet.fastnear.com`).
   - Serves the frontend at `http://127.0.0.1:8790` with embedded NEAR Wallet Selector.
   - Operates the test-token faucet `/faucet` (rates limited, daily ledger journaled to disk).
   - Translates trade requests into unsigned transaction lists via `/plan`, leaving private
     keys entirely inside the visitor's wallet.

## The storage-rent architecture

NEAR charges rent per byte of contract state, paid from the contract's own balance.
If a contract writes state without collecting rent, it drains its account and stops
accepting transactions — including the settlements traders are waiting on.

Both contracts now price their own state:

### 1. Options contract (`contracts/bounded-options/src/lib.rs`)

```rust
SERIES_STATE_BYTES = 344  // permanent row, outlives settlement
QUOTE_STATE_BYTES  =  88  // ladder quote map entry
OFFER_STATE_BYTES  = 208  // order book entry
```

- **`create_series` is `#[payable]`:** the creator pays for the permanent state row.
- **`set_pool_quote` / `set_pool_quotes` are `#[payable]`:** only **new** ladder cells
  are charged. Re-quoting existing cells adds no bytes and costs zero rent, preventing
  refresh operations from taxing venue freshness.
- **Overpayment refund:** any deposit beyond the required rent is immediately returned
  to the caller via `Promise::new(predecessor).transfer(refund)`.
- **Top-up donation:** `storage_deposit()` allows anyone to fund the venue's rent buffer.
- **State transparency:** `get_storage_state()` reports required, paid, balance, price per
  byte, and whether the venue is funded.

### 2. Mock token contract (`contracts/mock-ft/src/lib.rs`)

```rust
ACCOUNT_STORAGE_BYTES = 128  // AccountId key + balance entry
```

- **`storage_deposit` requires actual rent:** registers the account only when attached
  deposit covers `ACCOUNT_STORAGE_BYTES * env::storage_byte_cost()`.
- **Refunds excess:** returning surplus yoctoNEAR to the caller.
- **Re-registration protection:** refusing second deposits when an account is already registered.

## Visitor signing and wallet integration

Visitors trade with their own testnet accounts:

1. **Browser wallet selector:** `api/src/wallet.ts` embeds `@near-wallet-selector/core`
   and `@near-wallet-selector/my-near-wallet`.
2. **Unsigned planning:** when a user clicks Buy, Hold, Sell, Deposit or Withdraw, the
   page sends the action to `POST /plan`.
3. **Zero custody:** the gateway computes the required contract calls and returns unsigned
   function-call transaction envelopes with accurate gas and attached deposits.
4. **Wallet confirmation:** the user approves the transaction in MyNearWallet, which
   broadcasts directly to NEAR testnet.

## Testnet collateral faucet

To let testers trade without manual token distributions:

- **Endpoint:** `POST /faucet`
- **Allowance:** 1,000 test tokens (`bUSD`) per request.
- **Rate limiting:** 1 claim per IP per 60 seconds.
- **Daily ledger (`FaucetLedger`):** max 1 claim per account per UTC day, max 100 daily claims.
  Persisted to `data/private/faucet.json` (`0600` permissions) across server restarts.
- **Account validation:** verifies the account exists on NEAR testnet before expending operator
  gas on `storage_deposit` and `mint`.

## Verified on-chain lifecycle

The full trading lifecycle has been verified against the live deployment using
`scripts/testnet-smoke.mjs --execute`. Every transaction succeeded on NEAR testnet:

| Step | Method | Hash | On-Chain Effect |
|---|---|---|---|
| Faucet | `mint` | `CqS2i1vGZaQm3KJ9CW5XZnLrnUgFj3TmQ4WNsLsWU266` | 1,000 bUSD minted to visitor |
| Deposit | `ft_transfer_call` | `HAjJn7ZtRY4yRtaqo7nUVgfkCSEp31F3Wy8Duu7REqAs` | 500 bUSD transferred to options contract |
| Withdraw | `withdraw` | `9ZGTugMd99kqMExYKSvDyucLRLRvp1eqF4k8PBr8uqxf` | 50 bUSD withdrawn back to wallet |
| Series | `create_series` | `4MXvVgsRY95PMz7PkC7qpRw7ijRwQRjuY5kkjNKccEyA` | Series #42 created (ETH 2375–2425 Call) |
| Quote | `set_pool_quote` | `D63FfESzyH5xeaEpmVftEJSR3B1M96qkD9SszQaUwKfq` | Series #42 quoted at 25.00 bUSD mid |
| Buy | `pool_buy` | `28TpGYdim7jkxTBmhuvUhNAdWPJWipM1uTA6BC9GnceT` | Ticket #2 bought from pool, worst-case reserved |
| Close | `pool_close` | `A8dqwtNywcFj2beePiAeodVvQ7DocxQGd1dCDNaG1ynw` | Ticket #2 closed early for 24.75 bUSD |
| Buy Held | `pool_buy_held` | `6Z1sB27dd4JEeQYPiGgKR9zUXMVfDaGiP9x7FmDyxE1G` | Ticket #3 bought with Hold toggle |
| Expiry | *auto-fix* | committee consensus | Operator fixed series using `kraken`, `okx`, `venue-index` |
| Settle | `settle_ticket` | `5cDEQh4AZsH5iwNrbCshU2xVH3s3eu4PfvFd72MsvkSm` | Ticket #3 settled: 50.00 bUSD credited to buyer |
| Final Withdraw | `withdraw` | `DojCccppFqZ32ENpuDMBEcDwZLZgfQF6sRDqS8ZZgKCe` | Remaining balance withdrawn |
| Verification | `custody` | on-chain assertion | Custody conserved: held = expected = 100,425.375 bUSD |

The machine-readable evidence is saved in `data/testnet-lifecycle.json`.

## Production gates remaining for Mainnet

1. **Independent oracle operators:** the 4 committee seats run as separate processes with
   isolated keys, but currently reside on the operator's machine. Production requires
   geographically distributed, independently run oracle nodes.
2. **Third-party security audit:** formal smart contract security review before handling
   real-money collateral.
3. **Real stablecoin integration:** replace `mock_ft` with genuine USDC / USDT NEP-141 tokens.
4. **Public hosting:** deploying the gateway container to a cloud host (Fly.io / Render) with
   SSL and DNS.
