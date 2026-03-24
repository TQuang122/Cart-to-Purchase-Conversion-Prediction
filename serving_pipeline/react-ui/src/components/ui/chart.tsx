import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | {
        color: string
        theme?: never
      }
    | {
        color?: never
        theme: {
          light: string
          dark: string
        }
      }
  )
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChart must be used within a ChartContainer")
  }
  return context
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig
    children: React.ReactNode
  }
>(({ config, children, className, ...props }, ref) => {
  const uniqueId = React.useId()

  return (
    <ChartContext.Provider value={{ config }}>
      <div ref={ref} className={cn("w-full", className)} {...props}>
        <ChartStyle id={uniqueId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = "ChartContainer"

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const configEntries = Object.entries(config).map(([key, value]) => ({
    key,
    value,
    color: value.color ?? (value.theme?.light ?? "hsl(var(--chart-1))"),
  }))

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: configEntries
          .map(
            (item) => `
            #${id} [data-chart="${item.key}"] {
              color: ${item.color};
            }
          `
          )
          .join("\n"),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

interface ChartTooltipContentProps {
  className?: string
  hideLabel?: boolean
  hideIndicator?: boolean
  indicator?: "line" | "dot" | "dashed"
  nameKey?: string
}

const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  ({ className, indicator = "dot", hideLabel = false, hideIndicator = false, nameKey }, ref) => {
    const { config } = useChart()

    return (
      <RechartsPrimitive.Tooltip
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null

          return (
            <div
              ref={ref}
              className={cn(
                "rounded-lg border border-border/78 bg-surface-2/99 px-3 py-2 text-xs shadow-lg",
                className
              )}
            >
              {!hideLabel && (
                <div className="font-medium mb-1">{String(label)}</div>
              )}
              <div className="flex flex-col gap-1">
                {payload.map((item, index) => {
                  const key = nameKey || String(item.name || item.dataKey || "value")
                  const itemConfig = config[key]
                  const indicatorColor = itemConfig?.color || String(item.payload?.fill || "currentColor")

                  return (
                    <div key={index} className="flex items-center gap-2">
                      {!hideIndicator && (
                        <div
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-[2px]",
                            indicator === "dot" && "rounded-full",
                            indicator === "dashed" && "border-dashed border",
                            indicator === "line" && "h-0.5 w-full"
                          )}
                          style={{
                            backgroundColor: indicatorColor,
                            borderColor: indicator === "dashed" ? indicatorColor : undefined,
                          }}
                        />
                      )}
                      <div className="flex flex-1 items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {itemConfig?.label || item.name || key}
                        </span>
                        <span className="font-medium font-mono">
                          {typeof item.value === "number"
                            ? item.value.toLocaleString()
                            : item.value}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }}
      />
    )
  }
)
ChartTooltipContent.displayName = "ChartTooltipContent"

const ChartLegend = RechartsPrimitive.Legend

interface ChartLegendContentProps {
  className?: string
  hideIcon?: boolean
  nameKey?: string
}

const ChartLegendContent = React.forwardRef<HTMLDivElement, ChartLegendContentProps>(
  ({ className, hideIcon = false, nameKey }, ref) => {
    const { config } = useChart()

    return (
      <RechartsPrimitive.Legend
        content={({ payload }) => {
          if (!payload?.length) return null

          return (
            <div
              ref={ref}
              className={cn(
                "flex flex-wrap items-center justify-center gap-3",
                className
              )}
            >
              {payload.map((item) => {
                const key = nameKey || String(item.dataKey || item.value || "value")
                const itemConfig = config[key]

                return (
                  <div
                    key={String(item.value)}
                    className="flex items-center gap-2"
                    data-chart={String(item.value)}
                  >
                    {!hideIcon && (
                      <div
                        className="h-3 w-3 rounded-sm"
                        style={{ backgroundColor: String(item.color) }}
                      />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {itemConfig?.label || item.value}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        }}
      />
    )
  }
)
ChartLegendContent.displayName = "ChartLegendContent"

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  useChart,
}