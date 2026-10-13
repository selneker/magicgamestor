import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-xs font-semibold tracking-[0.04em] transition-[background-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-[color:var(--rule-strong)] bg-primary text-primary-foreground shadow-[var(--shadow-brut)] hover:bg-foreground hover:text-background hover:shadow-[4px_4px_0_hsl(var(--foreground)/.2)]",
        destructive:
          "border border-[color:var(--rule)] bg-destructive text-destructive-foreground hover:opacity-90",
        outline:
          "border border-[color:var(--rule-strong)] bg-transparent text-foreground hover:bg-primary hover:text-primary-foreground",
        secondary:
          "border border-[color:var(--rule)] bg-foreground text-background hover:bg-primary hover:text-primary-foreground",
        ghost: "hover:bg-primary hover:text-primary-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-lg px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
