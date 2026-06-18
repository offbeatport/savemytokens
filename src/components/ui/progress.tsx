import { Progress as BaseProgress } from '@base-ui-components/react/progress'
import { cn } from '@/lib/utils'

export function Progress({
  value,
  className,
  indicatorClassName,
}: {
  value: number | null
  className?: string
  indicatorClassName?: string
}) {
  return (
    <BaseProgress.Root value={value} className={cn('w-full', className)}>
      <BaseProgress.Track className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
        <BaseProgress.Indicator
          className={cn('h-full rounded-full bg-primary transition-all duration-500 ease-out', indicatorClassName)}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  )
}
