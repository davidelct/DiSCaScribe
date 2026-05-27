"use client"

import { type ReactNode, useMemo } from "react"
import { cn } from "@ui/lib/utils"

/**
 * Dependency-free markdown renderer for clinical notes, styled in the
 * Clinical Calm system. Builds React nodes (never dangerouslySetInnerHTML),
 * so note content cannot inject markup. Handles the constructs clinical
 * notes actually use: ATX headings, paragraphs, ordered/unordered lists,
 * horizontal rules, and inline bold / italic / code.
 */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "hr" }

const HEADING = /^(#{1,6})\s+(.*)$/
const UL_ITEM = /^\s*[-*+]\s+(.*)$/
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/
const HR = /^\s*([-*_])\1{2,}\s*$/

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []
  let para: string[] = []

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "paragraph", text: para.join(" ").trim() })
      para = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!line.trim()) {
      flushPara()
      continue
    }
    if (HR.test(line)) {
      flushPara()
      blocks.push({ type: "hr" })
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      flushPara()
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() })
      continue
    }
    const ul = line.match(UL_ITEM)
    if (ul) {
      flushPara()
      const items: string[] = [ul[1]]
      while (i + 1 < lines.length && UL_ITEM.test(lines[i + 1])) {
        items.push(lines[++i].match(UL_ITEM)![1])
      }
      blocks.push({ type: "ul", items })
      continue
    }
    const ol = line.match(OL_ITEM)
    if (ol) {
      flushPara()
      const items: string[] = [ol[1]]
      while (i + 1 < lines.length && OL_ITEM.test(lines[i + 1])) {
        items.push(lines[++i].match(OL_ITEM)![1])
      }
      blocks.push({ type: "ol", items })
      continue
    }
    para.push(line.trim())
  }
  flushPara()
  return blocks
}

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*?)\*)/g

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[2] !== undefined || m[3] !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold text-foreground">
          {m[2] ?? m[3]}
        </strong>,
      )
    } else if (m[4] !== undefined) {
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
          {m[4]}
        </code>,
      )
    } else if (m[5] !== undefined || m[6] !== undefined) {
      nodes.push(
        <em key={key++} className="italic">
          {m[5] ?? m[6]}
        </em>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

const HEADING_CLASS: Record<number, string> = {
  1: "font-display text-[1.7rem] font-medium tracking-tight text-foreground",
  2: "font-display text-xl font-medium tracking-tight text-foreground mt-8 mb-3 border-b border-border pb-2",
  3: "font-display text-base font-semibold text-foreground mt-6 mb-2",
  4: "text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-5 mb-1.5",
}

export function MarkdownNote({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(source), [source])

  if (!source.trim()) {
    return <p className="text-sm text-muted-foreground">This note is empty.</p>
  }

  return (
    <div className={cn("[&>*:first-child]:mt-0", className)}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading": {
            const Tag = (`h${Math.min(block.level, 6)}`) as "h1"
            return (
              <Tag key={i} className={HEADING_CLASS[block.level] ?? HEADING_CLASS[4]}>
                {renderInline(block.text)}
              </Tag>
            )
          }
          case "paragraph":
            return (
              <p key={i} className="my-3 text-[0.95rem] leading-7 text-foreground/85">
                {renderInline(block.text)}
              </p>
            )
          case "ul":
            return (
              <ul key={i} className="my-3 space-y-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-[0.95rem] leading-7 text-foreground/85">
                    <span className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            )
          case "ol":
            return (
              <ol key={i} className="my-3 space-y-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-[0.95rem] leading-7 text-foreground/85">
                    <span className="mt-px shrink-0 font-mono text-sm font-medium tabular-nums text-primary">
                      {j + 1}.
                    </span>
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            )
          case "hr":
            return <hr key={i} className="my-7 border-border" />
        }
      })}
    </div>
  )
}
