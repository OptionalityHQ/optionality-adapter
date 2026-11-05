# 11 · Private Copy Trading Subscription & Expiry Chart

## Confirmed product direction (2026-11-05)

The feature is named **Private Copy Trading Subscription**. Full confidential trading comes first, followed by subscriber-only trade sharing. Subscriptions must be paid, private, on-chain, and autonomous after explicit user authorization. The user also explicitly chose shielded funding: public deposits/withdrawals into an otherwise private ledger are insufficient.

The existing options contracts are public NEAR contracts. Transaction signers, ticket buyer/maker IDs, and trade events expose wallet linkage. Encrypting a journal or omitting addresses from the app does not conceal those records. To achieve true privacy, Optionality introduces an attested confidential execution layer and shielded funding pipeline alongside the public exchange.

---

## Verified Integration Dependencies

### 1. Intents and Shielded Funding Preflight

Official documentation reviewed on 2026-11-05:
- [Confidential swaps](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps): describes confidential transfers and swaps, including embedded confidential balances.
- [Confidential Intents architecture](https://docs.near-intents.org/integration/market-makers/confidential-intents): FAR is a permissioned NEAR fork with private RPC.
- [Transaction history](https://docs.near-intents.org/api-reference/account/get-transaction-history): private history requires an invite-only session.

Organizer guidance confirmed on 2026-11-05: FAR is not a mandatory hackathon dependency and no direct grants are available through that contact; the privacy track directs teams toward TEEs and NEAR AI Cloud.

We conducted live preflight dry quoting using the official Defuse Intents SDK (`@defuse-protocol/intents-sdk`) and the local Distribution Channel key (`NEAR_INTENTS_API_KEY` stored in `near-mvp/.env`, mode 0600):

| Origin | Destination Asset | Recipient Channel | Requested Privacy | Live Result |
|---|---|---|---|---|
| Ethereum USDC | Arbitrum USDC | `DESTINATION_CHAIN` | public | HTTP 201; economic signature valid |
| Ethereum USDC | Arbitrum USDC | `DESTINATION_CHAIN` | advanced | HTTP 201; economic signature valid |
| Ethereum USDC | Arbitrum USDC | `INTENTS` | advanced | HTTP 201; economic signature valid; production adapter accepted |

The successful `INTENTS` destination provides an unlinked channel for funding a shared Intents balance with a bridged asset, avoiding direct public-chain wallet correlation.

`api/src/confidential-intents.ts` provides a server-only dry preview adapter enforcing `confidentiality: advanced` and `dry: true`. It cryptographically validates SDK signatures and never falls back to public mode. Tested by 8 regression suites in `api/test/confidential-intents.test.ts`.

---

### 2. OutLayer TEE Capability Probe & On-Chain Hardware Attestation

The official hackathon privacy track links [OutLayer](https://app.outlayer.ai), which executes WebAssembly components inside Intel SGX / TDX Trusted Execution Environments (TEEs) verified by smart contracts on NEAR testnet (`outlayer.testnet`).

We implemented, built, published, executed, and verified a confidential worker capability probe:

1. **WASI Component (`tools/confidential-worker`):**
   - Built with `--target wasm32-wasip2`.
   - Embeds manifest declaring sealed storage (`outlayer::storage::sealed`) and hardware-derived keys (`encryption_keys`, `signing_keys`).
   - Executes encryption/decryption round-trip with Associated Authenticated Data (`AAD`).
   - Modifies sealed storage atomically via compare-and-swap (`set_if_equals`).
   - Signs the execution digest with an enclave-attested Ed25519 signing key.

2. **Published to FastFS:**
   - Wasm hash: `0ff283fb61333a1adacc99e23147426287a5195b82667a93c3b1020e62f45c3c`
   - URL: `https://test.fastfs.io/sable-knee.testnet/outlayer.testnet/0ff283fb61333a1adacc99e23147426287a5195b82667a93c3b1020e62f45c3c.wasm`
   - Publish transaction on NEAR: [`EPYAsZFnDcL7ahz1qReTMmkTt2RgmjceraomfmzCqx54`](https://testnet.nearblocks.io/txns/EPYAsZFnDcL7ahz1qReTMmkTt2RgmjceraomfmzCqx54)

3. **Executed on Testnet Enclave:**
   - Execution transaction: [`6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1`](https://testnet.nearblocks.io/txns/6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1)
   - Task ID: `20887`
   - Sealed storage verified (`counter: 1`)
   - Attested public key: `a24145b9cc1bcb5a6bdf9eb5db77c550f1542792347a4d392358cc7dd1a9df98`

4. **Hardware Attestation Verification:**
   - Retrieved full cryptographic proof bundle via `outlayer-verify tx`.
   - Verified hardware quote against Intel SGX roots with offline bundle validation (`outlayer-verify bundle`).
   - Authenticity, Identity, Binding, Input, and Output verdicts: **PASS**.
   - Verified receipt signature with Node.js crypto using the enclave's attested SPKI public key.
   - Pinned evidence in `data/confidential-probe-receipt.json` and `data/confidential-probe-attestation.json`.

---

## The Private Ledger Engine (`private-ledger`)

A dedicated Rust crate (`near-mvp/private-ledger`) implements the state machine for private copy trading and subscriptions. It reuses the exact bounded option math from `bounded-core` without exposing public-chain ledger state.

### Architecture and Security Invariants

- **Pseudonymous Command Identities:** Ed25519 public keys represent users. No account IDs or wallet strings are stored.
- **Domain & Replay Binding:** All user commands bind network ID, vault address, command sequence nonce, and expiry deadline. Replayed commands are rejected.
- **Atomic Subscriptions:** Subscribers pay subscription fees to strategy creators atomically inside the private ledger. Paying creator and activating the entitlement happen in one indivisible state transition.
- **Selective Trade Publishing:** Only trades explicitly designated by the creator enter the subscriber journal. Unshared private trades remain completely confidential.
- **Signed Copy Mandates:** Followers authorize autonomous trade copying through signed mandates specifying:
  - Allowed underlying assets (e.g. `ETH`, `BTC`)
  - Allowed maximum option expiry horizon
  - Per-order maximum contract size
  - Per-order maximum premium budget
  - Lifetime total premium ceiling
  - Explicit loss floor / stop-loss haircut percentage
- **Atomic Multi-Follower Execution:** When a leader executes a trade, all active subscribers with matching mandates are copied in the *same* state transition. This eliminates front-running and guarantees no duplicate orders on replay.
- **Automated Exit Following:** When a leader closes early, active followers automatically copy the exit, subject to their signed loss-floor limits.
- **Snapshot Commitments:** The ledger serializes only through an authenticated sealing callback. Snapshot state is committed via a salted Merkle root; older or tampered snapshots are refused when verifying against the latest finalized root.

Tested by **18 exhaustive integration tests** in `near-mvp/private-ledger/tests/ledger.rs`.

---

## Confidential Transport Protocol (`confidential-protocol`)

To prevent metadata leakage between clients and the TEE enclave, `near-mvp/confidential-protocol` provides an encrypted request/response envelope:

- **Ephemeral Key Agreement:** X25519 key exchange with ChaCha20-Poly1305 AEAD encryption.
- **Constant-Size Padding:** Commands and journal records are padded to fixed block sizes (256 B, 1 KB, 4 KB), concealing trade sizes and position counts from passive traffic analysis.
- **Enclave Attestation Binding:** Responses are encrypted to the client's single-use reply key and signed by the enclave's attested key, proving the answer came from genuine hardware.

Tested by **4 transport tests** in `near-mvp/confidential-protocol/tests/transport.rs`.

---

## Visual Positions & Expiry Timeline Chart

The trading terminal includes a native, institutional-grade visual timeline chart (`near-mvp/api/src/positions-chart.ts` and `near-mvp/api/src/chart-model.ts`):

```
       Underlying Price ($)
          ▲
  $2,500 ─┤                    ┌─────────┐ (Call wall: $2,400–$2,500)
          │                    │  CALL   │ (Green)
  $2,400 ─┼────────────────────┴─────────┴───────────────
          │            ╭───────╮ (Observed spot line)
  $2,360 ─┼────────────╯       ╰─────────────────────────
          │       ┌─────────┐ (Put wall: $2,250–$2,350)
  $2,250 ─┼───────┤   PUT   │ (Red)
          │       └─────────┘
          └───────┬─────────┬─────────┬─────────┬─────────►
                Today     +1 Day    +2 Days   +7 Days    Time
```

### Chart Features

1. **Timeline Coordinate System:**
   - **X-Axis:** Continuous chronological timeline spanning past observed session history and future expiry horizons (switchable 24-hour and 7-day views).
   - **Y-Axis:** Linear price scale centered dynamically on current index spot.
2. **Expiry Spread Walls:**
   - Listed spreads are rendered as vertical bounding rectangles between their `low_strike` and `high_strike`.
   - Color-coded: **Green for Call spreads**, **Red for Put spreads**.
3. **Historic Price Trajectory:**
   - Real-time SVG polyline plotting actual observed prices from the pricing engine's multi-exchange median. Future prices are never invented.
4. **Position Tracking & Moneyness:**
   - Striped badges locate user's open positions directly on the chart.
   - Computes real-time intrinsic value, moneyness status (`ITM` / `OTM`), and countdown to expiry.
5. **Interactive Click-to-Trade:**
   - Clicking any expiry wall opens an order dialog pre-populated with the spread's terms.
   - Calls the gateway's `/chart-quote` to fetch live pool entry premiums.
   - Integrates with the browser wallet selector (`window.optionalityWallet.submit`), submitting the transaction for direct signing in MyNearWallet.

Tested by unit tests in `api/test/chart.test.ts` and bundled into `demo/positions-chart.js` via `node sim/build-demo.mjs`.

---

## Verification & Status Summary

| Component | Status | Proof / Evidence |
|---|---|---|
| Positions Expiry Chart | Built & Integrated | `demo/positions-chart.js`, `api/test/chart.test.ts`, live in `demo/index.html` |
| Shielded Funding Preflight | Verified | `api/src/confidential-intents.ts`, 8 tests in `confidential-intents.test.ts`, provider-signed dry quote fixture |
| TEE Hardware Attestation | Verified On-Chain | `tools/confidential-worker`, FastFS wasm, tx `6atRSizseGRViNshcrYipt3oBmi8uwetYxZRxAgoHNc1`, `data/confidential-probe-attestation.json` |
| Private Copy Trading Ledger | Built & Tested | `near-mvp/private-ledger`, 18 tests in `tests/ledger.rs` |
| Padded Transport Protocol | Built & Tested | `near-mvp/confidential-protocol`, 4 tests in `tests/transport.rs` |
| Full Test Suite | All Passing | **372 tests** across Rust and TypeScript (`bash scripts/test.sh`) |
