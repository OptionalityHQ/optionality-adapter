# Docs

Two kinds, kept apart on purpose.

## Ours — what this project builds and proves

## How the pieces relate

```mermaid
flowchart TB
  subgraph docs["The docs"]
    D1["1 · Hackathon MVP<br/><i>what and why</i>"]
    D2["2 · On-chain integration<br/><i>the chain path</i>"]
    D3["3 · Loser consolation<br/><i>the lottery, and why</i>"]
    D4["4 · Player-vs-Pool<br/><i>the architecture</i>"]
    D5["5 · Red team<br/><i>what broke, and the fix</i>"]
    D6["6 · Gateway API<br/><i>the routes</i>"]
    D7["7 · Runbook<br/><i>boot, health, failure modes</i>"]
  end
  D1 --> D4
  D1 --> D3
  D4 --> D2
  D2 --> D5
  D2 --> D6
  D6 --> D7
  D4 -.->|"claims"| D5
```

Read 1 for the product, 4 for how it is built, 2 and 6 for what executes and how the
screen asks for it, 7 for how to run it, 5 for what has already gone wrong. Reference material lives under `reference/` and is never mixed
into ours — it is other people's systems, studied rather than adopted.

Decision records, the agent workflow and the Vietnamese drafts live in an `internal/`
folder that is deliberately not committed; anything worth publishing is rewritten into
these docs rather than moved.


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
