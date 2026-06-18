import * as React from 'react'
import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { FeedbackButton } from '@/components/FeedbackButton'
import { THEME_INIT_SCRIPT } from '@/lib/theme'
import appCss from '@/styles/global.css?url'

const DESCRIPTION =
  'A one-time AI cost savings scan. Connect or upload your LLM usage, get a free spend snapshot, then unlock exact fixes to cut your AI bill. No prompts or responses required.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'SaveMyTokens - Find ways to cut your AI bill in minutes' },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: 'SaveMyTokens - cut your AI bill in minutes' },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:type', content: 'website' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;700&family=Inter:wght@400;500;600&display=swap',
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    void import('@/lib/analytics').then((m) => m.initObservability())
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="flex min-h-dvh flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <FeedbackButton />
        <Scripts />
      </body>
    </html>
  )
}
