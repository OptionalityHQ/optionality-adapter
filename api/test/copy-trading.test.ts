import test from "node:test";
import assert from "node:assert/strict";
import {
  getLeaderboard,
  getLeaderById,
  getUserMandates,
  createOrUpdateMandate,
  revokeMandate,
  getCopyJournal,
} from "../src/copy-trading.ts";

test("getLeaderboard returns top strategies with enclave verification", () => {
  const all = getLeaderboard();
  assert.ok(all.length >= 4);
  for (const leader of all) {
    assert.ok(leader.id.length > 0);
    assert.ok(leader.name.length > 0);
    assert.ok(leader.price > 0);
    assert.ok(leader.performance.winRate > 0 && leader.performance.winRate <= 100);
    assert.ok(leader.enclaveVerified);
    assert.equal(leader.enclaveTaskId, 20887);
  }

  const ethOnly = getLeaderboard("ETH");
  assert.ok(ethOnly.every((l) => l.asset === "ETH" || l.asset === "ALL"));
});

test("mandate creation, retrieval and revocation lifecycle", () => {
  const account = "test-user-1.testnet";
  const mandate = createOrUpdateMandate(account, {
    profileId: "algo-eth-harvester",
    maxContracts: 2,
    maxEachUsd: 50,
    maxTotalUsd: 300,
    maxExitLossBps: 2000,
  });

  assert.equal(mandate.account, account);
  assert.equal(mandate.profileId, "algo-eth-harvester");
  assert.equal(mandate.maxContracts, 2);
  assert.equal(mandate.maxTotalUsd, 300);
  assert.equal(mandate.active, true);

  const list = getUserMandates(account);
  assert.ok(list.some((m) => m.profileId === "algo-eth-harvester" && m.active));

  const revoked = revokeMandate(account, "algo-eth-harvester");
  assert.equal(revoked, true);

  const updatedList = getUserMandates(account);
  const found = updatedList.find((m) => m.profileId === "algo-eth-harvester");
  assert.ok(found);
  assert.equal(found.active, false);
});

test("journal entries expose zero front-running enclave sequencing", () => {
  const journal = getCopyJournal();
  assert.ok(journal.length > 0);
  for (const entry of journal) {
    assert.ok(entry.enclaveSeq > 0);
    assert.ok(entry.contracts > 0);
    assert.ok(entry.premium > 0);
    assert.ok(["Auto-Buy", "Auto-Exit", "Settlement Payout"].includes(entry.action));
  }
});
