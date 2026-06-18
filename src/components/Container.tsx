import * as React from 'react'
import { cn } from '@/lib/utils'

export function Container({
  className,
  children,
  size = 'default',
}: {
  className?: string
  children: React.ReactNode
  size?: 'default' | 'narrow' | 'wide'
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-5 sm:px-8',
        size === 'narrow' && 'max-w-3xl',
        size === 'default' && 'max-w-6xl',
        size === 'wide' && 'max-w-7xl',
        className,
      )}
    >
      {children}
    </div>
  )
}
