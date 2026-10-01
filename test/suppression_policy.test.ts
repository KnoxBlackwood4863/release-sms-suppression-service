import assert from "node:assert/strict";
import test from "node:test";
import { decideReleaseRecipients } from "../src/suppression_policy.js";

test("a release alert excludes both explicit opt-outs and suppressed phones", () => {
  const decisions = decideReleaseRecipients(
    [
      { phone: "+14155550101", optedOut: false },
      { phone: "+14155550102", optedOut: true },
      { phone: "+14155550103", optedOut: false },
    ],
    ["+14155550103"],
  );

  assert.deepEqual(decisions, [
    { phone: "+14155550101", decision: "send", reason: "eligible" },
    { phone: "+14155550102", decision: "suppressed", reason: "subscriber_opt_out" },
    { phone: "+14155550103", decision: "suppressed", reason: "suppression_list" },
  ]);
});
