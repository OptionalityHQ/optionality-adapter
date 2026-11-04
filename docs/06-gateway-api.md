# 6 · Gateway API

The gateway is the only origin the screen talks to. It reads the contract and the engine,
and it is the one place that signs. Everything below is loopback-only: the gateway binds
`127.0.0.1`, refuses a `Host` that is not loopback, and refuses to sign for a page whose
`Origin` is not its own.

| Route | Method | Signs? | Purpose |
|---|---|---|---|
| `/` , `/index.html` | GET | no | the screen, read from `demo/index.html` on disk |
| `/config` | GET | no | `{ network, rpc, contracts, faucet, faucetAmount, faucetDailyClaims }` |
| `/wallet.js`, `/wallet.css` | GET | no | bundled NEAR Wallet Selector assets for in-browser signing |
| `/health` | GET | no | `{ ok, contract, engine }` — the two things it depends on |
| `/state?asset=ETH&expiry=…&account=…` | GET | no | snapshot of the ladder, portfolio, custody, oracle and session history |
| `/stream?asset=ETH` | GET | no | SSE: the index, the tape head and flow counters every `--stream-ms` |
| `/smile?asset=ETH` | GET | no | the engine's vol smile, one curve per tenor (passed through) |
| `/plan` | POST | **no** | plan unsigned NEAR transactions for visitor wallet execution |
| `/action` | POST | **yes** | plan and sign one transaction (local sandbox mode only) |
| `/faucet` | POST | **yes** | mint and credit test collateral to a visitor testnet account (rate-limited, daily quota) |
| `/demo/reset` | POST | **yes** | mint the demo account back up in sandbox mode |

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


## `/config`

Discloses the network mode and contract accounts to the browser:

```jsonc
{
  "network": "testnet",           // or "sandbox"
  "rpc": "https://rpc.testnet.fastnear.com",
  "contracts": {
    "options": "options.sable-knee.testnet",
    "token": "token.sable-knee.testnet",
    "oracle": "oracle.sable-knee.testnet"
  },
  "faucet": true,
  "faucetAmount": 1000,
  "faucetDailyClaims": 100
}
```

The browser screen queries `/config` at boot. If `network === "testnet"`, it activates
the NEAR Wallet Selector (MyNearWallet) and switches trade submissions from `/action`
to `/plan`.

## `/plan`

The testnet counterpart to `/action`. Takes the identical JSON body plus the visitor's
`account` ID. Instead of signing with a local key, it returns unsigned transaction
objects formatted for `@near-wallet-selector`:

```jsonc
{
  "ok": true,
  "transactions": [
    {
      "signerId": "visitor.testnet",
      "receiverId": "token.sable-knee.testnet",
      "actions": [
        {
          "type": "FunctionCall",
          "params": {
            "methodName": "ft_transfer_call",
            "args": { "receiver_id": "options.sable-knee.testnet", "amount": "500000000", "msg": "deposit" },
            "gas": "90000000000000",
            "deposit": "1"
          }
        }
      ]
    }
  ],
  "message": "deposit 500.00 bUSD into the venue"
}
```

The visitor signs in their own wallet (e.g. MyNearWallet). The gateway never sees or
touches visitor private keys.

## `/faucet`

Public testnet faucet for test collateral (`bUSD`).

```bash
curl -X POST http://127.0.0.1:8790/faucet \
  -H "Content-Type: application/json" \
  -H "Origin: http://127.0.0.1:8790" \
  -d '{"account": "visitor.testnet"}'
```

Returns:
```jsonc
{
  "ok": true,
  "account": "visitor.testnet",
  "amount": 1000,
  "hash": "CqS2i1vGZaQm3KJ9CW5XZnLrnUgFj3TmQ4WNsLsWU266",
  "message": "1,000 test tokens are in your wallet. Deposit them into the venue to trade."
}
```

Safety rules enforced by the gateway:
- **Existence check:** refuses accounts that do not exist on NEAR before spending operator gas.
- **Storage registration:** automatically registers the account's storage on `mock_ft` if needed.
- **Per-IP rate limit:** 1 request per 60 seconds.
- **Origin check:** must be called from the authorized web origin.
- **Daily ledger (`FaucetLedger`):** max 1 claim per account per UTC day; max 100 total claims daily.
  Journaled to disk with `0600` permissions. Survived across server restarts.
