# Testing a financial dapp

This venue moves money. "It compiles and the happy path works" is not a bar; the failure
mode is an arithmetic path nobody exercised, not a syntax error. The suite is therefore
layered by *what each layer can prove*, and every layer runs in the same command that
gates a change:

```bash
bash scripts/test.sh          # Rust + sandbox + TypeScript, 330 tests, ~3m30
npm run e2e                   # the happy path in Chrome against the live venue
npm run e2e:suite             # the edges, attacks and reconciliation, also Chrome
```

The browser suites need a running venue (`scripts/venue.sh`), because they sign real
transactions against the local sandbox. They are not mocked: a green browser run is a
green chain run.

## The layers

| # | Layer | Where | What it proves | What it cannot prove |
|---|---|---|---|---|
| 1 | examples | `core/src/*`, `contracts/*/src/lib.rs`, `api/test/*` | a named case behaves as documented | that the rule holds for a size nobody typed |
| 2 | properties | [`core/tests/properties.rs`](../near-mvp/core/tests/properties.rs) | the arithmetic rules hold over thousands of deterministic inputs: fees split exactly, payoffs stay inside reservations, shares cannot over-redeem, overflow is refused | that a sequence of operations keeps the books straight |
| 3 | stateful | `the_books_balance_through_a_random_multi_user_session` in the contract | after **every** operation of a random 220-step session (pool buys, held buys, pool closes, offers, bids, closes, settlements, a void, LP exits and sweeps), custody equals the tokens issued and every bucket reconciles | that the oracle's external inputs are honest |
| 4 | adversarial | contract and oracle unit tests | authorization, replay, stale quotes, double settlement, void/fix exclusivity, zero/overflow orders, FOK atomicity, reserved takers, held exits | that a clever caller finds a path we did not enumerate |
| 5 | cross-language | [`core/tests/vectors.rs`](../near-mvp/core/tests/vectors.rs) → [`api/test/vectors.test.ts`](../near-mvp/api/test/vectors.test.ts) | the order the browser plans is fundable against numbers Rust produced, and never prices a ticket above its own payoff | that the screen displays those numbers correctly |
| 6 | browser | [`sim/e2e.mts`](../near-mvp/sim/e2e.mts), [`sim/suite.mts`](../near-mvp/sim/suite.mts) | the real screen, real gateway and real sandbox chain agree: hold, close, rest/cancel, refusals, origin checks, custody, index, accessibility | concurrency, a public network, or browsers other than Chrome |
| 7 | soak / load | not yet | — | — |

Layer 3 is the one that catches the class of bug examples miss: a path that is correct
alone and wrong once another operation follows it. Layer 5 exists because the planner is
TypeScript and the money is Rust; a plan that is arithmetically wrong on the page is a
reverted transaction, and a reverted transaction is a user who thinks the venue is broken.

## What this pass found

The tests were written to attack the system, and they found it. In severity order:

1. **Critical — a ticket could be written that the vault could not settle.** `reserved`
   was tracked net of the premium (`max_payout − premium`), and `can_write` compared that
   against `equity + premium`: the premium was counted twice. A 100-premium / 300-worst-case
   ticket on 100 of equity passed the check, leaving the vault holding 200 against a 300
   payoff. At expiry `settle_ticket` would panic: a position that cannot be settled.
   The reservation is now **gross** (`Σ max_payout ≤ equity`), so the invariant means what
   it says and the LP withdrawal guard cannot let the premium a payout needs walk out.
   Found by: `a_write_must_fit_the_equity_it_has_not_the_premium_it_is_about_to_collect`,
   then the randomized lifecycle test.
   Consequence: capacity is honestly tighter — two 10-worst-case/3-premium tickets now
   need 14 of equity, not 10 — and the tests that encoded the old capacity were corrected.

2. **Major — a multi-contract hold was funded for one contract.** The planner sent
   `mid + 1%` as the budget for a ticket whose premium is `mid × contracts`. One contract
   worked, two reverted with *premium above the budget*. Fixed in `planBuy` and pinned by
   `every planned hold covers the mid the contract charges and stays under the payoff`,
   which runs the planner over 36 Rust-generated vectors.

3. **Major — "Buy & hold" could silently become a book fill.** When a resting offer was
   cheaper than the vault, the planner took the book even with Hold on. That is a different
   trade: the ticket keeps its exit and does not carry the commitment the holder chose.
   The hold path now always takes the vault mid, and says so when the vault has no live
   quote. Found by the browser suite (`multi-contract hold` step).

4. **Medium — a partial market fill was reported as a full one.** A 1,000,000-contract
   market order that filled one resting offer announced *"took 1000000x off the book"*.
   The message now comes from the receipt's `filled_quantity`/`unfilled_quantity`:
   *"took 1 of 3x off the book · 2x left unfilled"*. Found by the browser suite
   (`partial fill` step).

5. **Low, UI — the hold toggle lied to assistive technology.** `aria-pressed` was set for
   Post Only and never for Hold, so the visual switch and its state could disagree. The
   toast was also not a live region and several controls had no label association. Fixed
   in the template; the browser suite now fails on unnamed buttons, unlabelled controls or
   a silent toast.

6. **Critical, and only findable with a real chain — the contract did not pay for its own
   state.** A NEAR contract pays rent per byte of state out of its own balance.
   `bounded_options` had no storage accounting at all: every series, quote, offer, bid and
   ticket it wrote was a permanent liability nobody was billed for. The sandbox hides this
   completely, because the account is deleted along with the process. A testnet account
   simply drains, and then every write fails — including the settlements traders are
   waiting on. Found while writing `scripts/deploy-testnet.sh`, not by a test, which is the
   honest description: the suite could not have found it, because the suite runs on a
   sandbox. `create_series` and the quote paths are now `#[payable]`, overpayment is
   refunded, and `get_storage_state` exposes the tab. See
   [10 · Testnet](10-testnet.md).

The full chain transcript for the reservation change is in the unit and property tests;
the browser evidence is `near-mvp/evidence/suite/report.json` with a trace and
`journey-suite.mp4`.

## What the randomized session actually does

`the_books_balance_through_a_random_multi_user_session` seeds an xorshift, builds four
series and three funded traders plus an LP, then runs 220 operations drawn from: normal
pool buys, held pool buys, pool closes, offers, offer fills, bids, bid fills, cancels,
sales into a bid, LP withdrawals, venue sweeps, and settlement of a random series at a
random price in a range that includes maximum and zero payoff. It refuses to pass unless
it actually reached all eight interesting paths, so a green run cannot be a run of
refusals. After every operation it re-derives:

- `expected_custody == tokens the contract received` (no money created or destroyed);
- `reserved ≤ equity` and `free_equity == equity − reserved`;
- the sum of user balances equals `total_available`;
- every ticket's collateral equals the worst case for its series and quantity;
- a held ticket has `venue_cut == 0` and a person ticket has `venue_cut == 0`, never a fee
  from the wrong path;
- the vault's open-ticket count and refundable margin equal the tickets that are open;
- offer collateral and bid escrow total exactly what the book says;
- pending withdrawals are zero, because this run never asks the token contract for money.

At the end every remaining ticket settles (the last series through the void path), the
venue sweeps its whole accrual, and the books still balance.

## What is still not tested

Being explicit is part of a test report:

- **Concurrency and load.** The sandbox harness is single-threaded, and the browser suites
  are sequential. There is no test that 200 accounts race the same series or that the
  gateway survives a burst. The contract's per-account debit and whole-offer matching make
  the obvious races safe by construction, but that is an argument, not a measurement.
- **A public network.** Everything here is the local sandbox. Deployment is deliberately
  gated; no test creates a testnet account or signs against a public chain.
- **Oracle upstreams.** Signature verification and quorum are tested against fabricated
  seats. The live seats' HTTP feeds are exercised by the venue, and Pyth's keyless mirror
  is allowed to abstain when stale, but no test holds Kraken/OKX/Pyth to a contract.
- **Browser coverage.** Chrome only. The phone check is a viewport measurement, not a
  gesture test on a real device.
- **Accessibility depth.** Names and the live region are asserted; contrast, full keyboard
  traversal and screen-reader output are not.
- **Fuzzing the wire format.** The gateway's JSON body parsing is tested against named
  malformed inputs, not fuzzed. The contract's Borsh inputs are typed by the SDK.

These are the next tests worth writing, not claims that the system is finished.
