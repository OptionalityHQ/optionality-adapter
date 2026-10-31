# Changelog

Newest first. Dates are the days the work landed, not release dates — this is a prototype
that has never been deployed.

## 2026-10-31

**Added**

- Playwright end-to-end (`near-mvp/sim/e2e.mts`, `scripts/e2e.sh`): the real screen in the
  machine's own Chrome, with actionability checks, console/network error capture, a phone
  width measurement, screenshots, a replayable trace and **a video of each journey**
  (`journey-fast.mp4`, `journey-settle.mp4`).
- A seeded taker, so the tape and the charts move without a visitor clicking.
- A demo top-up (`POST /demo/reset`, the header button) and `docs/demo-script.md`.
- Gateway API reference (`docs/06`) and a runbook (`docs/07`).

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
