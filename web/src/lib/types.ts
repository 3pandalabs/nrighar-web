// Mirrors api/ROUTES.md response shapes (camelCase) — this API is now the
// source of truth for these shapes, not a Postgres/Supabase table anymore.

export type Profile = {
  id: string;
  displayName: string | null;
  countryOfResidence: string | null;
  preferredCurrency: string;
  upiVpa: string | null;
  upiName: string | null;
  role: "owner" | "tenant";
};

export type TenantProfile = {
  userId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  currentCity: string | null;
  employer: string | null;
  kycStatus: "pending" | "submitted" | "verified";
  createdAt: string;
};

export type TenantDocument = {
  id: string;
  tenantUserId: string;
  docType: "agreement" | "kyc" | "property_paper" | "tax" | "other";
  title: string;
  storagePath: string;
  createdAt: string;
};

export type ProfileShare = {
  id: string;
  tenantUserId: string;
  ownerId: string | null;
  status: "open" | "claimed" | "revoked";
  createdAt: string;
  claimedAt: string | null;
  revokedAt: string | null;
};

export type PayLink = {
  id: string;
  ownerId: string;
  leaseId: string;
  periodYear: number;
  periodMonth: number;
  amountDue: number;
  openedAt: string | null;
  claimedPaidAt: string | null;
  createdAt: string;
};

export type Property = {
  id: string;
  ownerId: string;
  nickname: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  propertyType: "apartment" | "independent_house" | "villa" | "plot" | "commercial";
  notes: string | null;
  createdAt: string;
};

export type Tenant = {
  id: string;
  ownerId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  kycStatus: "pending" | "submitted" | "verified";
  notes: string | null;
  tenantUserId: string | null;
  createdAt: string;
};

export type Lease = {
  id: string;
  ownerId: string;
  propertyId: string;
  tenantId: string;
  rentAmount: number;
  depositAmount: number | null;
  startDate: string;
  endDate: string | null;
  rentDueDay: number;
  status: "active" | "ended";
  createdAt: string;
};

export type RentPayment = {
  id: string;
  ownerId: string;
  leaseId: string;
  periodYear: number;
  periodMonth: number;
  amountDue: number;
  amountPaid: number | null;
  paidOn: string | null;
  method: "bank_transfer" | "upi" | "cash" | "other" | null;
  status: "due" | "paid" | "partial";
  notes: string | null;
};

export type IntakeLink = {
  id: string;
  ownerId: string;
  propertyId: string | null;
  status: "pending" | "submitted";
  tenantId: string | null;
  createdAt: string;
  submittedAt: string | null;
  expiresAt: string;
};

export type DocumentRow = {
  id: string;
  ownerId: string;
  propertyId: string | null;
  leaseId: string | null;
  docType: "agreement" | "kyc" | "property_paper" | "tax" | "other";
  title: string;
  storagePath: string;
  createdAt: string;
};
