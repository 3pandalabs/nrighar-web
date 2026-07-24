import type { ApplicationMessage } from "@/lib/types";

// Async, not real-time — messages appear on the next page load/revalidate,
// same as every other mutation in this app. Shared between the owner's
// listing-detail page and the tenant's applications list; only the labels
// and the revalidate target (via listingId, passed as a hidden field so the
// server action knows which owner page to revalidate) differ per side.
export function MessageThread({
  applicationId,
  listingId,
  messages,
  viewerRole,
  counterpartyName,
  sendAction,
}: {
  applicationId: string;
  listingId?: string;
  messages: ApplicationMessage[];
  viewerRole: "owner" | "tenant";
  counterpartyName?: string;
  sendAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Messages{messages.length > 0 ? ` (${messages.length})` : ""}
      </summary>
      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        {messages.length > 0 ? (
          <ul className="mb-4 flex flex-col gap-3">
            {messages.map((m) => {
              const isMine = m.senderRole === viewerRole;
              const label = isMine ? "You" : (counterpartyName ?? (m.senderRole === "owner" ? "Owner" : "Tenant"));
              return (
                <li key={m.id} className={isMine ? "text-right" : "text-left"}>
                  <p className="text-xs text-zinc-500">
                    {label} · {new Date(m.createdAt).toLocaleString()}
                  </p>
                  <p
                    className={
                      "mt-1 inline-block max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm " +
                      (isMine
                        ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50")
                    }
                  >
                    {m.body}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-zinc-500">No messages yet — ask a question below.</p>
        )}
        <form action={sendAction} className="flex gap-2">
          <input type="hidden" name="application_id" value={applicationId} />
          {listingId && <input type="hidden" name="listing_id" value={listingId} />}
          <input
            name="body"
            placeholder="Write a message..."
            required
            maxLength={4000}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Send
          </button>
        </form>
      </div>
    </details>
  );
}
