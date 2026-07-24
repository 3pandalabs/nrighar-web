import { formatInr } from "@/lib/currency";
import type { OwnApplication, PublicListing } from "@/lib/types";
import { apiFetch } from "@/lib/api/client";
import { submitListingApplication } from "../actions";

const STATUS_LABELS: Record<OwnApplication["status"], string> = {
  under_review: "Under review",
  kyc_requested: "KYC requested — check for a link from the owner",
  approved: "Approved",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
};

const PROPERTY_TYPE_LABELS: Record<PublicListing["propertyType"], string> = {
  apartment: "Apartment / Flat",
  independent_house: "Independent house",
  villa: "Villa",
  plot: "Plot / Land",
  commercial: "Commercial",
};

export default async function TenantListingsPage() {
  const [listings, applications] = await Promise.all([
    apiFetch("/listings/browse") as Promise<PublicListing[]>,
    apiFetch("/applications") as Promise<OwnApplication[]>,
  ]);

  const activeApplicationByListing = new Map(
    (applications ?? [])
      .filter((a) => a.status === "under_review" || a.status === "kyc_requested")
      .map((a) => [a.listingId, a]),
  );

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Browse listings</h1>

      {listings && listings.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {listings.map((listing) => {
            const activeApplication = activeApplicationByListing.get(listing.id);
            return (
              <li
                key={listing.id}
                className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-start justify-between">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{listing.title}</h2>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs capitalize text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    {PROPERTY_TYPE_LABELS[listing.propertyType]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {listing.city}, {listing.state}
                </p>
                <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {formatInr(Number(listing.baseRentAsk))} / month asking
                </p>

                {activeApplication ? (
                  <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-500">
                    Applied — {STATUS_LABELS[activeApplication.status]}
                  </p>
                ) : (
                  <form action={submitListingApplication} className="mt-4 flex flex-col gap-3">
                    <input type="hidden" name="listing_id" value={listing.id} />
                    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Your proposed rent (₹ / month)
                      <input
                        name="proposed_rent"
                        type="number"
                        min="1"
                        step="1"
                        required
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Move-in date
                      <input
                        name="move_in_date"
                        type="date"
                        required
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Monthly income (₹, optional)
                      <input
                        name="monthly_income"
                        type="number"
                        min="0"
                        step="1"
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      A few lines about yourself (optional)
                      <textarea
                        name="profile_highlights"
                        rows={2}
                        maxLength={2000}
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </label>
                    <button
                      type="submit"
                      className="self-start rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
                    >
                      Apply
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No open listings right now — check back later.</p>
      )}

      {applications && applications.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">My applications</h2>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {applications.map((application) => (
              <li key={application.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {application.propertyNickname}
                  </span>
                  <span className="ml-3 text-zinc-500">
                    {formatInr(Number(application.proposedRent))} / month · {application.propertyCity}
                  </span>
                </span>
                <span
                  className={
                    application.status === "approved"
                      ? "text-emerald-600 dark:text-emerald-500"
                      : application.status === "rejected" || application.status === "withdrawn"
                        ? "text-zinc-400"
                        : "text-amber-600"
                  }
                >
                  {STATUS_LABELS[application.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
