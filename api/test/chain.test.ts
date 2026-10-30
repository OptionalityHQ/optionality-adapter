import test from "node:test";
import assert from "node:assert/strict";
import { failureText } from "../src/chain.ts";

test("a contract's own sentence survives the RPC envelope", () => {
  // The shape the sandbox returns for a failed transaction: an action result
  // nested twice, the panic inside that.
  const outcome = {
    index: 0,
    kind: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: pool full: this worst case does not fit the equity left" } } },
  };
  assert.equal(
    failureText(outcome),
    "pool full: this worst case does not fit the equity left",
    "no braces, no field names, the words the contract chose",
  );

  // And the shape the SDK throws instead: the same envelope inside a message.
  const thrown = new Error(`Failed to call ${"x"}: ${JSON.stringify(outcome)}`);
  assert.match(failureText(thrown), /^pool full/);

  // Something with no panic in it is still reported, short and recognisable.
  assert.match(failureText(new Error("connect ECONNREFUSED 127.0.0.1:3030")), /^connect ECONNREFUSED/);
  assert.equal(failureText(null), "");
});
