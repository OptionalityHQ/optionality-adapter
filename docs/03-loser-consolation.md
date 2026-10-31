# 3 · Consoling the loser, without becoming a giveaway

> **Ours.** Reference material on other venues is in [reference/](reference/) · index: [docs/README.md](README.md)
[papertrade.xyz](https://papertrade.xyz) do about it. Answer in three parts: what
they actually do, what the arithmetic says for us, and what I would build.

## What papertrade.xyz really is

Not paper trading: real USDC synthetic perps against Hyperliquid's BBO, 1000x, no
order book — every trade is a swap between the user and a pool the users cannot
withdraw from. Its cost model is entirely on the win side: up to a 10% impact
haircut on a winning close, 2% win fee, 2% LP-side loss fee, 0.5% builder fee.

**What a loser receives: `PAPER`, minted at the moment of the loss.** Nothing else
mints it. The mint is supply-relative (`supply · (e^(c·g) − 1)`, `c ≈ 1.101e-9`
per $1, so $1M of realised loss mints ~0.110% of supply), and it multiplies up to
5x while the LP is underwater. Staked PAPER pays 50% of trading fees plus an LP
excess sweep above a $5M cap. The token is non-transferable.

Their own words for the design: *"Token emissions let a positive-house-edge game
present as +EV for the player by remunerating realised losses with a claim on
future protocol value."*

Measured on-chain and from their public leaderboard (29 Oct 2026, `totalSupply`
9,052,750,598 PAPER; $30.6M USDC in the exchange; 28,407 accounts):

- 16,754 accounts net-negative vs 5,377 net-positive → **75.7% of traders who ever
  closed a trade lost**.
- gross losses $82.84M vs gross gains $12.19M; average loser −$4,945 vs average
  winner +$2,267.
- $57.13M of accrued dividends = **69% of gross losses**; among losers with >$1k of
  losses the median has recovered 20.6%, and 15.7% have recovered more than 100%.
- 59% of today's winners hold PAPER: the loop is retention, not charity.

It is not a Ponzi — there is no deposit path, so no new principal pays an old
holder, and the only cash out is fee revenue. The live risk is the opposite: an
uncapped supply-relative mint that paid early losers a windfall (one account lost
$979k, holds 2.78% of supply, accrued $2.14M = 219% of the loss), and it pays
hardest exactly when the LP is least able to afford it.

## Our arithmetic, from our own simulator

ETH 2,200/2,300 7-day put spread at spot 2,365.88, 44.8% vol, 3,000 runs,
38,267 tickets (`evidence/sim/2026-10-28-market-report.txt`):

| fact | value |
| --- | --- |
| average premium | 22.62 tokens = 22.6% of collateral |
| tickets that lose | **73.25%** |
| tickets that finish worthless | 65.96% |
| average loss per loser | 16.84 (74.5% of its premium) |
| the entire buyer→maker leak | **1.54% of premium** |

A flat refund of `Z%` of premium costs `q × Z` per trade, `q = 0.7325`. So
**every flat consolation costs 1.37x its face value**, and the whole maker edge
would fund a 2.1% refund at most. Refunding 10% to every loser needs 7.33% of
premium in fees — 2.8x the maker's entire edge. That is the wall.

The way around it is to stop paying *losers* and start paying *near misses*:

| design | cost/ticket | % of premium | funded by |
| --- | ---: | ---: | --- |
| refund 100% if worthless within **100 bps** (6.10% of tickets) | 1.380 | 6.10% | one Derive-style round trip (6.39%) |
| refund 50% within **50 bps** (3.21%) | 0.363 | 1.60% | 30% of one taker fee |
| refund 3% to every loser | 0.497 | 2.20% | 41% of a round trip |
| refund 10% to every loser | 1.657 | 7.33% | not fundable |

Same budget, 12x the visible refund, and it targets the worst-feeling loss there
is: the protection ticket that expired one tick out of the money.

## What I would build

**1. Second Chance — a near-miss premium refund, funded by a visible surcharge,
paid pro rata out of an escrowed pool.** At fill, take a surcharge `s` of premium
into a `consolation` bucket inside the contract. At settlement, split the bucket
across the qualifying cohort. Refund% is then `s / cohort share`, the pool can
never be insolvent, and the fully-collateralised invariant in [01-hackathon-mvp.md](01-hackathon-mvp.md) survives
untouched — which is the whole point of this product.

| surcharge | ≤50 bps band | ≤100 bps | ≤200 bps | all losers |
| --- | ---: | ---: | ---: | ---: |
| +1% of premium | 31% back | 16% | 8% | 1.4% |
| +2% | 62% | 33% | 17% | 2.7% |
| +3% | 93% | 49% | 25% | 4.1% |

Demo line: *pay 2% more, get a third of your premium back if you miss by less than
1%.*

Three details that make it correct rather than cute:

- **Band in sigma, not bps.** 100 bps is 0.161σ on ETH but 0.231σ on BTC, and the
  hit rate follows (6.10% vs 8.45%). A fixed-bps band silently pays 1.4x more often
  on BTC. `create_series` already stores `price_scale`, both strikes and the vol, so
  normalise the band there.
- **Refuse consolation when `buyer == maker`.** The contract records both sides per
  ticket, so self-filled wash trades are rejected in one line. A CEX needs
  statistical surveillance to get this; here it is a `require!`.
- **Refund ≤ round-trip fee**, or filling your own quote becomes the profit.

**2. Points minted on realised loss, redeemable only against a share of future
fees.** The papertrade mechanism, minus its two failure modes: no counter-cyclical
5x bonus (it pays most when the pool can pay least) and a hard cap on the share of
supply per epoch rather than an uncapped curve. Costless today, works at zero
volume, and non-transferable while pre-revenue.

**3. Copy Derive's fee shape, not a volume ladder.** Second leg of a two-leg spread
pays zero; post-only maker quotes get the rebate. Volume tiers are the most-washed
mechanism in the industry — Aevo's own docs say options get "a special volume ratio
to avoid any exploit of OTM trades", which is an admission that the ladder pays
people for dust. A spread venue should reward hedged structure.

**4. Not yet: lottery, cashback, maker-funded consolation.** A pari-mutuel lottery
(Aevo splits 70/20/10 of ticket revenue) is self-funding and EV-neutral but looks
weak at prototype volume and carries a real gambling-law edge — randomised rewards
to identifiable users were ruled illegal in Belgium and treated as gambling by the
Dutch Gaming Authority in 2018. Volume cashback needs organic volume we do not
have. Maker-funded consolation would take the entire 1.54% edge from the people
whose quotes make the book usable.

## The honest headline

In a fairly priced, capped-payoff options market there is almost no surplus to
redistribute: our own simulator puts the whole buyer→maker leak at 1.5% of premium.
So a loser reward must be either **narrowed** to a small near-miss cohort or
**deferred** into a claim on revenue not yet earned. Papertrade chose deferred and
runs a market where 75.7% of traders lose and the median large loser gets 20.6%
back in dividends. Choose narrowed: an order of magnitude cheaper, fully
collateralised so it cannot go insolvent, and uniquely well-shaped by a bounded
payoff — at trade time we know the exact loss and the exact distance to the strike,
which no sportsbook or perp venue can say.

## What was built instead: hold to expiry, no fee

After the redesign, the shipped answer to "what does the loser get" is not a refund at all —
it is a **cheaper entry for a committed holder**:

- A buyer can take the vault's **mid**, with no venue margin, by choosing *Hold to expiry*.
- In exchange the ticket cannot be closed back to the pool, sold into a bid, or otherwise
  left early. Settlement at expiry is unchanged.
- The fee and the exit are the same option seen twice: the margin is what the venue charged
  for the right to cut and run, so a holder who gives that up does not pay it.

Why this and not the refund: at a 50 bps margin there is no float yield to fund a prize
pool, and funding a lottery from the venue's cut would pay out several times what the venue
earns. The held entry costs nothing to administer, cannot be farmed (there is no exit to
farm), and is fully collateralised by construction. The arithmetic above stays in
`core/src/consolation.rs` for the day there is float income to spend.

## What is now code

`core/src/consolation.rs` implements the chosen shape in integers, with ten tests.

| Piece | Rule as written |
| --- | --- |
| funding | `contribution(loss) = loss × fund_bps ÷ 10 000`, floored — the bucket can be an atom short, never over-promised |
| pity | `multiplier(streak) = min(10 000 + pity_bps × streak, cap)`, so weight = `loss × multiplier ÷ 10 000` |
| draw | one winner, weighted, takes the pot. `pick(roll)` walks cumulative weights, so the same roll on the same book names the same account — the draw is checkable after the fact |
| burning | `finish()` clears every enrolled loss. A defeat cannot enter two draws |
| the bound | `keeps_losing_unprofitable()` ⇔ `fund_bps × max_multiplier < 10 000²` |

That last line is the whole product risk, stated as arithmetic. A farmer with a
trivial loss inside a big pool approaches an expectation of `fund × multiplier` on
their own loss, so at 5% funding and a 4× cap the best available outcome is 20% of
what they threw away; at 25% and 4× it is exactly 100% and losing has become a
strategy. The default `Rules::STANDARD` sits at 2 000 bps of edge and a test sweeps
500 pseudo-random loss distributions to confirm no participant's expectation ever
exceeds their own loss.

The module holds no money and cannot reach `Pool::equity`: the contract decides
what the pot is from a yield or fee sweep, and the draw pays at most what it is
handed. Wiring it into the contract — the epoch rollover, the sweep that fills the
bucket, and the claim that pays the winner — is the remaining half of phase 7, and
it waits on the economics harness, not on code.

Sources: papertrade.xyz docs (asymmetric impact, wins-and-losses, paper-emissions,
mint-curve, staking-dividends, martingaler LP, protocol changes) and live reads from
`rpc.hyperliquid.xyz/evm`, `api.hyperliquid.xyz` and their leaderboard on
29 Oct 2026; Derive trading-fee docs; Aevo VBC/lottery/trading-rewards docs;
Lighter binary-option fees, fee credits and LLP docs; Hyperliquid fees and points
docs; Aster Rh points docs; dYdX deleveraging docs; Optimism and Arbitrum
airdrop-criteria pages; BetMGM Second Chance refunds; bad-beat jackpot rules;
FTMO challenge terms; CMC/Capital.com guaranteed-stop products. Rollbit's rakeback
page and the Binance/Bybit/Deribit fee pages could not be fetched from here, so
those figures are not used.
