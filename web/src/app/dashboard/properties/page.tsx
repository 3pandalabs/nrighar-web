import Link from "next/link";
import { apiFetch } from "@/lib/api/client";
import type { Lease, Property, Tenant } from "@/lib/types";
import { addProperty } from "../actions";

const PROPERTY_TYPES = [
  ["apartment", "Apartment / Flat"],
  ["independent_house", "Independent house"],
  ["villa", "Villa"],
  ["plot", "Plot / Land"],
  ["commercial", "Commercial"],
] as const;

export default async function PropertiesPage() {
  const [properties, allLeases, tenants] = await Promise.all([
    apiFetch("/properties") as Promise<Property[]>,
    apiFetch("/leases") as Promise<Lease[]>,
    apiFetch("/tenants") as Promise<Tenant[]>,
  ]);

  const leases = (allLeases ?? []).filter((l) => l.status === "active");
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));
  const activeLeaseByProperty = new Map(leases.map((l) => [l.propertyId, l]));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Properties</h1>

      {properties && properties.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {properties.map((property) => {
            const lease = activeLeaseByProperty.get(property.id);
            const tenant = lease ? tenantById.get(lease.tenantId) : undefined;
            return (
              <li key={property.id}>
                <Link
                  href={`/dashboard/properties/${property.id}`}
                  className="block rounded-2xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                >
                  <div className="flex items-start justify-between">
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                      {property.nickname}
                    </h2>
                    <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs capitalize text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                      {property.bedrooms ? `${property.bedrooms}BHK · ` : ""}
                      {property.propertyType.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {property.addressLine1}, {property.city}, {property.state} {property.pincode}
                  </p>
                  <p className="mt-3 text-sm">
                    {lease ? (
                      <span className="text-emerald-600 dark:text-emerald-500">
                        Rented to {tenant?.fullName ?? "tenant"}
                      </span>
                    ) : (
                      <span className="text-zinc-500">Vacant</span>
                    )}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No properties yet — add your first one below.</p>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add a property</h2>
        <form action={addProperty} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field name="nickname" label="Nickname" placeholder="e.g. Pune 2BHK" required />
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Type
            <select
              name="property_type"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal dark:border-zinc-700 dark:bg-zinc-900"
            >
              {PROPERTY_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Field name="address_line1" label="Address line 1" required />
          <Field name="address_line2" label="Address line 2" />
          <Field name="city" label="City" required />
          <Field name="state" label="State" required />
          <Field name="pincode" label="PIN code" required />
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Bedrooms (BHK)
            <input
              name="bedrooms"
              type="number"
              min="1"
              step="1"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <Field name="notes" label="Notes" />
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
            >
              Add property
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
      {label}
      <input
        name={name}
        placeholder={placeholder}
        required={required}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal dark:border-zinc-700 dark:bg-zinc-900"
      />
    </label>
  );
}
