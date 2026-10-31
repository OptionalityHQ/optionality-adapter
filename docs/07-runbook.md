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
bash scripts/test.sh          # 295 unit + integration tests, ~5 minutes, no venue needed
bash scripts/e2e.sh           # Playwright against a running venue, ~90 s
bash scripts/e2e.sh --settle  # also holds a ticket to expiry; use EXPIRY_HOURS=0.2
```

The e2e writes screenshots, a report, a `trace.zip` and a video of the journey to
`evidence/e2e/`. If it fails, open the report first: it names the step, the text the screen
showed, and any console error.

## Common local chores

```bash
# give the demo account its money back without a restart (also the header's Top up)
curl -sX POST localhost:8790/demo/reset -H "origin: http://127.0.0.1:8790"

# prove settlement does not need our engine
pkill -f target/debug/engine      # the venue's seat goes stale; the other three settle
./target/debug/engine --port 8791 --assets ETH,BTC --expiry-hours 1 &   # bring it back
```
