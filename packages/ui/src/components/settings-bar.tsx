"use client"

import { Settings } from "lucide-react"
import { Button } from "@ui/lib/ui/button"

interface SettingsBarProps {
  onOpenSettings: () => void
}

export function SettingsBar({ onOpenSettings }: SettingsBarProps) {
  return (
    <div className="shrink-0 border-t border-sidebar-border bg-sidebar p-3">
      <Button
        variant="ghost"
        onClick={onOpenSettings}
        className="group w-full justify-start gap-3 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      >
        <Settings className="h-4 w-4 transition-transform duration-500 group-hover:rotate-45" />
        <span>Settings</span>
      </Button>
    </div>
  )
}
