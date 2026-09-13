"use client"

/**
 * Shared EPR chrome: brand, the three top-level tabs (patients,
 * consultations, stimulated recall) and the settings page link. Being on
 * every page, it also runs the once-per-load audit log housekeeping.
 */

import { useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AudioLines, ClipboardList, MessageSquareQuote, Settings, Users, type LucideIcon } from "lucide-react"
import { cn } from "@ui/lib/utils"
import { initializeAuditLog } from "@storage"

/**
 * Which tab a route belongs to. The chart sits under Patients, the workspace
 * under Consultations and a recall interview under Stimulated recall, so the
 * active tab tells the clinician which list "back" returns to.
 */
function navTabs(pathname: string): Array<{ href: string; label: string; icon: LucideIcon; active: boolean }> {
  return [
    { href: "/", label: "Patients", icon: Users, active: pathname === "/" || pathname.startsWith("/patients") },
    {
      href: "/consultations",
      label: "Consultations",
      icon: ClipboardList,
      active: pathname.startsWith("/consultations"),
    },
    {
      href: "/recall",
      label: "Stimulated recall",
      icon: MessageSquareQuote,
      active: pathname.startsWith("/recall"),
    },
  ]
}

const TAB =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 transition-colors hover:bg-accent hover:text-foreground"

export function TopBar() {
  const pathname = usePathname() ?? "/"

  useEffect(() => {
    // The top bar is on every page, so this runs once per page load:
    // cleans up expired audit entries and schedules periodic cleanup.
    void initializeAuditLog()
  }, [])

  const settingsActive = pathname.startsWith("/settings")

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-card/70 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-soft">
              <AudioLines className="h-4 w-4" />
            </span>
            <span className="font-display text-lg font-medium tracking-tight text-foreground">DiSCaScribe</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {navTabs(pathname).map((tab) => {
              const Icon = tab.icon
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={tab.active ? "page" : undefined}
                  className={cn(TAB, tab.active ? "bg-accent font-medium text-foreground" : "text-muted-foreground")}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
        <Link
          href="/settings"
          aria-current={settingsActive ? "page" : undefined}
          className={cn(TAB, "text-sm", settingsActive ? "bg-accent font-medium text-foreground" : "text-muted-foreground")}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </header>
  )
}
