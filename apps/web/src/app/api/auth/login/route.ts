import { NextRequest, NextResponse } from "next/server"
import { AUTH_COOKIE, SESSION_MAX_AGE_SECONDS, gateEnabled, roleForPassword, sanitizeNext, sessionToken } from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const password = String(form.get("password") ?? "")
  const next = sanitizeNext(String(form.get("next") ?? "/"))

  // Reject when the gate is misconfigured or the password matches no role.
  const role = gateEnabled() ? roleForPassword(password) : null
  if (!role) {
    const fail = new URL("/login", req.nextUrl.origin)
    fail.searchParams.set("error", "1")
    if (next !== "/") fail.searchParams.set("next", next)
    return NextResponse.redirect(fail, 303)
  }

  // The cookie is the hash of the password that matched, so it carries the
  // role implicitly (sessionRole() re-derives it on every request).
  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), 303)
  res.cookies.set(AUTH_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return res
}
