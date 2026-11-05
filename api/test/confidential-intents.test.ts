import test from "node:test";
import assert from "node:assert/strict";
import { previewConfidentialFunding } from "../src/confidential-intents.ts";

const preview = { originAsset: "nep141:wrap.near", destinationAsset: "nep141:usdt.tether-token.near", amount: "1000000000000000000000000", recipient: "example.near", refundTo: "example.near" };

test("confidential capability checks cannot broadcast or downgrade to public", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const fetcher = (async (url: string, options: RequestInit) => {
    requests.push({ url, body: JSON.parse(options.body as string) });
    assert.equal(new Headers(options.headers).get("X-API-Key"), "test-only-key");
    assert.equal(options.redirect, "error", "never forward credentials through a redirect");
    return new Response("provider failure that must not be echoed", { status: 400 });
  }) as typeof fetch;
  await assert.rejects(previewConfidentialFunding(preview, "test-only-key", fetcher), /HTTP 400.*no public fallback/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://1click.chaindefuser.com/v0/quote");
  assert.equal(requests[0].body.dry, true);
  assert.equal(requests[0].body.confidentiality, "advanced");
});

test("invalid size, slippage and absent credentials are rejected before contacting the API", async () => {
  const never = (async () => { assert.fail("must not contact API"); }) as typeof fetch;
  for (const amount of ["0", "-1", "1.5", "1e6", "9".repeat(40)]) {
    await assert.rejects(previewConfidentialFunding({ ...preview, amount }, "test", never), /positive base-unit/);
  }
  for (const slippageBps of [-1, 101, 0.5, NaN]) {
    await assert.rejects(previewConfidentialFunding({ ...preview, slippageBps }, "test", never), /slippage/);
  }
  await assert.rejects(previewConfidentialFunding(preview, "", never), /not configured/);
});

test("unsigned or malformed quotes are never treated as verified private funding", async () => {
  const fetcher = (async () => Response.json({ quoteRequest: {}, quote: {}, signature: "invalid" })) as typeof fetch;
  await assert.rejects(previewConfidentialFunding(preview, "test", fetcher), /signature is invalid/);
});

// A real provider-signed dry response using throwaway diagnostic destinations.
// It is historical test data, never a quote to fund or execute.
import { readFileSync } from "node:fs";
import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { validateDryQuote, ConfidentialQuoteError } from "../src/confidential-intents.ts";
const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/confidential-dry-quote.json", import.meta.url), "utf8"));

test("accepts the provider-signed advanced preview for a shared Intents balance", () => {
  const quote = fixture();
  assert.equal(quote.quoteRequest.confidentiality, "advanced");
  assert.equal(quote.quoteRequest.recipientType, "INTENTS");
  assert.equal(validateDryQuote({ ...quote.quoteRequest }, quote), quote);
});

test("economic quote tampering invalidates the provider signature", () => {
  const quote = fixture();
  quote.quote.amountOut = (BigInt(quote.quote.amountOut) + 1n).toString();
  assert.throws(() => validateDryQuote({ ...quote.quoteRequest }, quote), /signature is invalid/);
});

test("confidentiality echo is checked independently because the SDK does not sign it", () => {
  const quote = fixture();
  const requested = { ...quote.quoteRequest };
  quote.quoteRequest.confidentiality = "public";
  assert.equal(verifyQuoteSignature(quote), true, "SDK signature must not be mistaken for proof of confidentiality mode");
  assert.throws(() => validateDryQuote(requested, quote), /requested confidentiality/);
});

test("dry signatures cannot be reused to inject executable funding metadata", () => {
  for (const [name, value] of [["depositAddress", "never-fund-this"], ["timeWhenInactive", "2026-11-05T00:00:00Z"], ["deadline", "2026-11-05T00:00:00Z"]]) {
    const quote = fixture();
    quote.quote[name] = value;
    assert.throws(() => validateDryQuote({ ...quote.quoteRequest }, quote), /executable funding metadata/);
  }
});

test("unavailable routes are reported as route failures, not assumed access restrictions", async () => {
  const fetcher = (async () => Response.json({ message: "Quoting for this pair is not available", correlationId: "795d68d5-dba7-4549-85b2-b25a9f974a42" }, { status: 400 })) as typeof fetch;
  try { await previewConfidentialFunding(preview, "test", fetcher); assert.fail("request must be refused"); }
  catch (error) {
    assert.ok(error instanceof ConfidentialQuoteError);
    assert.equal(error.code, "route_unavailable");
    assert.equal(error.status, 400);
    assert.equal(error.correlationId, "795d68d5-dba7-4549-85b2-b25a9f974a42");
  }
});
