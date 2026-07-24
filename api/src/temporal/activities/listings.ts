import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { ApplicationFailure } from "@temporalio/common";
import { db, schema } from "../../db/index.js";
import { isUniqueViolation } from "../../lib/isUniqueViolation.js";

export async function createListing(input: {
  ownerId: string;
  propertyId: string;
  baseRentAsk: number;
  minLeaseMonths?: number;
}) {
  const [property] = await db
    .select({ id: schema.properties.id })
    .from(schema.properties)
    .where(and(eq(schema.properties.id, input.propertyId), eq(schema.properties.ownerId, input.ownerId)));
  if (!property) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });

  try {
    const [row] = await db
      .insert(schema.propertyListings)
      .values({
        ownerId: input.ownerId,
        propertyId: input.propertyId,
        baseRentAsk: String(input.baseRentAsk),
        minLeaseMonths: input.minLeaseMonths,
      })
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

// Public-safe fields only — no ownerId, addressLine1, or notes. pincode is
// exposed (it's a postal-area code, not a street address) since it's the
// primary location filter; anyone browsing still can't learn a specific
// unit's address before applying. Every filter is optional and AND'd
// together — see routes/listings.ts for the exact semantics of each.
export async function browseOpenListings(input: {
  pincode?: string;
  bedrooms?: number;
  minRent?: number;
  maxRent?: number;
  minLeaseMonths?: number;
}) {
  return db
    .select({
      id: schema.propertyListings.id,
      baseRentAsk: schema.propertyListings.baseRentAsk,
      minLeaseMonths: schema.propertyListings.minLeaseMonths,
      createdAt: schema.propertyListings.createdAt,
      title: schema.properties.nickname,
      city: schema.properties.city,
      state: schema.properties.state,
      pincode: schema.properties.pincode,
      propertyType: schema.properties.propertyType,
      bedrooms: schema.properties.bedrooms,
    })
    .from(schema.propertyListings)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.propertyListings.propertyId))
    .where(
      and(
        eq(schema.propertyListings.status, "open"),
        input.pincode ? eq(schema.properties.pincode, input.pincode) : undefined,
        input.bedrooms !== undefined ? eq(schema.properties.bedrooms, input.bedrooms) : undefined,
        input.minRent !== undefined ? gte(schema.propertyListings.baseRentAsk, String(input.minRent)) : undefined,
        input.maxRent !== undefined ? lte(schema.propertyListings.baseRentAsk, String(input.maxRent)) : undefined,
        // A tenant asking for a 12-month min still wants to see a listing
        // that's fine with as little as 6 — only exclude listings whose
        // stated minimum exceeds what the tenant is willing to commit to.
        // A listing with no stated minimum (null) always passes.
        input.minLeaseMonths !== undefined
          ? or(isNull(schema.propertyListings.minLeaseMonths), lte(schema.propertyListings.minLeaseMonths, input.minLeaseMonths))
          : undefined,
      ),
    )
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
