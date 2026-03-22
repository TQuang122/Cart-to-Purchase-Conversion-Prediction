import { AlertCircle, CheckCircle2, Loader2, Info } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

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
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={`${variant}-${title ?? ''}-${message}`}
        className={cn('state-banner', variantClassName, className)}
        role={role}
        aria-live="polite"
        initial={{ opacity: 0, y: 6, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.995 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <Icon className={iconClassName} />
        <div>
          {title ? <p className="type-heading text-sm font-semibold">{title}</p> : null}
          <p className="type-caption mt-0.5">{message}</p>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
