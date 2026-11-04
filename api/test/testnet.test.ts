import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountId, walletTransactions, FaucetLedger } from "../src/testnet.ts";
import { planDeposit, planWithdraw } from "../src/actions.ts";

test("unsigned transactions preserve visitor, token recipient, gas and attached deposit", () => {
  const contracts = { options: "options.demo.testnet", token: "token.demo.testnet" };
  const transactions = walletTransactions([planDeposit({ type: "deposit", amount: 10 }), planWithdraw({ type: "withdraw", amount: 2 })], "visitor.testnet", contracts);
  assert.equal(transactions[0].signerId, "visitor.testnet");
  assert.equal(transactions[0].receiverId, contracts.token);
  assert.equal(transactions[0].actions[0].params.args.receiver_id, contracts.options);
  assert.equal(transactions[0].actions[0].params.deposit, "1");
  assert.equal(transactions[0].actions[0].params.gas, "90000000000000");
  assert.equal(transactions[1].receiverId, contracts.options);
  for (const invalid of ["../key", "a", "ALICE.testnet", "a..testnet", "a".repeat(65), null]) assert.throws(() => accountId(invalid));
});

test("faucet quotas survive restart and reset at the UTC boundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "faucet-"));
  try {
    let now = Date.parse("2026-11-04T23:59:00Z");
    const path = join(dir, "ledger.json");
    const first = new FaucetLedger(path, 2, () => now);
    first.reserve("alice.testnet");
    const restarted = new FaucetLedger(path, 2, () => now);
    assert.throws(() => restarted.reserve("alice.testnet"), /already claimed/);
    restarted.reserve("bob.testnet");
    assert.throws(() => restarted.reserve("carol.testnet"), /limit/);
    now += 120_000;
    restarted.reserve("alice.testnet");
  } finally { rmSync(dir, { recursive: true }); }
});
