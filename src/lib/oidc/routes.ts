export function isIdentityNodeRoute(pathname: string): boolean {
  return pathname === "/health/live" || pathname === "/health/ready" || pathname === "/health/oidc" || pathname.startsWith("/interaction/") || isProviderRoute(pathname);
}

export function isProviderRoute(pathname: string): boolean {
  return pathname === "/authorize" || (pathname.startsWith("/authorize/") && pathname !== "/authorize/interaction") || pathname === "/token" || pathname === "/jwks" || pathname.startsWith("/.well-known/") || pathname.startsWith("/resume/");
}
