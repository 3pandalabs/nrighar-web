import Link from "next/link";
import { redirect } from "next/navigation";
import { apiFetch, apiGetCurrentUser } from "@/lib/api/client";
import { formatApprox, formatInr, getRateFromInr } from "@/lib/currency";
import type { Lease, Profile, Property, RentPayment, Tenant } from "@/lib/types";

export default async function OverviewPage() {
  const user = await apiGetCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [profile, properties, tenants, allLeases, allPayments] = await Promise.all([
    apiFetch("/profile").catch(() => null) as Promise<Profile | null>,
    apiFetch("/properties") as Promise<Property[]>,
    apiFetch("/tenants") as Promise<Tenant[]>,
    apiFetch("/leases") as Promise<Lease[]>,
    apiFetch("/rent-payments") as Promise<RentPayment[]>,
  ]);

  const currency = profile?.preferredCurrency ?? "USD";
  const rate = await getRateFromInr(currency);

  const activeLeases = (allLeases ?? []).filter((l) => l.status === "active");
  const monthPayments = (allPayments ?? []).filter(
    (p) => p.periodYear === year && p.periodMonth === month
  );
  const expected = activeLeases.reduce((sum, l) => sum + Number(l.rentAmount), 0);
  const collected = monthPayments.reduce((sum, p) => sum + Number(p.amountPaid ?? 0), 0);
  const paidLeaseIds = new Set(monthPayments.filter((p) => p.status === "paid").map((p) => p.leaseId));
  const pendingLeases = activeLeases.filter((l) => !paidLeaseIds.has(l.id));
  const propertyById = new Map((properties ?? []).map((p) => [p.id, p]));
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));

  const monthName = now.toLocaleString("en-US", { month: "long" });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {profile?.displayName ? `Namaste, ${profile.displayName}` : "Namaste"}
        </h1>
        <p className="text-sm text-zinc-500">
          {monthName} {year} at a glance
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Properties" value={String(properties?.length ?? 0)} />
        <StatCard
          label={`Rent expected (${monthName})`}
          value={formatInr(expected)}
          sub={formatApprox(expected, currency, rate) ?? undefined}
        />
        <StatCard
          label={`Rent collected (${monthName})`}
          value={formatInr(collected)}
          sub={formatApprox(collected, currency, rate) ?? undefined}
        />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Awaiting rent this month
        </h2>
        {pendingLeases.length > 0 ? (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {pendingLeases.map((lease) => {
              const property = propertyById.get(lease.propertyId);
              const tenant = tenantById.get(lease.tenantId);
              const overdue = now.getDate() > lease.rentDueDay;
              return (
                <li key={lease.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {property?.nickname ?? "Property"}
                    </span>{" "}
                    <span className="text-zinc-500">— {tenant?.fullName ?? "Tenant"}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span>{formatInr(Number(lease.rentAmount))}</span>
                    <span className={overdue ? "text-red-600" : "text-zinc-500"}>
                      {overdue ? `Overdue (due day ${lease.rentDueDay})` : `Due day ${lease.rentDueDay}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">
            {activeLeases.length > 0
              ? "All rent collected for this month. 🎉"
              : "No active leases yet — add a property, then create a lease from its page."}
          </p>
        )}
      </section>

      {(properties?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            Start by adding your first property in India.
          </p>
          <Link
            href="/dashboard/properties"
            className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Add a property
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
