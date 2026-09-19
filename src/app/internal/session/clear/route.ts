import { NextResponse } from "next/server";
import { getIdentityRuntime } from "@/lib/auth/runtime";
import { sessionCookieName, sessionCookieOptions } from "@/lib/auth/cookies";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";

export async function POST(request: Request) {
  const runtime = await getIdentityRuntime();
  try { assertTrustedMutationOrigin(request.headers.get("origin"), runtime.environment); } catch { return new NextResponse(null, { status: 403 }); }
  const name = sessionCookieName(runtime.environment);
  const token = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!token || await runtime.sessions.validate(token, { allowRotation: false })) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(name, "", sessionCookieOptions(runtime.environment));
  return response;
}
