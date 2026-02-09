import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-slate-600/80 bg-slate-900/70 text-slate-200',
        success: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300',
        error: 'border-rose-500/40 bg-rose-950/50 text-rose-300',
        warning: 'border-amber-500/40 bg-amber-950/50 text-amber-300',
        info: 'border-sky-500/40 bg-sky-950/50 text-sky-300'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
