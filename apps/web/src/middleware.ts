import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { AUTH_COOKIE, gateEnabled, isValidSession } from "@/lib/auth"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

function shouldSkipRedirect(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // The login page and auth endpoints must always be reachable.
  const isAuthPath = pathname === "/login" || pathname.startsWith("/api/auth/")

  // Shared-password gate. Engages only when DEMO_PASSWORD is configured, so
  // local development without the env var stays open.
  if (gateEnabled() && !isAuthPath) {
    const authed = await isValidSession(request.cookies.get(AUTH_COOKIE)?.value)
    if (!authed) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = "/login"
      loginUrl.search = ""
      if (pathname !== "/") {
        loginUrl.searchParams.set("next", pathname + request.nextUrl.search)
      }
      return NextResponse.redirect(loginUrl, 303)
    }
  }

  // Force HTTPS in production (skip localhost). Not applied to API routes so
  // large multipart uploads (final audio blobs) stay simple.
  if (process.env.NODE_ENV === "production" && !pathname.startsWith("/api/")) {
    const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
    const hostname = hostHeader.split(":")[0]?.toLowerCase() ?? ""
    if (!shouldSkipRedirect(hostname)) {
      const protocolHeader = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol
      const protocol = protocolHeader.split(",")[0]?.replace(":", "")
      if (protocol !== "https") {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.protocol = "https"
        redirectUrl.port = ""
        return NextResponse.redirect(redirectUrl, 308)
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  // Run on pages and API routes (so transcription/note endpoints are gated too),
  // but skip Next internals and static asset files (anything with a file extension).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
}
