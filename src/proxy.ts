import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE, AUTH_ENABLED, AUTH_MISCONFIG, verifySession } from "@/lib/auth";

/**
 * Shared-password gate (Next 16 `proxy`, nodejs runtime). Active only when
 * `APP_PASSWORD` is set. Redirects unauthenticated requests to `/login`; lets
 * the login page + auth API through.
 */
export async function proxy(req: NextRequest) {
  // Fail CLOSED in production when the gate isn't configured securely, rather
  // than silently serving an unauthenticated app. `AUTH_MISCONFIG` is only ever
  // non-null in production (dev stays frictionless).
  if (AUTH_MISCONFIG) {
    return NextResponse.json(
      { error: `Server auth misconfigured: ${AUTH_MISCONFIG}` },
      { status: 503 }
    );
  }
  if (!AUTH_ENABLED) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (await verifySession(cookie)) {
    return NextResponse.next();
  }

  // API calls get a 401; page navigations get redirected to the login screen.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals + static assets. Static image files
  // (e.g. /rantai-logo.png) must be excluded too — otherwise the gate 307-redirects
  // them to /login, so the Image optimizer fetches HTML instead of a PNG ("not a
  // valid image") and the login screen's own logo can't load pre-auth.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|ico|webp)).*)"],
};
