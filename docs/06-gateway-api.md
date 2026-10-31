# 6 · Gateway API

The gateway is the only origin the screen talks to. It reads the contract and the engine,
and it is the one place that signs. Everything below is loopback-only: the gateway binds
`127.0.0.1`, refuses a `Host` that is not loopback, and refuses to sign for a page whose
`Origin` is not its own.

| Route | Method | Signs? | Purpose |
|---|---|---|---|
| `/` , `/index.html` | GET | no | the screen, read from `demo/index.html` on disk |
| `/health` | GET | no | `{ ok, contract, engine }` — the two things it depends on |
| `/state?asset=ETH&expiry=…&kind=…&strike=…` | GET | no | one snapshot of the ladder, portfolio, custody, oracle and session history |
| `/stream?asset=ETH` | GET | no | SSE: the index, the tape head and flow counters every `--stream-ms` |
| `/smile?asset=ETH` | GET | no | the engine's vol smile, one curve per tenor (passed through) |
| `/action` | POST | **yes** | plan and sign one transaction |
| `/demo/reset` | POST | **yes** | mint the demo account back up if it is short |

## `/state`

A single read of the chain, projected into what the screen draws. Nothing in the payload is
computed by the gateway except the session history and the naming of tenors.

```jsonc
{
  "now": 1793373317336,            // wall clock, ms
  "spot": 2232.51,                 // the engine's median index, or null
  "chain": [ /* LadderRow: strike, call, put, each side priced from book → vault */ ],
  "positions": { "rows": [ /* cost, mark, exitUnit, open, closeBlock */ ], "totals": {} },
  "orders": [ /* every resting offer and bid on this ladder */ ],
  "custody": { "expected": …, "held": …, "conserved": true, "buckets": [] },
  "pool": { "equity": …, "reserved": …, "freeEquity": …, "utilisationBps": … },
  "seriesCount": 518,
  "openTickets": 11,
  "expiries": [ { "ns": "…", "label": "15:52 UTC" } ],
  "series": { /* the selected cell's detail, or null */ },
  "feed": { /* the engine's /feed body, passed through */ },
  "oracle": { "quorum": 2, "seats": [], "canFix": true, "lastFix": {}, "disagreementBps": 0 },
  "history": { "points": [ { "atMs": …, "spot": …, "open": …, "agreeing": 3, "fix": … } ], "spanS": 108, "sampledEveryS": 1 },
  "trades": ["…"], "volumeBuckets": [], "tape": { "prints": 0, "realised": 0, "closed": [] },
  "you": { "account": "dev-….test.near", "available": 4999995.02, "wallet": … },
  "lp": { "shares": …, "value": …, "exitable": true },
  "contract": "dev-….test.near",
  "source": "contract"
}
```

**A side is priced from what can actually be taken**: a person's resting offer if there is
one, otherwise the vault's published entry, otherwise `0` (drawn as a dash). The model's
ask never stands in as a price. `history` is this gateway's own session, one sample a second
per asset — it dies with the process and the panel says so.

## `/action`

```jsonc
{ "type": "buy",    "asset": "ETH", "kind": "Call", "strike": 2250, "quantity": 1, "expiry": "1793…" }
{ "type": "sell",   "asset": "ETH", "kind": "Put",  "strike": 2150, "quantity": 1, "price": 0.09, "postOnly": true }
{ "type": "close",  "id": 12, "price": 0.07 }
{ "type": "cancel", "id": 28, "side": "sell" }
{ "type": "settle", "id": 12 }
{ "type": "deposit", "amount": 500 }
{ "type": "withdraw", "amount": 50 }
```

The gateway plans the calls in `actions.ts` (pure, tested) and signs them with its own
sandbox account. Three refusals happen before anything is signed:

- an `Origin` that is not this page on this machine → `403`;
- an expiry the chain does not list → the request is refused rather than planned against a
  neighbouring ladder;
- a price the vault will not take (no live quote, exit below the floor, premium above the
  budget) → a `4xx` with the reason the screen shows as a toast.

## `/demo/reset`

Mints and deposits 5,000 USDT when the demo balance is under 1,000, and does nothing
otherwise. Same origin guard as `/action`. It exists so a visitor who has spent the opening
balance can keep testing without restarting the venue.
