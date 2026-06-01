import type { Metadata } from "next"
import { sanitizeNext } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Sign in · DiSCaScribe",
}

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const hasError = firstValue(params.error) === "1"
  const next = sanitizeNext(firstValue(params.next))

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div
        className="w-full max-w-sm rounded-[var(--radius)] border border-border bg-card p-8"
        style={{ boxShadow: "var(--shadow-lifted)" }}
      >
        <div className="flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="DiSCaScribe" width={56} height={56} className="mb-5" />
          <h1 className="font-serif text-2xl font-semibold tracking-tight">DiSCaScribe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the access password to continue.
          </p>
        </div>

        <form method="POST" action="/api/auth/login" className="mt-7 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password" className="sr-only">
            Access password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            required
            placeholder="Access password"
            className="w-full rounded-[calc(var(--radius)-0.35rem)] border border-border bg-input px-3.5 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/40"
          />

          {hasError ? (
            <p className="text-sm text-destructive" role="alert">
              Incorrect password. Please try again.
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-1 w-full rounded-[calc(var(--radius)-0.35rem)] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 active:opacity-100"
          >
            Enter
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Demo environment — for synthetic data only.
        </p>
      </div>
    </main>
  )
}
