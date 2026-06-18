import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Flat grouped region: hairline border, no fill, no shadow.
 * This is our reconciliation of "use cards" (brief) with "flat, no panels"
 * (house style) - structure via borders + whitespace, never raised cards.
 */
export function Panel({
  className,
  children,
  as: Tag = 'div',
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: React.ElementType }) {
  return (
    <Tag className={cn('rounded-xl border border-border', className)} {...props}>
      {children}
    </Tag>
  )
}

/** Big tabular metric with a label and optional sub-text. */
export function Stat({
  label,
  value,
  sub,
  valueClassName,
  className,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  valueClassName?: string
  className?: string
}) {
  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={cn('mt-1.5 font-display text-3xl font-light tnum', valueClassName)}>{value}</div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </div>
  )
}

/** Eyebrow + display heading + optional lead paragraph. */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
  className,
}: {
  eyebrow?: string
  title: React.ReactNode
  lead?: React.ReactNode
  align?: 'left' | 'center'
  className?: string
}) {
  return (
    <div className={cn(align === 'center' && 'mx-auto max-w-2xl text-center', className)}>
      {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
      <h2>{title}</h2>
      {lead && <p className="mt-4 text-lg leading-relaxed text-muted">{lead}</p>}
    </div>
  )
}
