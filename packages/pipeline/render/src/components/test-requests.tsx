"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { NoteArchiveStatus, TestRequest } from "@storage/types"
import { TEST_CATALOGUE, applyTestSelection, searchCatalogue } from "@pipeline-errors"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { cn } from "@ui/lib/utils"
import { Check, FlaskConical, Loader2, Search, X } from "lucide-react"
import { CARD, CARD_BODY, CARD_HEAD } from "./note-parts"

/**
 * Test requests, the same in both arms: a card listing what has been
 * requested, open at any point in the consultation (before, during or after
 * the recording), and a request screen laid out like a GP system's, the
 * catalogue's groups side by side with a tick per test. The card's chips
 * remove a single test in place; the request screen saves its ticks as a
 * whole. Filing the note locks the requests with the rest of the
 * consultation.
 */

const ARCHIVE_TITLES: Record<NoteArchiveStatus, string> = {
  pending: "Saving the requests to the archive…",
  archived: "The requests are saved to the archive",
  failed: "Archiving the requests failed; they are saved again with the next change",
  skipped: "Archiving not configured — stored locally only",
}

function ArchiveMark({ status }: { status?: NoteArchiveStatus }) {
  if (!status || status === "skipped") return null
  return (
    <span title={ARCHIVE_TITLES[status]} className="inline-flex items-center">
      {status === "pending" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
      {status === "archived" && <Check className="h-3 w-3 text-success" />}
      {status === "failed" && <X className="h-3 w-3 text-destructive" />}
    </span>
  )
}

/** The requests in the order they were laid out, gathered under their groups. */
function groupRequests(requests: TestRequest[]): Array<{ group: string; requests: TestRequest[] }> {
  const groups: Array<{ group: string; requests: TestRequest[] }> = []
  for (const request of requests) {
    const last = groups.at(-1)
    if (last?.group === request.group) last.requests.push(request)
    else groups.push({ group: request.group, requests: [request] })
  }
  return groups
}

export function TestRequestsCard({
  requests,
  locked,
  archiveStatus,
  onSave,
}: {
  requests: TestRequest[]
  /** True once the note is filed: the requests are shown, not changed. */
  locked: boolean
  archiveStatus?: NoteArchiveStatus
  onSave: (requests: TestRequest[]) => void
}) {
  const [picking, setPicking] = useState(false)
  const grouped = groupRequests(requests)

  return (
    <section className={CARD}>
      <div className={CARD_HEAD}>
        <h2 className={cn("text-sm font-semibold", requests.length ? "text-foreground" : "text-muted-foreground")}>
          Tests
        </h2>
        <span className="text-xs text-muted-foreground">
          {requests.length ? `${requests.length} requested` : locked ? "None requested" : ""}
        </span>
        <ArchiveMark status={requests.length || archiveStatus === "failed" ? archiveStatus : undefined} />
        {!locked && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPicking(true)}
            className="ml-auto h-8 rounded-md px-3"
          >
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
            <span className="text-xs">{requests.length ? "Change tests" : "Request tests"}</span>
          </Button>
        )}
      </div>
      {requests.length > 0 && (
        <div className={cn(CARD_BODY, "space-y-2")}>
          {grouped.map(({ group, requests: inGroup }) => (
            <div key={group} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <span className="w-52 shrink-0 text-xs text-muted-foreground">{group}</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {inGroup.map((request) => (
                  <span
                    key={request.id}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background pl-2.5 pr-1 text-xs text-foreground"
                  >
                    {request.name}
                    {locked ? (
                      <span className="w-1.5" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSave(requests.filter((r) => r.id !== request.id))}
                        aria-label={`Remove ${request.name}`}
                        title="Remove this test"
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {picking && (
        <TestRequestDialog
          requests={requests}
          onCancel={() => setPicking(false)}
          onSave={(next) => {
            setPicking(false)
            onSave(next)
          }}
        />
      )}
    </section>
  )
}

function TestRequestDialog({
  requests,
  onCancel,
  onSave,
}: {
  requests: TestRequest[]
  onCancel: () => void
  onSave: (requests: TestRequest[]) => void
}) {
  const [selected, setSelected] = useState(() => new Set(requests.map((request) => request.id)))
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const groups = useMemo(() => searchCatalogue(query), [query])
  const total = TEST_CATALOGUE.reduce((count, group) => count + group.tests.length, 0)

  // Escape cancels, as the backdrop does. Read through a ref so the listener
  // is set once rather than on every render's new callback.
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  useEffect(() => {
    searchRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const changed =
    selected.size !== requests.length || requests.some((request) => !selected.has(request.id))

  // Portalled to the body, so no scrolling or transformed ancestor can clip it.
  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-request-title"
        className="animate-scale-in flex h-[min(88vh,820px)] w-full max-w-6xl flex-col rounded-md border border-border bg-card shadow-lifted surface"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-6 py-4">
          <h2 id="test-request-title" className="font-display text-xl font-medium tracking-tight text-foreground">
            Request tests
          </h2>
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${total} tests`}
              aria-label="Search tests"
              className="h-9 rounded-md pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 w-8 rounded-md p-0 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tests match “{query.trim()}”.</p>
          ) : (
            <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
              {groups.map((group) => (
                <fieldset key={group.name} className="mb-6 break-inside-avoid">
                  <legend className="mb-2 w-full border-b border-primary/30 pb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                    {group.name}
                  </legend>
                  {group.tests.map((test) => (
                    <label
                      key={test.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                        selected.has(test.id) ? "font-medium text-foreground" : "text-foreground/90",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(test.id)}
                        onChange={() => toggle(test.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                      />
                      {test.name}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-6 py-3">
          <span className="text-sm text-muted-foreground">
            {selected.size ? `${selected.size} selected` : "No tests selected"}
          </span>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs font-medium text-primary hover:underline"
            >
              Clear
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onCancel} className="h-9 rounded-md px-4 text-muted-foreground">
              Cancel
            </Button>
            <Button
              onClick={() =>
                changed ? onSave(applyTestSelection(requests, selected, new Date().toISOString())) : onCancel()
              }
              className="h-9 rounded-md bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
