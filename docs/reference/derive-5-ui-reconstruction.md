# R5 · Derive: trading interface reconstructed

> **Reference — this is Derive's design, not ours.** Our design: [04-pool-architecture.md](../04-pool-architecture.md) · index: [docs/README.md](../README.md)

**Purpose.** Derive's shipped terminal is the reference for our prototype's screen. This note records what REA
observed of that interface, what we copied, and what we deliberately left out. Evidence is either a retained
browser-scenario capture (OBSERVED) or a reading of the static bundle (SOURCE); design opinions are marked
INFERRED and are not claims about Derive.

## Evidence

| Evidence | ID | What it contains |
|---|---|---|
| Options page, ETH, one instrument selected | `ev_c052968ed623bf504076089555164bab5a927f22ca15526417805f9ac81e18f2` | 17 steps; 6 completed, then a click timed out and the rest were cancelled |
| Options page, BTC, three-leg trade form | `ev_e9479bee9e53ca3c885e3561fa5f02bd11e0d656748886c8f7ffc2e0802d4c4e` | 6 steps, all completed |
| Earlier multi-page pass (options, RFQ, vaults, portfolio, fees) | `ev_00e00f0b0214ab0b92d96402e206a0c8157ab0bc32452b7e75908803933ccc72` | accessibility trees and screenshots per page |
| Static bundle analysis | `ev_3698f52c7785b5b66a1b461274ee103f4391aab2c8417752095df94e18dca4a2` | 89 reconstructed chunks, API endpoints, storage keys |

Screenshots: [ETH chain + spread ticket](../../evidence/rea/ui/ui-call-ticket.png), [BTC chain + three-leg form](../../evidence/rea/ui/btc-btc-spread.png),
[plain chain](../../evidence/rea/ui/v2-options-hydrated.png). Accessibility trees: [ETH](../../evidence/rea/ui/ui-call-ticket.txt), [BTC](../../evidence/rea/ui/btc-btc-spread.txt).

Capture conditions: 1600×1000, dark colour scheme, no wallet connected, public pages only. The failed step was a
click on `button:has-text("Book")`; the accessibility tree shows the route and panel selectors are `tab` roles, not
buttons. That is a selector error in our scenario, not evidence that the control is missing — the same tabs are
listed in the tree.

## Layout

```text
┌ top bar ───────────────────────────────────────────────────────────────┐
│ logo │ Options Perps Spot RFQ Markets + │        │ Connect │ bell │ ⚙ │
├ announcement banner (green text, one line) ────────────────────────────┤
│ rail            │ instrument + expiry chips        │ trade form        │
│ Trade           │ [ETH ▾] Oct 29 Oct 30 Oct 31 …   │ ETH $1,950/$2,375 │
│ RFQ             │ ┌──── Calls ────┬──┬── Puts ───┐ │ Auto Route │ Book │
│ Vaults          │ BidIV Bid Mark Ask AskIV Strike │ RFQ               │
│ Portfolio       │ …       rows, spot marker row … │ Buy ↔ Sell         │
│ History         │ └───────────────┴──┴───────────┘ │ legs + ration     │
│ Stake …         │ Balances Positions Orders Greeks │ limit/amount/TIF  │
│ Docs Support    │ (empty until a wallet connects)  │ summary + payoff  │
└────────────────────────────────────────────────────────────────────────┘
status bar: ● Connected · build id
```

### Navigation (from the accessibility tree, SOURCE of the route list)

Two rail groups plus a footer: Trade `/trade`, RFQ `/trade/rfq`, Vaults `/vaults`, Portfolio `/portfolio?tab=balances`,
History `/history`, Stake `/stake`, Leaderboard `/leaderboard`, Road to Expiry `/road-to-expiry`, then Brokers,
Collaterals, Developers, Explorer, Fees, Funding, Liquidations, Programs, Referrals, Stats, Wallet Lookup; Docs and
Support in the footer. Top tabs: Options, Perps, Spot, RFQ, Markets.

### Chain table

| Property | Observed value |
|---|---|
| Columns per side | **Bid Size, Bid IV, Bid Price, Mark, Ask Price, Ask IV, Ask Size, Delta, Mark IV** (19 columns with the strike) in the full-resolution capture; a narrower capture showed only the five IV/price columns |
| Centre column | Strike, with a live spot marker row inserted at the money (`ETH $2,368.62`, `BTC $81,350.13`) |
| Strike spacing | ETH at ~$2.3k: **uniform $25** for the Oct 31 expiry in the full-resolution capture; $50 with a $25 band near the money for the Oct 30 expiry; BTC at ~$81k: $1,000 |
| Row count | ~13–16 visible strikes each side, scrollable |
| Colour | bids red/pink, asks green, mark white; selected legs filled solid green (buy) or pink (sell) |
| Expiry chips | `Oct 29`, `Oct 30`, `Oct 31 3`, `Nov 1`, `2`, … `Jun 25 2027`, `Sep 24` — a small numeric badge per chip (likely DTE, INFERRED) |

### Trade form

| Element | Observed |
|---|---|
| Header | Instrument name for one leg (`ETH $2,350 Call Oct 30`); becomes `Trade Form` for a multi-leg structure |
| Routes | `Auto Route` (selected), `Book`, `RFQ` |
| Direction | `Buy to Open` / `Sell to Open` (green / grey) for a single leg; per-leg Buy/Sell chips for a spread |
| Legs | Direction · Instrument · Ratio (editable, default 1) · remove (×) |
| Fields | Order Type (Limit), Limit Price (shows the live Ask as a reference), Amount, Time In Force (GTC, 24H), Advanced → Post Only |
| Summary | Margin Required, Buying Power, Estimated Fee, Estimated Rewards (DRV), Estimated Received, Max Cost |
| Primary action | `Connect a wallet` when unauthenticated |
| Panels | Payoff · Greeks · Trades · Book |
| Payoff panel | Max Loss, Break Even, Max Profit; a payoff curve with the live spot as a dashed marker and a filled profit/loss region |

Observed spread tickets: `ETH $1,950/$2,375 Call Spread Oct 31` (buy 2,375 call, sell 1,950 call, ratio 1:1) with
Max Loss $39.60 / Break Even $2,335.40 / Max Profit $385.40, and a three-leg BTC structure (`$82,000 Call`,
`$70,000 Put`, `$75,000 Put`) with Max Loss $145,652 / Break Even $82,652 / Max Profit Infinity.

## Visual language

| Token | Observed |
|---|---|
| Background / panel | near-black page, slightly lighter panels, 1px low-contrast borders |
| Type | compact sans for chrome, tabular monospace for every number |
| Density | 12px body, ~24px rows, no padding for decoration |
| Accents | green for ask/positive, red/pink for bid/negative, blue-white for the live spot marker, white for mark |
| State | green dot + "Connected" bottom-left, build hash bottom-right, dismissible welcome modal centred over the grid |
| Controls | small 6px radii, chips for expiries, segmented control for direction and routes |


## Corrections from the full-resolution capture

A 2560×1080 screenshot supplied after the first pass (browser viewport ≈2000 CSS px) shows the page without
the welcome modal and with more columns, so it supersedes parts of the earlier reading:

| Earlier reading | Corrected |
|---|---|
| Five price columns per side | Nine: Bid Size, Bid IV, Bid Price, Mark, Ask Price, Ask IV, Ask Size, Delta, Mark IV |
| Strike spacing tightens near the money | Uniform $25 on that expiry; tightening appears on other expiries |
| Selecting cells builds a multi-leg spread | The primary interaction is selecting **one** instrument: click a specific side's price cell, and the ticket is that call or put. Two clicks add a second leg and switch the header to "Trade Form" |
| Ticket shows only the selected leg | The ticket always shows the selected instrument plus its bid/ask context (`Limit Price` prefilled, "Ask $34.00" beneath) |
| Table needs horizontal scrolling | At 2000 px it fits: nine columns each side at ~55 px |

What did **not** change: the rail, the expiry chip row, the two-tier header with the expiry countdown over the
strike column, the spot marker row spliced between strikes, the direction segmented control, the
route tabs, the summary block and the Payoff/Greeks/Trades/Book panel.

Our implementation now follows the corrected reading: 19 columns, click-to-select by side and strike, a
single-instrument ticket, and a bid side that is a real resting order (not an invented price).

## What we did with it

| Derive element | In our prototype | Honest difference |
|---|---|---|
| Top tabs | Options, RFQ, Markets active; Perps and Spot disabled | We have no perp or spot venue |
| Left rail | Options, Order Book, Positions, History, Live Feed, Greeks, Docs, Support; Vaults/Perps/Stake disabled | We only build what exists |
| Expiry chips | Real dates: next four days, then the next seven Fridays, with a DTE badge; 08:00 UTC expiries | No listed-instrument calendar, dates are generated |
| Two-tier header | "Calls \| Sat Oct 31 2d 21h 6m \| Puts", the countdown updates every render | Same convention, shorter label on narrow windows |
| 19-column chain | Bid Size, Bid IV, Bid Price, Mark, Ask Price, Ask IV, Ask Size, Delta, Mark IV both sides | Sizes are 1–4 simulated contracts; prices come from a model plus a book |
| Spot marker row | Spliced between strikes, dashed lines, live composite label | Uses our median-of-exchanges print |
| Click a side + strike | Clicking a bid cell selects "Sell to Open", an ask cell selects "Buy to Open"; the strike becomes the long leg of a spread | Our tickets are always two-leg spreads, so the clicked strike anchors the spread |
| Trade form | Limit price prefilled from the book, Amount, TIF, Post Only, Margin/Buying Power/Fee/Max Cost | No fees, so the fee row is honestly 0 |
| Route tabs | Auto Route = sweep the book, Book = take one level, RFQ = simulated maker quote | Liquidity is simulated |
| Payoff / Greeks / Trades / Book | Payoff curve with live spot marker and max loss/break-even/max profit; BS greeks; fill log; two-sided book | Model mark, not a venue mark |
| Status bar | Feed state, custody invariant, series state, build tag | No wallet session |

## Limits of this reconstruction

- One session, one point in time; prices, IVs and fills shown in the captures are stale by definition.
- Everything observed is the **unauthenticated** state: the trade form shows `Connect a wallet`, the portfolio is
  empty, and the payoff panel is the only populated tab.
- The RFQ page renders only its empty state (`View RFQs`, `Strategy Builder`, `Create RFQ`) without a wallet, so the
  RFQ workflow itself was not observed here; [the order-path trace](derive-4-order-path-rea.md) covers its signing
  shape from the bundle instead.
- Column sets differ between captures (size columns appear in one, not the other), so the table is a union, not a
  fixed schema.
- No claim is made that our layout matches Derive pixel-for-pixel. It matches the information architecture and the
  visual grammar; the product underneath is ours.
