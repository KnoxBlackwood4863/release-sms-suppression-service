import { decideReleaseRecipients } from "../src/suppression_policy.js";

const decisions = decideReleaseRecipients(
  [
    { phone: "+14155550101", optedOut: false },
    { phone: "+14155550102", optedOut: true },
    { phone: "+14155550103", optedOut: false },
  ],
  ["+14155550103"],
);

console.log(JSON.stringify({ event: "release_completed", decisions }, null, 2));
