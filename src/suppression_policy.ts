export type ReleaseSubscriber = {
  phone: string;
  optedOut: boolean;
};

export type RecipientDecision = {
  phone: string;
  decision: "send" | "suppressed";
  reason: "eligible" | "subscriber_opt_out" | "suppression_list";
};

export function decideReleaseRecipients(
  subscribers: ReleaseSubscriber[],
  suppressionPhones: string[],
): RecipientDecision[] {
  const suppressed = new Set(suppressionPhones);

  return subscribers.map((subscriber) => {
    if (subscriber.optedOut) {
      return {
        phone: subscriber.phone,
        decision: "suppressed",
        reason: "subscriber_opt_out",
      };
    }

    if (suppressed.has(subscriber.phone)) {
      return {
        phone: subscriber.phone,
        decision: "suppressed",
        reason: "suppression_list",
      };
    }

    return { phone: subscriber.phone, decision: "send", reason: "eligible" };
  });
}
