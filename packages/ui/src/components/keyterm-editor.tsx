"use client"

import { useRef, useState } from "react"
import { Plus, RotateCcw, Upload, X } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Label } from "@ui/lib/ui/label"
import { cn } from "@ui/lib/utils"
import { DEFAULT_KEYTERMS, parseKeyterms, validateKeyterms } from "@transcription"

interface KeytermEditorProps {
  /** Absent means the committed default list is in use. */
  value?: string[]
  /** Called with the terms, or undefined to fall back to the default. */
  onChange: (terms: string[] | undefined) => void
}

/** Alphabetical, case-insensitive — the list is a set, so display order is ours to choose. */
function sortTerms(terms: string[]): string[] {
  return [...terms].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}

/**
 * Editor for the Deepgram keyterm vocabulary: one pill per term, one field to
 * add.
 *
 * Over-budget lists are rejected here rather than at capture time — Deepgram
 * errors the whole transcription request when the vocabulary is too long, and
 * that failure would surface mid-consultation pointing nowhere near Settings.
 */
export function KeytermEditor({ value, onChange }: KeytermEditorProps) {
  const usingDefault = value === undefined
  const terms = sortTerms(value ?? [...DEFAULT_KEYTERMS])
  const [draft, setDraft] = useState("")
  const [duplicate, setDuplicate] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validation = validateKeyterms(terms)

  const commit = (next: string[]) => onChange(sortTerms(next))

  /** Accepts one term or several pasted at once (newline- or comma-separated). */
  const addDraft = () => {
    const additions = parseKeyterms(draft.replace(/,/g, "\n"))
    if (additions.length === 0) return

    const existing = new Set(terms.map((t) => t.toLowerCase()))
    const fresh = additions.filter((t) => !existing.has(t.toLowerCase()))

    if (fresh.length === 0) {
      setDuplicate(additions[0])
      setDraft("")
      return
    }
    setDuplicate("")
    setDraft("")
    commit([...terms, ...fresh])
  }

  const removeTerm = (term: string) => {
    commit(terms.filter((t) => t !== term))
  }

  const readFile = async (file: File) => {
    // Replaces the list: importing a vocabulary file means "use this one".
    const contents = await file.text()
    setDuplicate("")
    commit(parseKeyterms(contents))
  }

  return (
    <div className="space-y-3">
      <Label className="text-base font-medium text-foreground">Transcription vocabulary</Label>
      <p className="text-sm text-muted-foreground">
        Terms the scribe should listen for — drug names and clinical words it tends to mishear. Applies to
        every consultation, so keep it the same across testers if you are comparing recordings.
      </p>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setDuplicate("")
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addDraft()
            }
          }}
          placeholder="Add a term, e.g. amoxicillin"
          aria-label="Add a term to the transcription vocabulary"
          className="h-10 flex-1 rounded-xl border-border bg-background"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addDraft}
          disabled={!draft.trim()}
          className="h-10 shrink-0 rounded-xl px-4"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          <span className="text-sm">Add</span>
        </Button>
      </div>

      {duplicate && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{duplicate}</span> is already in the list.
        </p>
      )}

      {terms.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No terms. The scribe transcribes without a vocabulary hint.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {terms.map((term) => (
            <span
              key={term}
              className="group inline-flex items-center gap-1 rounded-full border border-border bg-secondary py-1 pl-3 pr-1 text-xs text-foreground"
            >
              {term}
              <button
                type="button"
                onClick={() => removeTerm(term)}
                aria-label={`Remove ${term}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn("text-xs", validation.ok ? "text-muted-foreground" : "font-medium text-destructive")}
        >
          {terms.length} {terms.length === 1 ? "term" : "terms"} · about {validation.tokens} of{" "}
          {validation.budget} tokens
          {usingDefault ? " · default list" : ""}
        </span>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) void readFile(file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="h-8 rounded-full px-3"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            <span className="text-xs">Import .txt</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDuplicate("")
              onChange(undefined)
            }}
            disabled={usingDefault}
            className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            <span className="text-xs">Reset to default</span>
          </Button>
        </div>
      </div>

      {!validation.ok && <p className="text-xs font-medium text-destructive">{validation.error}</p>}
    </div>
  )
}
