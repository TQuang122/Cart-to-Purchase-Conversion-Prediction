import type { TooltipProps } from 'recharts'

export const CHART_COLORS = [
  'hsl(160, 84%, 34%)',
  'hsl(186, 78%, 41%)',
  'hsl(37, 92%, 50%)',
  'hsl(345, 82%, 58%)',
  'hsl(220, 16%, 58%)',
] as const

export const CHART_TOOLTIP_CONTENT_STYLE: TooltipProps<'bar' | 'line' | 'area' | 'scatter', number>['contentStyle'] = {
  backgroundColor: 'hsl(var(--surface-1) / 0.99)',
  border: '1px solid hsl(var(--border) / 0.84)',
  borderRadius: '0.75rem',
  color: 'hsl(var(--text-primary))',
  boxShadow: '0 22px 42px -26px rgba(2, 6, 23, 0.9)',
  fontSize: '12px',
}
