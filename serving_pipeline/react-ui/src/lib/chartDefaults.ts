import type { ChartConfig } from "@/components/ui/chart"

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const

export const chartConfig = {
  views: {
    label: "Views",
    color: "var(--chart-1)",
  },
  carts: {
    label: "Carts",
    color: "var(--chart-2)",
  },
  purchases: {
    label: "Purchases",
    color: "var(--chart-3)",
  },
  conversion: {
    label: "Conversion Rate",
    color: "var(--chart-4)",
  },
  volume: {
    label: "Volume",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig

export const categoryConfig = {
  category: {
    label: "Category",
    color: "var(--chart-1)",
  },
  volume: {
    label: "Volume",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export const priceConfig = {
  price: {
    label: "Price",
    color: "var(--chart-1)",
  },
  volume: {
    label: "Volume",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export const hourlyConfig = {
  hour: {
    label: "Hour",
    color: "var(--chart-1)",
  },
  rate: {
    label: "Conversion Rate",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export const weekdayConfig = {
  day: {
    label: "Day",
    color: "var(--chart-1)",
  },
  events: {
    label: "Events",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export const timeConfig = {
  minute: {
    label: "Minute",
    color: "var(--chart-1)",
  },
  volume: {
    label: "Orders",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export const brandConfig = {
  brand: {
    label: "Brand",
    color: "var(--chart-1)",
  },
  rate: {
    label: "Conversion Rate",
    color: "var(--chart-2)",
  },
  volume: {
    label: "Volume",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig

export const shapConfig = {
  shap: {
    label: "SHAP Contribution",
    color: "var(--chart-1)",
  },
  meanAbs: {
    label: "Mean |SHAP|",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export const scoreConfig = {
  score: {
    label: "Score",
    color: "var(--chart-1)",
  },
  count: {
    label: "Count",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export const cohortConfig = {
  cohort: {
    label: "Cohort",
    color: "var(--chart-1)",
  },
  predictedRate: {
    label: "Predicted Rate",
    color: "var(--chart-2)",
  },
  avgProbability: {
    label: "Avg Probability",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig

export const CONFUSION_COLORS = {
  tp: "var(--success)",
  fp: "var(--warning)",
  fn: "var(--error)",
  tn: "var(--muted-foreground)",
} as const

export const CHART_TOOLTIP_CONTENT_STYLE = {
  backgroundColor: "hsl(var(--surface-2) / 0.99)",
  border: "1px solid hsl(var(--border) / 0.84)",
  borderRadius: "0.75rem",
  color: "hsl(var(--foreground))",
  boxShadow: "0 22px 42px -26px rgba(2, 6, 23, 0.9)",
  fontSize: "12px",
}

export const CHART_ACTIVE_BAR_STYLE = {
  fill: "hsl(var(--chart-1))",
  filter: "brightness(1.15)",
}

export const CHART_ANIMATION_DURATION = 800
