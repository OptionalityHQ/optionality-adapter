# Try it — a ten-minute script

Everything runs on a local NEAR sandbox that `near-mvp/scripts/venue.sh` starts and
throws away. There is no wallet, no testnet, no funds: the account the screen trades
with is a dev account the gateway holds the key for, and the token is a mock.

```
cd near-mvp && bash scripts/venue.sh     # ~3 minutes: builds, deploys, lists, quotes
open http://127.0.0.1:8790
```

The venue charges **0.5% over mid to open and 1% under mid to close** — a round trip of
about 1.5% of the premium, not the prototype's 13.5%. The Fees page prints the schedule it
is actually running.

The header says **No wallet · simulated** because that is true. **Top up** mints the
demo account back to 5,000,000 USDT if it ever runs short; pressing it while funded
does nothing.

## What you should see on arrival

| Where | What | Why it matters |
|---|---|---|
| Expiry strip | up to 7 chips, nearest first | the venue lists a schedule, not one market |
| Ladder | ~19 strikes, both sides, mark in grey and ask/bid in white | the white numbers are prices you can take |
| Banner | `ETH 2,230.12 = median of Binance · Bybit · Coinbase` and `settle $2,230.30 by kraken+okx+…` | the index is three venues; the settlement price is four seats |
| Footer | `feed live · custody ok 50,000,000.00` | custody is reconciled against the token on every read |

## The eight steps

1. **Buy.** Click a strike near the money, leave *Buy to Open*, press the button. You
   should get `bought 1x from the pool at 0.0907 all-in` and one transaction.
2. **Read the position.** Positions tab: cost, what a close pays *now*, and the P&L that
   difference implies — not the model's mark.
3. **Close.** `Close @ …` sells it back to the vault. The realised number moves; the
   open number disappears.
4. **Rest an offer.** Switch to *Sell to Open* + *Post Only*, press *Rest offer*. The
   Orders tab shows your row with a **Cancel**.
5. **Cancel it.** The row leaves the book and your collateral comes back.
6. **Watch the book.** A seeded maker keeps two offers resting; a seeded taker buys and
   closes every ~20 s. The tape and the Session chart should move without you.
7. **Look at the Session panel.** Index, open P&L, and how many seats of the committee
   agreed — sampled once a second *by this gateway*, gone when it restarts. The caption
   says so.
8. **Look at the Oracle panel.** Four seats, what each one said, how far apart they are,
   and the last fix with its signers. Kill the engine (`pkill -f target/debug/engine`)
   and watch our seat go `STALE — no vote` while the other three keep fixing.

**Hold to expiry.** Toggle *Hold to expiry · no fee* and buy: the ticket is written at the
**mid**, with no venue margin, and the button says so. The position then reads *held to
expiry · no early close* — no Close button, no unrealised PnL, because there is no price it
could take. That is the trade: the fee is the exit you gave up.

**Fill or kill.** Set *Order Type* to *Fill or kill* and buy more than is resting: the
whole order is refused rather than partially filled. The contract was always able to do
this (`min_quantity`); the screen now asks for it.

## Then let a market expire

Buy on the nearest chip and keep the ticket. When the series expires the row swaps
**Close** for **Settle · up to $…**, and settling pays from the maker's collateral at
the price the committee fixed — the provenance is on the row. If no print arrives inside
the window the series voids and the premium comes back instead.

## The same journey, automated

The eight steps above are also a Playwright test, run against the live screen and the live
chain:

```
near-mvp/scripts/e2e.sh              # 0 blockers expected, ~90 s
near-mvp/scripts/e2e.sh --settle     # also holds a ticket to expiry and settles it
```

It clicks with Playwright's actionability checks (visible, stable, enabled, actually
receives the event), fails on a console error or a failed request, checks that the smile
canvas has pixels on it, measures the phone width, and leaves screenshots, a `trace.zip`
you can replay, and a video of each journey — [journey-fast.mp4](../near-mvp/evidence/e2e/journey-fast.mp4)
and [journey-settle.mp4](../near-mvp/evidence/e2e/journey-settle.mp4).

## What is deliberately not here

No history beyond this session, no portfolio margin, no wallet, no deploy. The screen
will tell you when the vault has no live quote rather than quoting the model; that is a
refusal you can trust, not a bug. `docs/05-red-team.md` lists everything that has gone
wrong so far, including the four defects found in the last audit.
