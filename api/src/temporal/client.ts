import { Client, Connection } from "@temporalio/client";
import { temporalEnv } from "./env.js";

// Lazy singleton: the Fastify app and any one-off scripts (triggerPing.ts)
// share this so they don't each open a new gRPC connection per call.
let clientPromise: Promise<Client> | undefined;

export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Connection.connect({ address: temporalEnv.address }).then(
      (connection) => new Client({ connection, namespace: temporalEnv.namespace }),
    );
    // Don't cache a *failed* connection: a rejected promise stored here makes
    // every later request reuse the same rejection, so a transient blip (or a
    // stale TEMPORAL_ADDRESS at boot) turns into a permanent instant-500 until
    // the process is restarted. Clearing it on failure lets the next request
    // reconnect. The success path keeps the singleton.
    clientPromise.catch(() => {
      clientPromise = undefined;
    });
  }
  return clientPromise;
}
