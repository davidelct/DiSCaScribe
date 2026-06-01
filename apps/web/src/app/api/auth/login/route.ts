import { NextRequest, NextResponse } from "next/server"
import { AUTH_COOKIE, SESSION_MAX_AGE_SECONDS, gateEnabled, sanitizeNext, sessionToken } from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const password = String(form.get("password") ?? "")
  const next = sanitizeNext(String(form.get("next") ?? "/"))
  const expected = process.env.DEMO_PASSWORD?.trim() ?? ""

  // Reject when the gate is misconfigured or the password is wrong.
  if (!gateEnabled() || password !== expected) {
    const fail = new URL("/login", req.nextUrl.origin)
    fail.searchParams.set("error", "1")
    if (next !== "/") fail.searchParams.set("next", next)
    return NextResponse.redirect(fail, 303)
  }

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), 303)
  res.cookies.set(AUTH_COOKIE, await sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return res
}
