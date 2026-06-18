/** Client-side theme control. The .dark class on <html> drives all tokens. */
export type Theme = 'light' | 'dark'

export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function setTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem('theme', theme)
  } catch {
    /* ignore (private mode) */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/** Inline <head> snippet - applies the saved/system theme before first paint
 * to avoid a flash. Kept as a string so it can run synchronously pre-hydration. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=new URLSearchParams(location.search).get('theme');var t=p||localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`
