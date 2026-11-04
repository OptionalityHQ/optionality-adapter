# 7 · Runbook

Everything is local: a NEAR sandbox the operator process starts and throws away, three Rust
daemons, one TypeScript gateway, and the machine's own Chrome for the end-to-end test.

## Start and stop

```bash
cd near-mvp
bash scripts/venue.sh          # builds, deploys, lists, quotes; ~3 minutes
bash scripts/venue.sh stop     # stops engine, chain host, signers, gateway
```

It prints the two addresses you need (`screen http://127.0.0.1:8790`, `engine …:8791`) and
writes `logs/engine.log`, `logs/host.log`, `logs/gateway.log`. The sandbox lives and dies
with the chain host: Ctrl-C or `stop` takes the chain and every transaction with it.

For a **public testnet** deployment there is a separate script, and it is a different
proposition: the account survives, so it costs NEAR and it needs a committee. Read
[10 · Testnet](10-testnet.md) first, then:

```bash
VENUE=<your-account>.testnet bash scripts/deploy-testnet.sh         # plan only
VENUE=<your-account>.testnet bash scripts/deploy-testnet.sh --yes   # deploys
```

Check the rent tab after any deploy or long run: `near view <options-id> get_storage_state`.
A contract that cannot pay for its own state stops accepting writes, and the first write to
fail will be a settlement somebody is waiting on.

| Knob | Default | What it changes |
|---|---|---|
| `EXPIRY_HOURS` | `1` | the near tenor. `0.12` (~7 min) for a settle demo, `0.2` for a longer one |
| `HOURS` | `0` | whole-hour markets in front of the dailies; each one is another quote to renew |
| `TICK_SECS` | `4` | how often the operator wakes up |
| `LIST_SECS` | `30` | re-list cadence (it also re-lists the moment a ladder is missing) |
| `MAKER_ROLE` / `ACTIVITY_ROLE` | `maker-1` / `taker-1` | the seeded maker and the seeded taker; set either to another role, or to an unfunded name to disable it |
| `MARGIN_BPS` / `IMPACT_BPS` | `50` / `100` | what the venue charges: 0.5% over mid to open, 1% under mid to close. The contract's own default is the prototype's 400/1000; the host calls `set_fee_terms` at boot |
| `ENGINE_PORT` / `GATEWAY_PORT` | `8791` / `8790` | ports |
| `ASSETS` | `ETH,BTC` | which underlyings the engine and operator run |

## Is it healthy?

```bash
curl -s localhost:8790/health          # {"ok":true,"contract":"dev-…","engine":"http://127.0.0.1:8791"}
curl -s localhost:8791/health | head -c 200   # status, expiries, atmVol, feed sockets
curl -s "localhost:8790/state?asset=ETH" -H "origin: http://127.0.0.1:8790" | jq '.oracle.canFix'
```

What "healthy" looks like: the banner is `LIVE`, the footer says `custody ok`, the Oracle
panel shows seats `counts` (not `STALE — no vote`), and the ladder's white ask column has
prices in most rows.

## The four failure modes worth recognising

| Symptom | Likely cause | What to do |
|---|---|---|
| The screen is up, the ladder is all dashes | the vault has no live quotes: a pass is still running, or quoting is failing | wait one pass; then `tail logs/host.log` for `quoting failed` / `quote read failed` |
| Banner says `DEGRADED` or `OFFLINE` | the engine has fewer than two fresh exchange sockets | `tail logs/engine.log`; it reconnects on its own with backoff |
| Oracle shows `STALE — no vote` for a seat | that source has not published recently (Pyth's public feeds go quiet) | expected; two of four seats still settle. Check `grep "says nothing" logs/host.log` |
| Buying answers "the venue has no price to buy it back at" | the quote aged out between your read and your click (the sandbox clock runs faster than yours) | try the row again; if it persists the operator is not quoting |
| `port 8791 is already held by: …` | a previous venue is still running | `bash scripts/venue.sh stop`, or start with another `GATEWAY_PORT` |

The session file (`data/chain-session.json`) holds the sandbox's dev keys and is gitignored.
If it is stale — the gateway answering `fetch failed` while the RPC is alive — the venue was
restarted and the gateway is pointed at the old chain: restart it.

## Tests

```bash
bash scripts/test.sh          # 340 unit + integration tests, ~3m30, no venue needed
bash scripts/e2e.sh           # Playwright happy path against a running venue, ~90 s
bash scripts/e2e.sh --settle  # also holds a ticket to expiry; use EXPIRY_HOURS=0.2
npm run e2e:suite             # adversarial Chrome pass: refusals, partial fills, custody, a11y
```

The e2e writes screenshots, a report, a `trace.zip` and a video of the journey to
`evidence/e2e/`; the suite writes the same to `evidence/suite/`. If it fails, open the report first: it names the step, the text the screen
showed, and any console error.

## Common local chores

```bash
# give the demo account its money back without a restart (also the header's Top up)
curl -sX POST localhost:8790/demo/reset -H "origin: http://127.0.0.1:8790"

# prove settlement does not need our engine
pkill -f target/debug/engine      # the venue's seat goes stale; the other three settle
./target/debug/engine --port 8791 --assets ETH,BTC --expiry-hours 1 &   # bring it back
```


## Running on Public Testnet

To operate against the live testnet deployment (`sable-knee.testnet`):

```bash
# 1. Build the frontend demo bundle
node sim/build-demo.mjs

# 2. Run the full testnet service stack (Engine + Testnet Operator + Gateway):
NEAR_ADMIN_CREDENTIALS=~/.near-credentials/testnet/sable-knee.testnet.json scripts/testnet.sh

# 3. In another terminal, run the automated testnet verification suite:
NEAR_ADMIN_CREDENTIALS=~/.near-credentials/testnet/sable-knee.testnet.json node scripts/testnet-smoke.mjs --execute
```

The smoke test verifies every step against NEAR testnet and writes evidence to `data/testnet-lifecycle.json`:
1. Mints 1,000 bUSD via `/faucet`.
2. Deposits 500 bUSD via `ft_transfer_call`.
3. Withdraws 50 bUSD.
4. Buys ticket, closes early for refund.
5. Buys held ticket, holds through expiry.
6. Operator automatically fixes price with oracle committee.
7. Settles ticket and checks custody conservation.

### Viewing Testnet Contract State

```bash
# View options contract storage rent and balances:
near view options.sable-knee.testnet get_storage_state --network-id testnet
near view options.sable-knee.testnet get_pool_state --network-id testnet

# View oracle committee sources and quorum:
near view oracle.sable-knee.testnet get_sources --network-id testnet

# View token metadata and supply:
near view token.sable-knee.testnet ft_metadata --network-id testnet
```
