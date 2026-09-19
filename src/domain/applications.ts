import type { IdentitySubject } from "./identity";

export type ApplicationId = string & { readonly __brand: "ApplicationId" };
export type ClientType = "confidential_web" | "public_native";
export type ApplicationVisibility = "internal" | "private";
export type MembershipStatus = "active" | "disabled";

export interface IdentityApplication {
  id: ApplicationId;
  slug: string;
  displayName: string;
  description: string;
  clientId: string;
  clientType: ClientType;
  /** Logical secret-manager reference; the client secret is never stored here. */
  clientSecretReference: string | null;
  visibility: ApplicationVisibility;
  redirectUris: readonly string[];
  postLogoutRedirectUris: readonly string[];
  firstParty: boolean;
  enabled: boolean;
  brand: { homeUrl: string; mark?: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationMembership {
  identitySubject: IdentitySubject;
  applicationId: ApplicationId;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Studio owns this mapping and its role/capability record. */
export interface StudioIdentityMapping {
  identitySubject: IdentitySubject;
  legacyStudioUserId: string;
  createdAt: Date;
  updatedAt: Date;
}
