import * as React from 'react'
import { Sun, Moon } from 'lucide-react'
import { getTheme, toggleTheme, type Theme } from '@/lib/theme'
import { track } from '@/lib/analytics'

export function ThemeToggle() {
  const [theme, setThemeState] = React.useState<Theme>('light')
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    setThemeState(getTheme())
  }, [])

  return (
    <button
      type="button"
      onClick={() => {
        const next = toggleTheme()
        setThemeState(next)
        track('theme_toggle', { theme: next })
      }}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title="Toggle theme"
      className="grid size-9 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
    >
      {/* default to Moon pre-mount to avoid layout shift */}
      {mounted && theme === 'dark' ? (
        <Sun className="size-[1.15rem]" aria-hidden />
      ) : (
        <Moon className="size-[1.15rem]" aria-hidden />
      )}
    </button>
  )
}
