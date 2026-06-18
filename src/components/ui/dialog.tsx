import * as React from 'react'
import { Dialog as BaseDialog } from '@base-ui-components/react/dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = BaseDialog.Root
export const DialogTrigger = BaseDialog.Trigger
export const DialogClose = BaseDialog.Close

export function DialogContent({
  className,
  children,
  showClose = true,
}: {
  className?: string
  children: React.ReactNode
  showClose?: boolean
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <BaseDialog.Popup
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-2xl border border-border bg-surface p-6 outline-none',
          'transition-all duration-200 ease-out',
          'data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
          className,
        )}
      >
        {showClose && (
          <BaseDialog.Close className="absolute right-4 top-4 grid size-8 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-surface-sunken hover:text-foreground">
            <X className="size-4" />
          </BaseDialog.Close>
        )}
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn('text-xl font-display font-normal', className)} {...props} />
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={cn('mt-1.5 text-sm text-muted', className)} {...props} />
}
