import { NextRequest, NextResponse } from "next/server"
import { AUTH_COOKIE } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.nextUrl.origin), 303)
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 })
  return res
}
