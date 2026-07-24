import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatInr } from "@/lib/currency";
import { SITE_URL } from "@/lib/upi";
import type { ApplicationMessage, ListingApplicationsResponse, ListingApplicant, Property } from "@/lib/types";
import { MessageThread } from "@/components/MessageThread";
import { InviteLinkActions } from "../../tenants/invite-link";
import { closeListing, decideApplication, requestApplicationKyc, sendApplicationMessage } from "../../actions";

const STATUS_LABELS: Record<ListingApplicant["status"], string> = {
  under_review: "Under review",
  kyc_requested: "KYC requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const KYC_LABELS: Record<string, string> = {
  pending: "No prior KYC",
  submitted: "KYC submitted",
  verified: "KYC verified",
};

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let data: ListingApplicationsResponse;
  try {
    data = await apiFetch(`/listings/${id}/applications`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const { listing, marketSignals, applicants } = data;
  const property: Property | null = await apiFetch(`/properties/${listing.propertyId}`).catch(() => null);
  const messagesByApplicant = new Map(
    await Promise.all(
      applicants.map(
        async (a) => [a.id, (await apiFetch(`/applications/${a.id}/messages`)) as ApplicationMessage[]] as const,
      ),
    ),
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/listings" className="text-sm text-zinc-500 hover:underline">
            ← Marketplace
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {property?.nickname ?? "Listing"}
          </h1>
          <p className="text-sm text-zinc-500">
            Asking {formatInr(Number(listing.baseRentAsk))} / month
            {listing.minLeaseMonths ? ` · ${listing.minLeaseMonths}mo min lease` : ""} ·{" "}
            {listing.status === "open" ? (
              <span className="text-emerald-600 dark:text-emerald-500">Open</span>
            ) : (
              <span className="text-zinc-400">Closed</span>
            )}
          </p>
        </div>
        {listing.status === "open" && (
          <form action={closeListing}>
            <input type="hidden" name="id" value={listing.id} />
            <button
              type="submit"
              className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Close listing
            </button>
          </form>
        )}
      </div>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Offers" value={String(marketSignals.offerVolume)} />
        <Stat
          label="Highest offer"
          value={marketSignals.highestProposedRent != null ? formatInr(marketSignals.highestProposedRent) : "—"}
        />
        <Stat
          label="Average offer"
          value={marketSignals.averageProposedRent != null ? formatInr(marketSignals.averageProposedRent) : "—"}
        />
        <Stat
          label="Earliest move-in"
          value={marketSignals.earliestMoveInDate ?? "—"}
        />
      </section>

      {applicants.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {applicants.map((applicant) => (
            <li
              key={applicant.id}
              className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {applicant.applicantFullName ?? "Applicant"}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {[applicant.applicantCurrentCity, applicant.applicantEmployer].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  {STATUS_LABELS[applicant.status]}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <DetailField label="Proposed rent">
                  {formatInr(Number(applicant.proposedRent))}
                  <span
                    className={
                      applicant.rentVariancePct >= 0
                        ? "ml-1 text-emerald-600 dark:text-emerald-500"
                        : "ml-1 text-amber-600"
                    }
                  >
                    ({applicant.rentVariancePct >= 0 ? "+" : ""}
                    {applicant.rentVariancePct}%)
                  </span>
                </DetailField>
                <DetailField label="Move-in">{applicant.moveInDate}</DetailField>
                <DetailField label="Income / rent ratio">
                  {applicant.incomeToRentRatio != null ? `${applicant.incomeToRentRatio}×` : "Not provided"}
                </DetailField>
                <DetailField label="Prior KYC">
                  {applicant.applicantKycStatus ? KYC_LABELS[applicant.applicantKycStatus] : "—"}
                </DetailField>
              </dl>

              {applicant.profileHighlights && (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{applicant.profileHighlights}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-900">
                {applicant.status === "under_review" && (
                  <>
                    <form action={requestApplicationKyc}>
                      <input type="hidden" name="application_id" value={applicant.id} />
                      <input type="hidden" name="listing_id" value={listing.id} />
                      <button
                        type="submit"
                        className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
                      >
                        Request KYC
                      </button>
                    </form>
                    <RejectButton applicationId={applicant.id} listingId={listing.id} />
                  </>
                )}

                {applicant.status === "kyc_requested" && (
                  <>
                    {applicant.intakeLinkId && (
                      <span className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        KYC link:
                        <InviteLinkActions url={`${SITE_URL}/join/${applicant.intakeLinkId}`} />
                      </span>
                    )}
                    <ApproveButton applicationId={applicant.id} listingId={listing.id} />
                    <RejectButton applicationId={applicant.id} listingId={listing.id} />
                  </>
                )}

                {applicant.status === "approved" && (
                  <p className="text-sm text-emerald-600 dark:text-emerald-500">
                    Approved — once they submit documents via the KYC link, you can create a lease for
                    them from{" "}
                    <Link href="/dashboard/tenants" className="underline">
                      Tenants
                    </Link>
                    .
                  </p>
                )}
              </div>

              <div className="mt-4">
                <MessageThread
                  applicationId={applicant.id}
                  listingId={listing.id}
                  messages={messagesByApplicant.get(applicant.id) ?? []}
                  viewerRole="owner"
                  counterpartyName={applicant.applicantFullName ?? undefined}
                  sendAction={sendApplicationMessage}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No applications yet.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-50">{children}</dd>
    </div>
  );
}

function ApproveButton({ applicationId, listingId }: { applicationId: string; listingId: string }) {
  return (
    <form action={decideApplication}>
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="listing_id" value={listingId} />
      <input type="hidden" name="status" value="approved" />
      <button
        type="submit"
        className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Approve
      </button>
    </form>
  );
}

function RejectButton({ applicationId, listingId }: { applicationId: string; listingId: string }) {
  return (
    <form action={decideApplication}>
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="listing_id" value={listingId} />
      <input type="hidden" name="status" value="rejected" />
      <button type="submit" className="text-sm text-red-600 hover:underline">
        Reject
      </button>
    </form>
  );
}
