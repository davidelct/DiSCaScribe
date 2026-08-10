import { cn } from "@ui/lib/utils"

/**
 * A loading placeholder.
 *
 * Use it to hold the shape of content that is on its way — same box, same
 * rhythm — so the real thing fades in rather than shoving the layout around.
 * A skeleton that doesn't match what replaces it is worse than a spinner.
 *
 * Decorative by definition, so it is hidden from assistive tech; announce the
 * pending state on the surrounding region instead.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("skeleton rounded-lg", className)} {...props} />
}
