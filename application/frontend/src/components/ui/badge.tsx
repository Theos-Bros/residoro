import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        // Residoro Design Language (2026-08-03) status-chip variants: soft
        // tint bg + colored text + colored border, distinct from the solid
        // fills above (those are for the Button-style default/destructive
        // use, not status chips). Available/Approve-shaped states.
        success:
          "border-[#D3E5D6] bg-[#EAF2EA] text-[#2F6B3A] dark:border-[#2E4434] dark:bg-[#1F2E22] dark:text-[#7FBE8C]",
        // Reserved/pending-shaped states -- deliberately reuses the accent
        // (gold-50/gold-text) tokens rather than a third hardcoded pair,
        // since this is exactly the "highlighted, needs attention" gold role.
        warning:
          "border-[#EFE4C8] bg-accent text-accent-foreground dark:border-[#4A3D1D]",
        // Draft/Sold-shaped states -- reuses secondary token pair.
        neutral: "border-border bg-secondary text-secondary-foreground",
        // Withdrawn-shaped states.
        danger:
          "border-[#F2D8D4] bg-[#FBECEA] text-[#9B3227] dark:border-[#4a2320] dark:bg-[#2e1613] dark:text-[#e5877a]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
