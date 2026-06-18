import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceDot,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import type { SpendByModel, TrendPoint, Spike, TokenSplit } from '@/lib/analysis/types'
import { usd, usdCompact, dateShort, pct, num } from '@/lib/format'

const PALETTE = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
]

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
      {label && <div className="mb-1 font-medium text-foreground">{label}</div>}
      <div className="tnum text-muted">{usd(payload[0].value)}</div>
    </div>
  )
}

/** Daily spend trend with spike markers. */
export function SpendTrendChart({ trend, spikes }: { trend: TrendPoint[]; spikes: Spike[] }) {
  const spikeDates = new Set(spikes.map((s) => s.date))
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={dateShort}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v) => usdCompact(v)}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            content={<MoneyTooltip />}
            labelFormatter={(label) => dateShort(String(label))}
            cursor={{ stroke: 'var(--color-border-strong)' }}
          />
          <Area
            type="monotone"
            dataKey="cost"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="url(#spendFill)"
          />
          {trend
            .filter((t) => spikeDates.has(t.date))
            .map((t) => (
              <ReferenceDot
                key={t.date}
                x={t.date}
                y={t.cost}
                r={5}
                fill="var(--color-risk)"
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Horizontal spend-by-model bars. */
export function SpendByModelChart({ data }: { data: SpendByModel[] }) {
  const top = data.slice(0, 7)
  return (
    <div style={{ height: Math.max(120, top.length * 44) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={top} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="model"
            width={132}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: 'var(--color-foreground)' }}
          />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'var(--color-surface-sunken)' }} />
          <Bar dataKey="cost" radius={[0, 6, 6, 0]} barSize={18}>
            {top.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Flat input-vs-output cost split bar. */
export function TokenSplitBar({ split }: { split: TokenSplit }) {
  const outPct = split.outputCostPct
  const inPct = 100 - outPct
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        <div className="bg-chart-2" style={{ width: `${inPct}%` }} />
        <div className="bg-chart-3" style={{ width: `${outPct}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-chart-2" />
          <span className="text-muted">Input</span>
          <span className="tnum font-medium">{usd(split.inputCost)}</span>
          <span className="text-faint tnum">{pct(inPct)}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-chart-3" />
          <span className="text-muted">Output</span>
          <span className="tnum font-medium">{usd(split.outputCost)}</span>
          <span className="text-faint tnum">{pct(outPct)}</span>
        </span>
        <span className="text-faint">
          {num(split.outputTokens)} output tokens · {num(split.inputTokens)} input
        </span>
      </div>
    </div>
  )
}
