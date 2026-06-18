import { createFileRoute, redirect } from '@tanstack/react-router'

// Back-compat: the AI Cost Health Report used to live here. It now lives under
// /s/$scanId/r/ai-cost-health/report. Preserve any ?checkout= param.
export const Route = createFileRoute('/s/$scanId/report')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/s/$scanId/r/$reportSlug/report',
      params: { scanId: params.scanId, reportSlug: 'ai-cost-health' },
      search: search as never,
    })
  },
})
