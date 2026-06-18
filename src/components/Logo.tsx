import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

/** Wordmark + savings mark (a downward cost arrow). */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <Link to="/" className={cn('inline-flex items-center gap-2.5 group', className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 7l5.5 5.5L13 9l7 7M20 16h-4M20 16v-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {withText && (
        <span className="font-display text-[1.15rem] font-medium tracking-tight text-foreground">
          SaveMyTokens
        </span>
      )}
    </Link>
  )
}
