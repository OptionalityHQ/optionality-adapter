# Red-team pass: what attacked the vault, and what closed it

Seven failures were found against the running local venue — the contract directly with a
role key the gateway never uses, the gateway's HTTP surface, and the page in a real
browser. Each was reproduced before it was fixed. Evidence:
[`evidence/security/probes-2026-10-30.txt`](../near-mvp/evidence/security/probes-2026-10-30.txt),
[`near-mvp/evidence/journey/`](../near-mvp/evidence/journey).

## 1. The caller priced the vault — critical, fixed

`pool_buy(series, quantity, mid_units, budget)` and `pool_close(ticket, mid_units)`
took the mid from whoever sent the call, and the vault paid its arithmetic on that
number. Signed as `maker-2` on the live sandbox:

| step | call | result |
| --- | --- | --- |
| buy | `pool_buy(0, 1 contract, mid 2 units, budget 1.00)` | premium **2 units ($0.000002)**, reservation **99,999,998** |
| sell back | `pool_close(ticket, mid 100,000,000)` | paid **90,000,000 ($90.00)** |
| balance | 5,000,000 → 5,000,008.999998 USDT | **+$89.999998 per ticket**, repeatable until the equity was gone |

The loss is the LPs'. The capacity invariant did its job — the vault never owed more
than it held — which is exactly why the invariant was not the protection needed here:
an underpriced *entry* is not a solvency problem, it is a transfer.

Fixed at the contract, and by removing the argument rather than checking it. The
first repair made the caller echo the venue's published price; that holds on a still
market and breaks on a live one, because the echo is stale before the transaction is
signed. The shape that survives is that a taker does not send a price at all:

- `set_pool_quote(series_id, mid_units, stamp_ns)` — venue-signed, positive, on an open
  series, and a stamp more than `MAX_QUOTE_SLACK_NS` (5 s) ahead of the chain clock is
  refused, because a quote that never expires is the same hole wearing a different hat.
- `pool_buy(series_id, quantity, max_total_premium)` — the mid is read from storage.
  There is no field to lie with, and `live_quote` still panics if the series has no
  quote or the quote is older than `MAX_QUOTE_AGE_NS` (60 s).
- `pool_close(ticket_id, min_exit_units)` — pays the vault's own haircut exit. The
  seller's argument is a right to refuse a price, not a price.
- `get_pool_prices(series_ids, quantity)` answers with the contract's `core::fees`
  integers — mid, entry, exit, stamp, age — and drops a series it has no live quote
  for, so the screen and the planner read the number execution will use.
- `pool_sweep` is venue-only too; it used to pay whoever asked.

Live on the sandbox after the fix ([`evidence/security/probes-2026-10-30.txt`](../near-mvp/evidence/security/probes-2026-10-30.txt)):
a `pool_buy` that still sends `mid_units: 1` is filled at the vault's loaded entry, not
for one unit; a close demanding 90.00 for a ticket whose exit is 0.09 reverts and the
ticket stays with its buyer; a stranger calling `set_pool_quote` gets `only the venue`.
Contract tests `the_caller_cannot_price_the_vault`,
`a_taker_gets_the_price_standing_when_the_trade_lands`, `an_expired_quote_is_not_a_price`,
`the_vault_publishes_the_prices_it_will_charge`; the 16 vault tests now run through the
quote path.

**Still open, and it is a design decision, not an oversight:** whoever holds the venue
key sets every price the vault trades at. That is what "the venue is the market maker"
means on-chain. Before real money is in the vault it needs a key in a KMS or a
multi-sig, and a band test — a quote more than x% from the last oracle print should be
refused — so a stolen venue key can price the vault at nothing but cannot do it quietly.

## 2. A listing name was a document, not a ticker — fixed

`create_series` stored any string as `underlying` and `oracle_feed`, and both reached
the page, the explorer and the log lines. `"<img src=x onerror=alert(1)>"` as a series
name was accepted and rendered. The contract now requires a tag: non-empty, at most 32
characters, `[A-Za-z0-9._-]` — and it refuses markup before it can be echoed anywhere,
which beats escaping it in one viewer. Test `a_series_name_is_a_tag_and_not_a_document`;
probe [`scripts/probe-xss.mjs`](../near-mvp/scripts/probe-xss.mjs).

## 3. The gateway signed for whoever asked — fixed

`/action` signs with sandbox keys, so an unrelated page on the machine — or a DNS
rebinding of one — asking it to buy was a real path. It now answers 403 unless the
`Host` is loopback and the `Origin`, if present, is the same loopback origin
(`rejectSigning`). Live: `origin http://evil.example is not this venue`, and with the
host rewritten `this venue answers only on loopback, not evil.example`. The page's own
font route takes one flat path segment with no traversal.

## 4. The price the trader saw was not the price the vault charged — fixed

Closing the first hole moved a UX failure into the open, and the journey found it: the
ladder showed the engine's model ask while the contract charged the venue's published
entry — two numbers for one cell, and roughly one click in two came back
`the ask moved to 1.7010 · your limit was 1.5000`. Correct, and unusable.

- The ask column is now the **vault's** price whenever the vault is the maker; the
  model's spread only stands where nothing is quoted, and it is labelled as a mark.
- A market buy's budget is the contract's own total for the clicked quantity
  (`get_pool_prices`, not a per-contract multiplication), with a 1% tolerance: inside
  it the order fills at the venue's price, outside it the click was never an agreement
  to this price and the plan says so in those words.
- A cell the venue has not quoted says `No price published at ETH C2275 · the vault is
  not selling it` with the button disabled — not a `Buy $0.00`.
- A ticket held against the vault closes with `Close @ price` because there is no floor
  to promise; into a resting bidder it stays `Close ≥ price`, which is what
  `close_ticket` enforces.
- The gateway no longer defaults a market to "today" — the day rolls at 00:00 UTC and
  the page would then show a grid that had already run off while tonight's live one sat
  outside the filter. It asks the engine which expiry it is pricing.

Journey after the fixes: cold open → click a live price → ticket opens at the price
shown → portfolio → one-click close → the realised number is the one the row was already
printing. **0 blockers**, 1 known rough edge (the "No wallet · simulated" chip, which is
the MVP's honest state).

## 5. The unrealised PnL was marked at a price nobody pays — fixed

The journey bought a spread for $0.0601 and the portfolio called it +$0.0168. The click
then realised −$0.0081. The row's Mark column was the engine's model mid, and the mid is
not a price anyone will pay for that ticket: the vault buys its own back at its published
exit, and a ticket a person made is worth the best resting bid. Same class of failure as
section 1 and 4 — the screen pricing with a number the chain never agreed to — this time
in a column nobody was auditing. The button had its own version: `Close ≥ —`, a promise of
a floor that was sent as no floor at all.

- Unrealised is now `close pays − cost`, off the same chain number the close button names,
  so a fresh ticket shows its fee the moment it opens instead of an invented profit.
- A vault ticket takes the vault's `exit_units`; a person's ticket takes the best bid, read
  for the held series as well as the listed ones. Neither exists → no button, and the row
  says which is missing (`the venue has no price to buy it back at`,
  `no bidder has priced this ticket`).
- The model mid stays in its own column, labelled as a mark.

Journey after: buy at $0.658 → row reads −$0.0886 → close reads −$0.0886. 4% margin plus
10% haircut, shown before the click rather than found after it.

## 6. The venue ended when its own expiry passed — fixed

The engine worked out its ladder's expiry once, at process start, and never looked at
the clock again. The chain's series expired with it, `create_series` refuses a past
expiry so the operator had nothing left to list, and an hour after `venue.sh start` the
screen was a grid of dashes under a live index. No suite caught it because every test
runs inside one expiry.

- The venue now lists a **schedule** rather than a single ladder: two expiries inside the
  day and a daily close out to a week, five of the seven inside three days. The nearest
  one no longer has to roll for the venue to keep working — the others are already there.
  A ladder past its expiry drops out of `/health`, so the operator stops listing it and
  the screen stops defaulting to it.
- The operator lists every ladder in the schedule as soon as one is missing from the
  chain (`ladder_is_listed`) instead of waiting for its own minute cadence, and renews
  each ladder against its **own** quote deadline — sixty seconds for a market inside the
  day, three hundred for one a week out — rather than walking a fixed rotation that left
  the near ladders unquoted for minutes at a time.
- The gateway resolves the expiry *before* reading the engine, so a ladder days out shows
  its own marks and its own greeks; while a new ladder is being listed it falls back to
  the nearest one the chain holds, so the screen never shows marks with no counterparty.
- The trade path deliberately does **not** fall back. A click named an expiry; planning
  it against another ladder was a fill at a price the trader never saw, and the strict
  registry is what turned that into a refusal.

Verified on a three-minute tenor (`EXPIRY_HOURS=0.05 scripts/venue.sh`): five rolls in
six minutes, each one listed and re-quoted within an operator pass, the vault-priced
cell count returning to nine every time.

## 7. A held ticket could never be paid — fixed

Holding a spread to expiry was the one lifecycle step the browser had never taken. It
took three found bugs to make it work, and each was invisible from the page:

- `request_settlement` chains an oracle query and a callback, so it needs the gas for
  both. The operator sent a flat 30 Tgas and every call reverted with *Exceeded the
  prepaid gas* — while `into_result()` still reported success, so the log said
  `fixed 74 series` on chain state where nothing had moved.
- The engine emitted a print only from a `live` index, and `live` needs the venues inside
  20 bps of each other. On a 25 bps minute there was no print at all, so no series inside
  its window could be fixed — even though the chain's own floor (30% confidence) would
  have accepted the 95%-confidence number. Quotability is the venue's appetite for making
  markets; settleability is the chain's rule about the print, and they are now separate:
  one source or a stale one still produces nothing, two disagreeing venues produce a print
  whose confidence carries the disagreement.
- A series whose window closed unfixed had no exit. It cannot be fixed afterwards and
  `settle_ticket` refuses it, so every ticket in it stayed open for the life of the
  contract. The operator now voids it at the deadline (permissionless, on chain), and the
  screen's Settle button pays either route — the print for a fixed series, the refund for
  a void.

Verified in the browser on a three-minute tenor: buy → hold to expiry → the row swaps
Close for **Settle · up to $100.00** → `settled 1 ticket(s)` → realised −$1.79 → +$0.391,
cash +$11.29, and the history row reads `the print`, not a pool sale that never happened.

## 8. The venue settled on its own print — fixed

The contract asked an oracle for a price and paid the ticket on what came back. That
oracle was a second contract with one `reporter` account, and the reporter was the same
process that reads the exchange sockets and quotes the vault. Whoever held that key
decided, alone, which holder got paid: a bug in the operator, a compromised host, or a
swapped session file all looked exactly like a normal settlement on chain. The engine's
`live`/`degraded` rules protected the *number*, and nothing protected the *authority*.

- Sources are **seats**, not accounts. Each registers an ed25519 key and signs every
  observation — feed, source, price, stamp, confidence. The byte layout lives in
  `bounded_core::oracle`, imported by both the contract and the relay, so the two cannot
  drift into a world where every signature is simply refused. The relay delivers prices;
  it cannot speak for a seat it does not hold the key for.
- An observation is a candidate. It becomes a **fix** only when a quorum of distinct fresh
  seats agree inside a tolerance band: the fix is the median of the *agreeing* subset, so
  one lagging venue excludes itself instead of vetoing the market. A fix carries its
  dispersion, the confidence derived from it, and the names of who signed.
- The venue keeps its own floor and does not delegate it. `usable_fix` refuses a price
  outside the series' band, stamped outside its own accept window, under
  `min_confidence_bps` — **or named by fewer than two sources**. A friendly oracle that
  hands over one signature gets one answer: the series stays open and voids at the
  deadline, refunding the premium.
- `settle_sources` and `settle_dispersion_bps` are stored on the series, so a ticket that
  paid out says who priced it — from the chain, years later — and the screen shows it in
  the Oracle panel and on the settled row.
- The running venue seats four sources: its own three-venue index, Kraken, OKX and
  CoinGecko. Three of them are not us. Stopping the engine removes one vote and the
  committee still fixes; it also no longer takes the screen down, because `/state` falls
  back to the cells the chain lists when the model is unreachable.

Tests: `one_source_alone_is_never_a_fix`, `a_signature_from_another_seat_does_not_count`,
`a_lagging_seat_cannot_veto_the_committee`, `a_stale_seat_stops_counting`,
`removing_a_seat_ends_its_vote_but_not_its_record` in the oracle's 17; and in the sandbox,
`one_source_alone_cannot_settle_a_ticket`,
`a_committee_that_barely_agrees_cannot_meet_a_confident_series` and
`a_fix_outside_the_series_band_is_still_not_a_price`, while
`full_lifecycle_settles_and_pays_out` now proves the payout happens with the venue's own
seat saying nothing.

What is *not* claimed: the four keys are generated per boot and held by one process on one
machine. Three of the prices come from operators we do not run, which is the point, but the
transport is still ours and a seat's key is not rotated or stored in an HSM. The next
increment is a real adapter — an on-chain aggregator read over a public RPC, which this
machine can already reach (`arb1.arbitrum.io/rpc` answers `eth_call`; Pyth's Hermes now
requires an API key) — and a second relay on a second host.

## 9. Not exploited, and why

| surface | status |
| --- | --- |
| Double `settle_ticket`, settle after void, self-crossing, taking your own offer | covered by the contract's own tests, all still green |
| Low-confidence or stale oracle print fixing a series | refused on chain: `min_confidence_bps` per series, and the accept window closes |
| An LP leaving in front of the worst case the vault is holding | `pool_withdraw` requires free equity afterwards; test `an_lp_cannot_leave_in_front_of_the_worst_case_the_pool_is_holding` |
| A reserve larger than the equity | the capacity invariant: `pool full: this worst case does not fit the equity left` |
| A ticket priced above its own maximum payout | not openable, on chain and in the ladder |
| A quote that lags the index it was stamped for | accepted, and now shown: the vault trades at the mid it published for up to `MAX_QUOTE_AGE_NS` (60 s) while the operator re-posts every 10 s, and the ticket panel prints `venue quote Ns old`. Measured on a running index: a spread bought at $6.28 was marked at $2.34 minutes later when the index ran away from the standing quote. That is the price of being the only counterparty, and shortening it is a cadence decision, not a code gap. |
| `/stream` and `/state` reads | no signing, no secrets; a caller can only ask for what the chain already holds |
| Body size on `/action` | unbounded, and left that way on purpose: the gateway is loopback-only and unauthenticated by design, so a local process that can send a big POST can already do worse. It becomes a finding the moment the gateway is public — with authentication and rate limits, which do not exist yet. |

Nothing here was deployed, and no keys of yours were used: the sandbox accounts and
their dev keys live in `near-mvp/data/chain-session.json`, which is gitignored and dies
with the process.
