import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE, AUTH_ENABLED, verifySession } from "@/lib/auth";

/**
 * Shared-password gate (Next 16 `proxy`, nodejs runtime). Active only when
 * `APP_PASSWORD` is set. Redirects unauthenticated requests to `/login`; lets
 * the login page + auth API through.
 */
export async function proxy(req: NextRequest) {
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
  // (e.g. /nq-logo.png) must be excluded too — otherwise the gate 307-redirects
  // them to /login, so the Image optimizer fetches HTML instead of a PNG ("not a
  // valid image") and the login screen's own logo can't load pre-auth.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|ico|webp)).*)"],
};
