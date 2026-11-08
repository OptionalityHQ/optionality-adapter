import test from "node:test";
import assert from "node:assert/strict";
import { getLeaderboard, getUserMandates, createOrUpdateMandate, revokeMandate, getCopyJournal } from "../src/copy-trading.ts";

test("copy-trading models and endpoints provide full leaderboard and copy workflow", () => {
  const leaders = getLeaderboard();
  assert.ok(leaders.length >= 4);

  const ethLeaders = getLeaderboard("ETH");
  assert.ok(ethLeaders.length >= 2);

  const account = "user-copy-qa.testnet";
  const mandate = createOrUpdateMandate(account, {
    profileId: "trader-kaito",
    maxContracts: 3,
    maxEachUsd: 75,
    maxTotalUsd: 400,
    maxExitLossBps: 1500,
  });

  assert.equal(mandate.account, account);
  assert.equal(mandate.profileId, "trader-kaito");
  assert.equal(mandate.maxContracts, 3);
  assert.equal(mandate.maxTotalUsd, 400);
  assert.equal(mandate.active, true);

  const userMandates = getUserMandates(account);
  assert.ok(userMandates.some((m) => m.profileId === "trader-kaito" && m.active));

  const journal = getCopyJournal(account);
  assert.ok(journal.length > 0);
  assert.equal(journal[0].action, "Auto-Buy");

  const revoked = revokeMandate(account, "trader-kaito");
  assert.equal(revoked, true);
  const updated = getUserMandates(account);
  assert.equal(updated.find((m) => m.profileId === "trader-kaito")?.active, false);
});
