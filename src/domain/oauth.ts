export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  responseType: "code";
  scope: readonly string[];
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export function isExactRedirectUriAllowed(
  candidate: string,
  registeredUris: readonly string[],
): boolean {
  try {
    const parsed = new URL(candidate);
    if (parsed.hash) return false;
    return registeredUris.some((registered) => candidate === registered);
  } catch {
    return false;
  }
}
