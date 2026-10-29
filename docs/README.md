# Docs

Two kinds, kept apart on purpose.

## Ours — what this project builds and proves

| # | Document | Says |
|---|---|---|
| 1 | [Hackathon MVP](01-hackathon-mvp.md) | the design decision, and what a NEAR-native ticket has to do |
| 2 | [On-chain integration](02-onchain-integration.md) | both lifecycles run against a real chain, with the encoding and gas traps |
| 3 | [Loser consolation](03-loser-consolation.md) | the payout math, and the bound that keeps it unfarmable |
| 4 | [Pool architecture](04-pool-architecture.md) | player-vs-pool: shared Rust crate, four vault buckets, six invariants, phase table |

Start at **4**, then **2**.

## Reference — other people's systems, studied not adopted

| # | Document | What it is |
|---|---|---|
| R1 | [Product and user flows](reference/derive-1-product-and-flows.md) | Derive's screens and order path, read off the live product |
| R2 | [V3 architecture](reference/derive-2-architecture.md) | Derive's sequencer / SP1 / Celestia / Ethereum settlement design |
| R3 | [Contracts and trust boundaries](reference/derive-3-contracts.md) | their deployed contracts, proof checks and escape conditions |
| R4 | [REA order-path trace](reference/derive-4-order-path-rea.md) | their submission path traced from ticket to signed action |
| R5 | [Interface reconstruction](reference/derive-5-ui-reconstruction.md) | their trading screen, measured from captures |

Nothing in `reference/` is our architecture. Read **R2** only to understand what we
chose not to build: NEAR re-executes every transaction, so a prover, a data-availability
layer and a withdrawal outbox have no job here.
