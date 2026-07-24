import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const {
  submitApplication,
  listOwnApplications,
  getListingApplications,
  requestKycForApplication,
  decideApplication,
  listApplicationMessages,
  sendApplicationMessage,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 3 },
});

export const submitApplicationWorkflow = (input: Parameters<typeof submitApplication>[0]) =>
  submitApplication(input);
export const listOwnApplicationsWorkflow = (input: Parameters<typeof listOwnApplications>[0]) =>
  listOwnApplications(input);
export const getListingApplicationsWorkflow = (input: Parameters<typeof getListingApplications>[0]) =>
  getListingApplications(input);
export const requestKycForApplicationWorkflow = (input: Parameters<typeof requestKycForApplication>[0]) =>
  requestKycForApplication(input);
export const decideApplicationWorkflow = (input: Parameters<typeof decideApplication>[0]) =>
  decideApplication(input);
export const listApplicationMessagesWorkflow = (input: Parameters<typeof listApplicationMessages>[0]) =>
  listApplicationMessages(input);
export const sendApplicationMessageWorkflow = (input: Parameters<typeof sendApplicationMessage>[0]) =>
  sendApplicationMessage(input);
