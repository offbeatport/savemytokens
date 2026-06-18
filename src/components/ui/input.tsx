import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-11 w-full rounded-lg border border-border-strong bg-surface px-3.5 text-[0.95rem] text-foreground',
        'placeholder:text-faint outline-none transition-colors',
        'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
