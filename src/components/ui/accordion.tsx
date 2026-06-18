import * as React from 'react'
import { Accordion as BaseAccordion } from '@base-ui-components/react/accordion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Accordion = BaseAccordion.Root
export const AccordionItem = BaseAccordion.Item

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseAccordion.Trigger>) {
  return (
    <BaseAccordion.Header>
      <BaseAccordion.Trigger
        className={cn(
          'group flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left outline-none focus-visible:text-primary',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className="size-5 shrink-0 text-muted transition-transform duration-200 group-data-[panel-open]:rotate-180" />
      </BaseAccordion.Trigger>
    </BaseAccordion.Header>
  )
}

export function AccordionPanel({
  className,
  ...props
}: React.ComponentProps<typeof BaseAccordion.Panel>) {
  return (
    <BaseAccordion.Panel
      className={cn(
        'overflow-hidden text-muted transition-all duration-200 ease-out',
        'h-[var(--accordion-panel-height)] data-[ending-style]:h-0 data-[starting-style]:h-0',
        className,
      )}
      {...props}
    />
  )
}
