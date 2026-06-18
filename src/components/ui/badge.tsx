import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-sunken text-muted border border-border',
        good: 'bg-good-soft text-good-ink',
        watch: 'bg-watch-soft text-watch-ink',
        risk: 'bg-risk-soft text-risk-ink',
        primary: 'bg-primary-soft text-primary-strong',
      },
      size: {
        sm: 'text-[0.68rem] px-2 py-1',
        md: 'text-xs px-2.5 py-1.5',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

const DOT_COLOR: Record<string, string> = {
  neutral: 'bg-faint',
  good: 'bg-good',
  watch: 'bg-watch',
  risk: 'bg-risk',
  primary: 'bg-primary',
}

export function Badge({ className, tone = 'neutral', size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span className={cn('size-1.5 rounded-full', DOT_COLOR[tone ?? 'neutral'])} />}
      {children}
    </span>
  )
}
