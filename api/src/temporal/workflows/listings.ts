import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const { createListing, listOwnListings, browseOpenListings, closeListing } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 3 },
});

export const createListingWorkflow = (input: Parameters<typeof createListing>[0]) => createListing(input);
export const listOwnListingsWorkflow = (input: Parameters<typeof listOwnListings>[0]) => listOwnListings(input);
export const browseOpenListingsWorkflow = () => browseOpenListings();
export const closeListingWorkflow = (input: Parameters<typeof closeListing>[0]) => closeListing(input);
