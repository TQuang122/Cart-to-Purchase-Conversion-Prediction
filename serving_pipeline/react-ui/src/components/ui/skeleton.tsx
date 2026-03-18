import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const skeletonVariants = cva(
  'animate-pulse-slow rounded-md bg-muted',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        card: 'bg-muted',
        input: 'bg-muted',
        button: 'bg-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {
  /**
   * Width of the skeleton
   * @example "100px", "50%", "full"
   */
  width?: string | number
  /**
   * Height of the skeleton
   * @example "20px", "2rem", "auto"
   */
  height?: string | number
}

function Skeleton({
  className,
  variant,
  width,
  height,
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(skeletonVariants({ variant }), className)}
      style={{
        width: width ?? '100%',
        height: height ?? '1rem',
        ...style,
      }}
      {...props}
    />
  )
}

export { Skeleton, skeletonVariants }
