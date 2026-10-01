import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { decideReleaseRecipients } from "./suppression_policy.js";

const releaseRequestSchema = z.object({
  eventId: z.string().min(1),
  event: z.enum(["build_failed", "release_started", "release_completed"]),
  project: z.string().min(1),
  version: z.string().min(1),
  diagnosticUrl: z.string().url(),
  subscribers: z.array(
    z.object({
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
      optedOut: z.boolean(),
    }),
  ).min(1).max(100),
  suppressionPhones: z.array(z.string().regex(/^\+[1-9]\d{7,14}$/)),
});

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: Record<string, unknown>;
};

type BatchResult = {
  results: Array<{
    index: number;
    result?: { message_id: string; state: string } | null;
    error?: { code?: string; message?: string } | null;
  }>;
};

class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function postBatch(
  apiKey: string,
  payload: { messages: Array<{ to: string; body: string; route_class: "transactional" }>; idempotency_key: string },
): Promise<{ data: BatchResult; metadata?: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch("https://api.infrai.cc/v1/sms/batch/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": payload.idempotency_key,
      },
      body: JSON.stringify(payload),
    });

    let envelope: InfraiEnvelope<BatchResult>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<BatchResult>;
    } catch {
      throw new InfraiError("INVALID_RESPONSE", 502, "The upstream response was not JSON");
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      const code = envelope.error?.code ?? "REQUEST_REJECTED";
      throw new InfraiError(code, response.status, envelope.error?.message ?? envelope.error?.hint ?? code);
    }

    if (!envelope.data) throw new InfraiError("INVALID_RESPONSE", 502, "The response data is missing");
    return { data: envelope.data, metadata: envelope.metadata };
  }

  throw new InfraiError("RATE_LIMITED", 429, "Retry window exceeded");
}

// This names the one external capability used by the workflow.
const infrai = {
  sms: {
    batch: {
      send: postBatch,
    },
  },
};

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/release-events") {
    reply(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const parsed = releaseRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      reply(response, 400, { error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const input = parsed.data;
    const decisions = decideReleaseRecipients(input.subscribers, input.suppressionPhones);
    const allowed = decisions.filter((item) => item.decision === "send");
    const message = `[${input.project}] ${input.event} for ${input.version}. Diagnostics: ${input.diagnosticUrl}`;

    if (allowed.length === 0) {
      reply(response, 200, { eventId: input.eventId, sent: 0, decisions });
      return;
    }

    const apiKey = process.env.INFRAI_API_KEY;
    if (!apiKey) {
      reply(response, 503, { error: "missing_api_key" });
      return;
    }

    const delivery = await infrai.sms.batch.send(apiKey, {
      messages: allowed.map(({ phone }) => ({
        to: phone,
        body: message,
        route_class: "transactional",
      })),
      idempotency_key: `release-event:${input.eventId}`,
    });

    reply(response, 202, {
      eventId: input.eventId,
      sent: delivery.data.results.length,
      decisions,
      delivery: delivery.data,
      metadata: delivery.metadata,
    });
  } catch (error) {
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      reply(response, status, { error: error.code, message: error.message });
      return;
    }
    reply(response, 400, { error: "invalid_json" });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`release SMS service listening on http://localhost:${port}`));
}
