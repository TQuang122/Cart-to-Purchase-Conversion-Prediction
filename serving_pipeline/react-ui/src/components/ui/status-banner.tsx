import { AlertCircle, CheckCircle2, Loader2, Info } from 'lucide-react'

import { cn } from '@/lib/utils'

type StatusVariant = 'success' | 'loading' | 'error' | 'info'

interface StatusBannerProps {
  variant: StatusVariant
  title?: string
  message: string
  className?: string
}

const variantConfig: Record<StatusVariant, { className: string; icon: typeof AlertCircle }> = {
  success: { className: 'state-banner-ready', icon: CheckCircle2 },
  loading: { className: 'state-banner-loading', icon: Loader2 },
  error: { className: 'state-banner-error', icon: AlertCircle },
  info: { className: 'state-banner-loading', icon: Info },
}

export const StatusBanner = ({ variant, title, message, className }: StatusBannerProps) => {
  const { className: variantClassName, icon: Icon } = variantConfig[variant]
  const role = variant === 'error' ? 'alert' : 'status'
  const iconClassName = variant === 'loading' ? 'h-4 w-4 shrink-0 animate-spin' : 'h-4 w-4 shrink-0'

  return (
    <div className={cn('state-banner', variantClassName, className)} role={role} aria-live="polite">
      <Icon className={iconClassName} />
      <div>
        {title ? <p className="type-heading text-sm font-semibold">{title}</p> : null}
        <p className="type-caption mt-0.5">{message}</p>
      </div>
    </div>
  )
}
