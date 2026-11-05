# Changelog

Newest first. Dates are the days the work landed, not release dates — this is a prototype
that has never been deployed.

## 2026-11-05

**Private Copy Trading & Expiry Chart**

- **Visual Positions & Expiry Timeline Chart (`/chart`):** Added a native continuous timeline canvas
  to the trading terminal. Maps time on the horizontal axis and underlying asset price on the
  vertical axis. Renders listed option spreads as color-coded expiry walls (green for Call spreads,
  red for Put spreads) spanning spread strike boundaries. Tracks user position badges with real-time
  moneyness (`ITM`/`OTM`), intrinsic value calculations, and time-to-expiry countdowns.
- **Interactive Click-to-Trade from Chart:** Clicking any expiry wall opens an order dialog, queries
  the contract for live pool quotes via `GET /chart-quote`, and generates unsigned FunctionCall transactions
  via `POST /plan` for direct one-click execution in MyNearWallet.
- **Hardware-Attested TEE Capability Probe (OutLayer):** Built and deployed a WebAssembly component
  (`tools/confidential-worker`) to FastFS ([`wasm hash 0ff283...`](https://test.fastfs.io/sable-knee.testnet/outlayer.testnet/0ff283fb61333a1adacc99e23147426287a5195b82667a93c3b1020e62f45c3c.wasm)),
  executed on NEAR testnet ([`tx 6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1`](https://testnet.nearblocks.io/txns/6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1)),
  and cryptographically verified hardware attestation proofs against Intel SGX roots (`outlayer-verify`).
- **Private Copy Trading Ledger Engine (`near-mvp/private-ledger`):** Implemented an isolated,
  high-performance private state machine (18 tests) for confidential options trading, atomic
  subscription payments, private trade journals, signed follower copy mandates with enforced loss floors,
  and replay-protected snapshot commitments against finalized roots.
- **Padded Transport Protocol (`near-mvp/confidential-protocol`):** Implemented constant-size
  encrypted request/reply transport (4 tests) with ChaCha20-Poly1305 and X25519 key exchange to
  eliminate side-channel packet length analysis.
- **Shielded Funding Preflight (Defuse Intents SDK):** Verified server-only advanced confidential
  dry quoting for shared Intents balances using `@defuse-protocol/intents-sdk`, ensuring clean
  separation between public wallet addresses and private trading balances.
- **Documentation Suite Expansion:** Published [`docs/11-private-copy-trading-and-chart.md`](docs/11-private-copy-trading-and-chart.md)
  and updated [`docs/12-launch-post.md`](docs/12-launch-post.md).

**Testing**

- **372 automated tests, all passing** (`bash scripts/test.sh`): 280 Rust tests (unit, proptest,
  integration, stateful fuzzing, and private ledger) + 92 TypeScript tests.

## 2026-11-04

**Live Public Testnet Deployment**

- **Deployed on NEAR Testnet:** Deployed full protocol to NEAR testnet under `sable-knee.testnet`
  ([`options.sable-knee.testnet`](https://testnet.nearblocks.io/address/options.sable-knee.testnet),
  [`token.sable-knee.testnet`](https://testnet.nearblocks.io/address/token.sable-knee.testnet),
  [`oracle.sable-knee.testnet`](https://testnet.nearblocks.io/address/oracle.sable-knee.testnet)).
- **Browser wallet signing (NEAR Wallet Selector):** Integrated `@near-wallet-selector/core` and
  `my-near-wallet`. In testnet mode, user trades are routed through `POST /plan` to generate unsigned
  NEAR transaction envelopes, signed directly in MyNearWallet with zero gateway custody.
- **Test collateral faucet (`POST /faucet`):** Automatically registers account storage and mints 1,000
  test bUSD. Protected by IP rate limiting and a persistent daily journal (`FaucetLedger`) enforcing
  a limit of 1 claim per account per UTC day and 100 daily claims.
- **Durable oracle committee:** Key material for the 4 committee seats (`venue-index`, `kraken`, `okx`,
  `pyth`) is persisted with `0600` permissions (`--key-file`), surviving process restarts. The testnet
  operator verifies that local keys match registered on-chain oracle sources before quoting.
- **Testnet operator daemon (`scripts/testnet.sh`):** Connects to deployed testnet contracts,
  discovers ladder gaps, batches quotes with rent deposits, streams signed oracle ticks, and
  automatically fixes expired series and settles tickets.
- **Verified on-chain lifecycle (`scripts/testnet-smoke.mjs`):** Executed a complete live testnet lifecycle
  (faucet mint, deposit, withdraw, series creation, quotes, pool buy, early close, held buy, automated
  expiry fixing, ticket settlement, final withdrawal, custody verification) with receipts recorded in
  `data/testnet-lifecycle.json`.
- **Launch announcement document:** Published [`docs/12-launch-post.md`](docs/12-launch-post.md).

**Fixed**

- **The options contract now pays its own rent.** A NEAR contract is billed per byte of state out
  of its own balance, and `bounded_options` had no storage accounting: every series, quote,
  offer, bid and ticket it wrote was a liability nobody was charged for. A sandbox deletes
  the account with the process, so the suite could not have caught this; a testnet account
  just drains, and then every write fails, settlements included. `create_series`,
  `set_pool_quote` and `set_pool_quotes` are now `#[payable]` and charge for the state they
  add — quotes only when the cell is new, because charging for a refresh taxes the venue
  for staying fresh. Overpayment is refunded, anyone may `storage_deposit()` to top the
  account up (a donation with a receipt: no shares, no claim), and `get_storage_state()`
  reports the tab. Five unit tests pin the behaviour.
- **The mock token now pays its own rent.** `mock-ft` previously accepted 1 yoctoNEAR for
  `storage_deposit`, underfunding storage by 100% and draining the contract account on every
  visitor registration. Fixed to price `ACCOUNT_STORAGE_BYTES = 128` with exact rent collection
  and surplus refund. Four unit tests added.

**Testing**

- **340 automated tests, all passing** (`bash scripts/test.sh`): 258 Rust unit, property and integration
  tests + 82 TypeScript tests. Plus automated public testnet smoke test.

**Testing**

- Storage-rent suites in the options contract: an unfunded series write is refused, exact
  rent is enough, a re-quote costs nothing, the tab is internally consistent, a stranger's
  deposit is receipted, and an overpaid series refunds the remainder. **330 tests**.

- **A financial test programme, not more examples.** Property tests over the money math
  (`core/tests/properties.rs`: exact fee splits, bounded payoffs, overflow edges), a
  220-step randomized multi-user contract session that re-derives the whole balance sheet
  after every operation, adversarial lifecycle tests (double settlement, void/fix
  exclusivity, zero/overflow orders, the admin/venue matrix, reserved takers), Rust→TypeScript
  trade vectors that make the planner spend against numbers Rust produced, and an adversarial
  Chrome suite (`sim/suite.mts`) covering holds, refusals, origin attacks, partial fills,
  custody and accessibility. **330 tests**, `docs/08-testing.md` says what each layer proves
  and what it does not.

**Fixed**

- **A vault could write a ticket it could not settle.** `reserved` was net of the premium
  while `can_write` compared it against `equity + premium`: the premium was counted twice,
  so a 100-premium / 300-worst-case ticket fitted on 100 of equity and then failed to settle.
  The reservation is now the whole worst case (`Σ max_payout ≤ equity`); LP withdrawals can
  no longer remove the premium a payout needs. Capacity is honestly tighter.
- **A multi-contract hold was funded for one contract.** The planner sent `mid + 1%` for
  any size, so a two-contract hold reverted with *premium above the budget*.
- **"Buy & hold" could become a book fill.** A cheaper resting offer took precedence over the
  commitment the holder chose; the hold path now always takes the vault mid.
- **A partial market fill was reported as a full one.** The message is now built from the
  receipt's filled and unfilled quantities.
- **The Hold toggle never reflected its state** (`aria-pressed` was only set for Post Only),
  the toast was not a live region, and several controls had no label association.

**Added**

- Playwright end-to-end (`near-mvp/sim/e2e.mts`, `scripts/e2e.sh`): the real screen in the
  machine's own Chrome, with actionability checks, console/network error capture, a phone
  width measurement, screenshots, a replayable trace and **a video of each journey**
  (`journey-fast.mp4`, `journey-settle.mp4`).
- A seeded taker, so the tape and the charts move without a visitor clicking.
- A demo top-up (`POST /demo/reset`, the header button) and `docs/demo-script.md`.
- Gateway API reference (`docs/06`) and a runbook (`docs/07`).

**Added**

- **Hold to expiry, no fee.** A buyer can take the spread at the venue's *mid* with no
  margin at all, in exchange for giving up both exits: the ticket cannot be closed back to
  the pool or sold to a bidder, and settlement is unchanged. Contract-level
  (`pool_buy_held`, a `held` flag on the ticket that both exit paths check), with a
  **Hold to expiry · no fee** toggle on the ticket and a `held` row in the portfolio that
  shows no exit price and no PnL, because there is neither.
- **Fill or kill.** The order-type select now sends `min_quantity`, so a market take
  is all-or-nothing — the contract already enforced it, the screen just never asked.
  Verified live: three contracts against one resting is refused with *minimum quantity
  not filled*; one contract fills.

**Changed**

- **The seeded maker now quotes inside the venue** (20 bps over mid, not 200). Lowering
  the fee to 50 bps made every maker offer worse than the vault's own price, which
  quietly turned the book into decoration; two cells are book-priced again.
- **The fee.** The venue boots at 50 bps over mid to open and 100 under mid to close, set
  with `set_fee_terms` at boot (`MARGIN_BPS`/`IMPACT_BPS`). The prototype charged 400/1000,
  a 13.5% round trip on a 0.10 premium, which was the single number most likely to stop
  somebody trading. The contract's own default stays at 400/1000 so a deployment that
  forgets to set a schedule is loudly expensive rather than quietly cheap.

**Fixed**

- The ask column no longer falls back to the model's price when the vault has no quote; it
  was advertising a price `pool_buy` refuses.
- `distinct_sources`: the venue's two-source floor counted entries, so one source named
  twice satisfied it (red-team finding 9).
- The session history is per asset; it was one series for the whole venue.
- A seat's socket reads a feed at most once a second, so a local loop cannot get a seat
  rate-limited out of the committee.
- IV columns describe the price in the same row (the vault's entry, not the model's ask).

## 2026-10-30

**Added**

- Committee settlement: four independently keyed seats, quorum 2 of 4, provenance stored on
  the series (`settle_sources`, `settle_dispersion_bps`). Fixes red-team finding 8.
- One signer process per seat, each fetching its own source (`observe <feed>`); no request
  signs a caller's number.
- Pyth's own contract on Base read over a public RPC as a seat; freshness judged on the
  price's publish time as well as its delivery.
- Oracle, Smile and Session panels; the vol smile from the engine's own model.
- A seeded maker resting offers near the money.
- A week of markets with per-ladder term structure, batched quoting and deadline-driven
  renewal; the registry read in batches.

**Added**

- **Hold to expiry, no fee.** A buyer can take the spread at the venue's *mid* with no
  margin at all, in exchange for giving up both exits: the ticket cannot be closed back to
  the pool or sold to a bidder, and settlement is unchanged. Contract-level
  (`pool_buy_held`, a `held` flag on the ticket that both exit paths check), with a
  **Hold to expiry · no fee** toggle on the ticket and a `held` row in the portfolio that
  shows no exit price and no PnL, because there is neither.
- **Fill or kill.** The order-type select now sends `min_quantity`, so a market take
  is all-or-nothing — the contract already enforced it, the screen just never asked.
  Verified live: three contracts against one resting is refused with *minimum quantity
  not filled*; one contract fills.

**Changed**

- **The seeded maker now quotes inside the venue** (20 bps over mid, not 200). Lowering
  the fee to 50 bps made every maker offer worse than the vault's own price, which
  quietly turned the book into decoration; two cells are book-priced again.
- **The fee.** The venue boots at 50 bps over mid to open and 100 under mid to close, set
  with `set_fee_terms` at boot (`MARGIN_BPS`/`IMPACT_BPS`). The prototype charged 400/1000,
  a 13.5% round trip on a 0.10 premium, which was the single number most likely to stop
  somebody trading. The contract's own default stays at 400/1000 so a deployment that
  forgets to set a schedule is loudly expensive rather than quietly cheap.

**Fixed**

- The venue died at its own expiry (a fixed schedule now, and `upcoming` filters).
- Held tickets could not be paid (gas for the callback, degraded prints, voiding).
- PnL was marked at a price nobody pays.

## 2026-10-27

**Added**

- The pool as counterparty to every click, with fees inside the entry premium.
- A Rust engine over three exchange sockets; a TypeScript gateway that only projects and
  forwards; a single screen.
- 295 unit and integration tests across contract, engine, oracle, operator and gateway.
