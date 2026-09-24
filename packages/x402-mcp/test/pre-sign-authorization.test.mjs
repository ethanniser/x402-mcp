import assert from "node:assert/strict";
import test from "node:test";
import { authorizeBeforeSigning } from "../dist/pre-sign-authorization.js";

const requirements = {
  scheme: "exact",
  network: "base",
  maxAmountRequired: "1000",
  resource: "https://example.com/tool",
  description: "Paid tool",
  mimeType: "application/json",
  payTo: "0x0000000000000000000000000000000000000001",
  maxTimeoutSeconds: 60,
  asset: "0x0000000000000000000000000000000000000002",
};

test("continues when no pre-sign authorization is configured", async () => {
  await authorizeBeforeSigning(undefined, 1, requirements);
});

test("continues only on ALLOW", async () => {
  await authorizeBeforeSigning(
    { check: async () => ({ decision: "ALLOW" }) },
    1,
    requirements,
  );
});

for (const decision of ["BLOCK", "REQUIRE_APPROVAL"]) {
  test(`fails closed on ${decision}`, async () => {
    await assert.rejects(
      authorizeBeforeSigning(
        { check: async () => ({ decision, reason: "policy" }) },
        1,
        requirements,
      ),
      /Payment was not signed/,
    );
  });
}

test("fails closed on malformed decisions", async () => {
  await assert.rejects(
    authorizeBeforeSigning(
      { check: async () => ({ decision: "UNKNOWN" }) },
      1,
      requirements,
    ),
    /Payment was not signed/,
  );
});

test("fails closed and aborts on timeout", async () => {
  let signal;
  await assert.rejects(
    authorizeBeforeSigning(
      {
        timeoutMs: 5,
        check: async (request) => {
          signal = request.signal;
          await new Promise(() => {});
        },
      },
      1,
      requirements,
    ),
    /Payment was not signed/,
  );
  assert.equal(signal.aborted, true);
});

test("fails closed when the check throws", async () => {
  await assert.rejects(
    authorizeBeforeSigning(
      {
        check: async () => {
          throw new Error("offline");
        },
      },
      1,
      requirements,
    ),
    /Payment was not signed/,
  );
});
