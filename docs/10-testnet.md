# 10 · Testnet

What it takes to put this in front of strangers, what is done, and what is not.

The short version: the contracts deploy, and the storage-rent bug that would
have killed a public venue is fixed. Three things still stand between that and a
URL you can hand to a user, and none of them are contract work.

## What deploys today

```bash
VENUE=<your-account>.testnet scripts/deploy-testnet.sh          # plan only
VENUE=<your-account>.testnet scripts/deploy-testnet.sh --yes     # for real
```

Eight steps, in dependency order:

| # | Step | Why it is in this order |
|---|---|---|
| 1 | build three wasm artifacts | `scripts/build.sh`, via `cargo near build` |
| 2 | create `token.$VENUE`, `oracle.$VENUE`, `options.$VENUE` | the options contract is initialised with account ids, so they must exist |
| 3 | deploy `mock-ft` | the token the venue escrows |
| 4 | deploy `price-oracle` | the committee the venue asks before it pays |
| 5 | deploy `bounded-options` | holds the token and oracle ids forever |
| 6 | `set_venue`, `set_fee_terms(50, 100)` | until a venue is named, nobody may quote |
| 7 | `add_source` × n, `set_quorum(2)` | **on the oracle.** Without seats nothing can settle |
| 8 | write `data/testnet-session.json` | so the gateway knows where it points |

Step 7 is the one that still needs a human. The signer generates its key from a
random seed at startup and never persists it
(`tools/oracle-signer/src/main.rs:39`). In the sandbox that is correct — the
seats and the chain die together. On testnet a seat whose key changes on restart
is a registered source that can never sign again, so the deploy script refuses to
invent one and skips the step with a warning instead.

## The storage-rent fix

This was the real blocker and it is closed.

NEAR charges rent per byte of contract state, paid from the contract's own
balance. `bounded_options` had no storage accounting at all: every series,
quote, offer, bid and ticket it wrote was a permanent liability it never billed
anyone for. A sandbox does not care, because the account is deleted with the
process. A testnet account does not — it simply runs out, and then every write
fails, including the settlements that traders are waiting on.

The contract now prices its own state:

```rust
SERIES_STATE_BYTES = 344
QUOTE_STATE_BYTES  =  88
OFFER_STATE_BYTES  = 208
```

- **`create_series` is `#[payable]`.** The caller who creates the row pays for
  it. A series outlives its own settlement on purpose — a ticket that paid has
  to be explainable years later — so it is the one row nobody gets for free.
- **`set_pool_quote` / `set_pool_quotes` are `#[payable]`, and only charge for
  cells that are new.** Re-quoting a series the venue already prices adds no
  state. Charging for a refresh would tax the venue for staying fresh, and a
  quote that is expensive to renew is a quote that goes stale.
- **Overpayment is refunded** via `Promise::transfer`. A contract that quietly
  keeps the remainder makes money from its callers' arithmetic.
- **Anyone may call `storage_deposit()`** to top the account up. It is a
  donation with a receipt: no shares, no claim, no right. That is what makes it
  safe to let a stranger do it.
- **`get_storage_state()`** reports `required_yocto`, `paid_yocto`,
  `balance_yocto`, `funded`, `price_per_byte`, `usage_bytes` — so an operator can
  see the tab before a user finds it as a failed transaction.

The per-byte price is read from `env::storage_byte_cost()`, never hard-coded.
The harnesses that call these methods attach the deposit themselves
(`tools/chain-host/src/main.rs`, `integration-tests/tests/e2e.rs`); they
over-attach and let the refund settle it, because a refund is a better failure
than a refusal.

Five tests cover the behaviour:

| Test | What it pins |
|---|---|
| `a_series_must_be_paid_for_by_whoever_creates_it` | no deposit is refused, exact rent is enough |
| `refreshing_a_quote_costs_nothing_after_the_first_time` | re-quoting adds no charge |
| `the_storage_tab_reads_back_what_it_owes_and_what_it_has` | the view is internally consistent |
| `anyone_can_put_money_on_the_storage_tab` | a stranger's deposit is accepted and receipted |
| `an_overpaid_series_refunds_the_remainder` | only the rent is booked |

## What is still missing

Three gaps, in the order they block a real user.

### 1. Visitors cannot sign

The gateway signs every transaction with the sandbox's dev keys, loaded from
`data/chain-session.json`. `api/src/wallet.ts` contains a wallet-connect path but
is dead code: `HAS_SANDBOX = true`, and `server.ts` never imports it.

So today one key acts for everybody. That is fine for a demo and wrong for a
testnet, because a tester's trades would be signed as the operator. The fix is
either a real wallet selector in the screen or a per-user keypair the gateway
custodies and funds from a faucet — a product decision, not a contract one.

### 2. Testers have no tokens

Accounts are created with `worker.dev_create_account()` at boot. On testnet a
tester needs the mock token before they can buy a ticket, and there is no
faucet route. Options: a `mint` the gateway calls on signup, or a small faucet
screen. The mock token's `mint` is owner-only, so this is a gateway change.

### 3. Seats do not survive a restart

Described above. The fix is to derive a seat's key from a persisted seed
(a file or an env var per seat) instead of `random_seed()`, and to let the deploy
script read those seeds. Until then step 7 needs hand-made key material and the
venue can never settle after a committee restart.

## What a demo still needs, and does not have

| Need | Status |
|---|---|
| Public HTTPS endpoint for the gateway | `server.listen(PORT, "127.0.0.1")`, and an origin guard on `host`. Both must change |
| Deploy target | no Dockerfile, no `fly.toml`, no CI. `scripts/deploy-testnet.sh` is the first deployment tooling in the repo |
| Seeded liquidity | `maker-1` / `taker-1` are funded by sandbox mint. On testnet they need real balances |
| E2E suite against a real network | `sim/e2e.mts` drives localhost only |

None of these are hard. They are simply not done, and this document exists so
that "we could deploy" and "a user can try it" are not confused.
