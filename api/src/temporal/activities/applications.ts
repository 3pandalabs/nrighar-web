import { and, asc, desc, eq } from "drizzle-orm";
import { ApplicationFailure } from "@temporalio/common";
import { db, schema } from "../../db/index.js";
import { isUniqueViolation } from "../../lib/isUniqueViolation.js";

// Always derived from the listing's stored baseRentAsk — a client never
// gets to assert its own variance number.
function computeVariancePct(proposedRent: string, baseRentAsk: string): number {
  const proposed = Number(proposedRent);
  const base = Number(baseRentAsk);
  return Math.round(((proposed - base) / base) * 10000) / 100;
}

export async function submitApplication(input: {
  applicantUserId: string;
  listingId: string;
  proposedRent: number;
  moveInDate: string;
  monthlyIncome?: number;
  profileHighlights?: string;
}) {
  const [listing] = await db
    .select()
    .from(schema.propertyListings)
    .where(eq(schema.propertyListings.id, input.listingId));
  if (!listing || listing.status !== "open") {
    throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });
  }

  try {
    const [row] = await db
      .insert(schema.propertyApplications)
      .values({
        listingId: input.listingId,
        ownerId: listing.ownerId,
        applicantUserId: input.applicantUserId,
        proposedRent: String(input.proposedRent),
        moveInDate: input.moveInDate,
        monthlyIncome: input.monthlyIncome !== undefined ? String(input.monthlyIncome) : undefined,
        profileHighlights: input.profileHighlights,
      })
      .returning();

    return { ...row, rentVariancePct: computeVariancePct(row.proposedRent, listing.baseRentAsk) };
  } catch (err) {
    if (isUniqueViolation(err)) throw ApplicationFailure.create({ type: "conflict", nonRetryable: true });
    throw err;
  }
}

export async function listOwnApplications(input: { applicantUserId: string }) {
  const rows = await db
    .select({
      application: schema.propertyApplications,
      baseRentAsk: schema.propertyListings.baseRentAsk,
      propertyNickname: schema.properties.nickname,
      propertyCity: schema.properties.city,
    })
    .from(schema.propertyApplications)
    .innerJoin(schema.propertyListings, eq(schema.propertyListings.id, schema.propertyApplications.listingId))
    .innerJoin(schema.properties, eq(schema.properties.id, schema.propertyListings.propertyId))
    .where(eq(schema.propertyApplications.applicantUserId, input.applicantUserId))
    .orderBy(desc(schema.propertyApplications.createdAt));

  return rows.map((r) => ({
    ...r.application,
    rentVariancePct: computeVariancePct(r.application.proposedRent, r.baseRentAsk),
    propertyNickname: r.propertyNickname,
    propertyCity: r.propertyCity,
  }));
}

// get_property_applications: side-by-side comparison + market signals for
// one listing. Ordering and every derived signal here is deliberately
// limited to financial metrics (rent, income ratio), timeline (move-in
// date), and verification status (kyc) — Fair Housing rule #4 in the spec.
// applicantFullName/City/Employer are display-only fields pulled through
// for the owner's benefit; nothing here sorts or filters on them, and
// there's no protected-class data anywhere in this schema to begin with.
export async function getListingApplications(input: { listingId: string; ownerId: string }) {
  const [listing] = await db
    .select()
    .from(schema.propertyListings)
    .where(and(eq(schema.propertyListings.id, input.listingId), eq(schema.propertyListings.ownerId, input.ownerId)));
  if (!listing) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });

  const rows = await db
    .select({
      application: schema.propertyApplications,
      applicantFullName: schema.tenantProfiles.fullName,
      applicantCurrentCity: schema.tenantProfiles.currentCity,
      applicantEmployer: schema.tenantProfiles.employer,
      applicantKycStatus: schema.tenantProfiles.kycStatus,
    })
    .from(schema.propertyApplications)
    .leftJoin(schema.tenantProfiles, eq(schema.tenantProfiles.userId, schema.propertyApplications.applicantUserId))
    .where(eq(schema.propertyApplications.listingId, input.listingId))
    .orderBy(desc(schema.propertyApplications.proposedRent));

  const active = rows.filter((r) => r.application.status !== "withdrawn" && r.application.status !== "rejected");
  const rents = active.map((r) => Number(r.application.proposedRent));
  const moveInDates = active.map((r) => r.application.moveInDate).sort();

  const marketSignals = {
    offerVolume: active.length,
    highestProposedRent: rents.length ? Math.max(...rents) : null,
    averageProposedRent: rents.length ? Math.round((rents.reduce((a, b) => a + b, 0) / rents.length) * 100) / 100 : null,
    earliestMoveInDate: moveInDates[0] ?? null,
  };

  const applicants = rows.map((r) => ({
    ...r.application,
    rentVariancePct: computeVariancePct(r.application.proposedRent, listing.baseRentAsk),
    // No credit-bureau integration is wired up (would need a paid, licensed
    // provider — e.g. CIBIL) — always null rather than fabricated.
    incomeToRentRatio: r.application.monthlyIncome
      ? Math.round((Number(r.application.monthlyIncome) / Number(r.application.proposedRent)) * 100) / 100
      : null,
    creditScoreRange: null,
    applicantFullName: r.applicantFullName,
    applicantCurrentCity: r.applicantCurrentCity,
    applicantEmployer: r.applicantEmployer,
    applicantKycStatus: r.applicantKycStatus,
  }));

  return { listing, marketSignals, applicants };
}

// trigger_tenant_kyc_flow: reuses the existing intake-link pipeline
// (temporal/activities/intakeLinks.ts) rather than a new notification
// channel — no SMS/email sender is wired up in this codebase yet, so the
// caller (owner dashboard) is expected to surface intakeLink.id as a
// /join/<id> link, same as the existing "invite a tenant" flow.
export async function requestKycForApplication(input: { applicationId: string; ownerId: string }) {
  const [application] = await db
    .select()
    .from(schema.propertyApplications)
    .where(
      and(eq(schema.propertyApplications.id, input.applicationId), eq(schema.propertyApplications.ownerId, input.ownerId)),
    );
  if (!application) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });
  if (application.status !== "under_review") {
    throw ApplicationFailure.create({ type: "invalid_status", nonRetryable: true });
  }

  const [listing] = await db
    .select({ propertyId: schema.propertyListings.propertyId })
    .from(schema.propertyListings)
    .where(eq(schema.propertyListings.id, application.listingId));

  const [intakeLink] = await db
    .insert(schema.intakeLinks)
    .values({ ownerId: input.ownerId, propertyId: listing?.propertyId })
    .returning();

  // Other applicants on this listing are untouched — they stay
  // under_review until the owner acts on them individually.
  const [updated] = await db
    .update(schema.propertyApplications)
    .set({ status: "kyc_requested", intakeLinkId: intakeLink.id })
    .where(eq(schema.propertyApplications.id, input.applicationId))
    .returning();

  return { application: updated, intakeLink };
}

export async function decideApplication(input: {
  applicationId: string;
  ownerId: string;
  status: "approved" | "rejected";
}) {
  const [row] = await db
    .update(schema.propertyApplications)
    .set({ status: input.status })
    .where(
      and(eq(schema.propertyApplications.id, input.applicationId), eq(schema.propertyApplications.ownerId, input.ownerId)),
    )
    .returning();
  if (!row) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });
  return row;
}

// Shared by both message activities below — same "exists but isn't yours"
// -> 404 (never 403) convention as every other resource in this API. Either
// side of the application (the owner or the applicant) counts as a
// participant; nobody else can read or post into the thread.
async function assertParticipant(applicationId: string, userId: string) {
  const [application] = await db
    .select({ ownerId: schema.propertyApplications.ownerId, applicantUserId: schema.propertyApplications.applicantUserId })
    .from(schema.propertyApplications)
    .where(eq(schema.propertyApplications.id, applicationId));
  if (!application) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });
  if (application.ownerId !== userId && application.applicantUserId !== userId) {
    throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });
  }
  return application;
}

export async function listApplicationMessages(input: { applicationId: string; userId: string }) {
  await assertParticipant(input.applicationId, input.userId);
  return db
    .select()
    .from(schema.applicationMessages)
    .where(eq(schema.applicationMessages.applicationId, input.applicationId))
    .orderBy(asc(schema.applicationMessages.createdAt));
}

export async function sendApplicationMessage(input: { applicationId: string; userId: string; body: string }) {
  const application = await assertParticipant(input.applicationId, input.userId);
  const senderRole = application.ownerId === input.userId ? "owner" : "tenant";
  const [row] = await db
    .insert(schema.applicationMessages)
    .values({ applicationId: input.applicationId, senderUserId: input.userId, senderRole, body: input.body })
    .returning();
  return row;
}
