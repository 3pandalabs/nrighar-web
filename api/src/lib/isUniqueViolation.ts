// A Postgres error thrown inside a Temporal activity never reaches
// Fastify's setErrorHandler (different process) — activities that write to
// a table with a partial unique index need to check this explicitly and
// convert it to a conflict ApplicationFailure themselves.
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}
