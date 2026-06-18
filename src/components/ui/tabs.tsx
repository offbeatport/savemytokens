import * as React from 'react'
import { Tabs as BaseTabs } from '@base-ui-components/react/tabs'
import { cn } from '@/lib/utils'

export const Tabs = BaseTabs.Root

export function TabsList({ className, ...props }: React.ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        'relative inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface p-1',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTab({ className, ...props }: React.ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        'relative z-10 inline-flex cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground data-[selected]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TabsIndicator({ className, ...props }: React.ComponentProps<typeof BaseTabs.Indicator>) {
  return (
    <BaseTabs.Indicator
      className={cn(
        'absolute top-1 left-0 z-0 h-[calc(100%-0.5rem)] rounded-lg bg-surface-sunken transition-all duration-200 ease-out',
        className,
      )}
      style={{
        width: 'var(--active-tab-width)',
        transform: 'translateX(var(--active-tab-left))',
      }}
      {...props}
    />
  )
}

export function TabsPanel({ className, ...props }: React.ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn('mt-6 outline-none', className)} {...props} />
}
