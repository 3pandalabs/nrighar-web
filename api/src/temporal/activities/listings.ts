import { and, desc, eq } from "drizzle-orm";
import { ApplicationFailure } from "@temporalio/common";
import { db, schema } from "../../db/index.js";
import { isUniqueViolation } from "../../lib/isUniqueViolation.js";

export async function createListing(input: { ownerId: string; propertyId: string; baseRentAsk: number }) {
  const [property] = await db
    .select({ id: schema.properties.id })
    .from(schema.properties)
    .where(and(eq(schema.properties.id, input.propertyId), eq(schema.properties.ownerId, input.ownerId)));
  if (!property) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });

  try {
    const [row] = await db
      .insert(schema.propertyListings)
      .values({ ownerId: input.ownerId, propertyId: input.propertyId, baseRentAsk: String(input.baseRentAsk) })
      .returning();
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw ApplicationFailure.create({ type: "conflict", nonRetryable: true });
    throw err;
  }
}

export async function listOwnListings(input: { ownerId: string }) {
  return db
    .select()
    .from(schema.propertyListings)
    .where(eq(schema.propertyListings.ownerId, input.ownerId))
    .orderBy(desc(schema.propertyListings.createdAt));
}

// Public-safe fields only — no ownerId, addressLine1, pincode, or notes.
// Anyone browsing shouldn't learn more about a property than a normal
// listing site would show before an application is submitted.
export async function browseOpenListings() {
  return db
    .select({
      id: schema.propertyListings.id,
      baseRentAsk: schema.propertyListings.baseRentAsk,
      createdAt: schema.propertyListings.createdAt,
      title: schema.properties.nickname,
      city: schema.properties.city,
      state: schema.properties.state,
      propertyType: schema.properties.propertyType,
    })
    .from(schema.propertyListings)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.propertyListings.propertyId))
    .where(eq(schema.propertyListings.status, "open"))
    .orderBy(desc(schema.propertyListings.createdAt));
}

export async function closeListing(input: { id: string; ownerId: string }) {
  const [row] = await db
    .update(schema.propertyListings)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(schema.propertyListings.id, input.id), eq(schema.propertyListings.ownerId, input.ownerId)))
    .returning();
  if (!row) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });
  return row;
}
