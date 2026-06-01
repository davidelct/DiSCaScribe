"use client"
import { Mic } from "lucide-react"

interface IdleViewProps {
  onStartNew: () => void
}

export function IdleView({ onStartNew }: IdleViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="animate-fade-up flex flex-col items-center">
        <button
          onClick={onStartNew}
          aria-label="Start a new encounter"
          className="group relative mb-9 flex h-24 w-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lifted outline-none transition-transform duration-300 hover:scale-105 focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-95"
        >
          {/* soft halo that grows on hover */}
          <span className="absolute inset-0 rounded-full bg-primary/20 blur-xl transition-opacity duration-300 group-hover:opacity-100 opacity-60" />
          <span className="absolute -inset-3 rounded-full border border-primary/15 transition-all duration-500 group-hover:-inset-4 group-hover:border-primary/25" />
          <Mic className="relative h-9 w-9" />
        </button>

        <h2 className="font-display mb-3 text-3xl font-medium tracking-tight text-foreground">
          Start a new encounter
        </h2>

        <p className="max-w-xs text-center text-sm leading-relaxed text-muted-foreground text-balance">
          Record, transcribe, and generate a structured clinical note — automatically.
        </p>
      </div>
    </div>
  )
}
