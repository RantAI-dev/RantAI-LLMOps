"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { Info } from "lucide-react"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delay = 200,
  closeDelay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  side = "top",
  sideOffset = 6,
  align = "center",
  className,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="isolate z-50 outline-none"
        side={side}
        sideOffset={sideOffset}
        align={align}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 max-w-xs origin-(--transform-origin) rounded-lg bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

/**
 * InfoTip — the standard "ⓘ beside a heading/label" affordance. Hover or keyboard-
 * focus the info icon to reveal secondary/explanatory copy, keeping the primary UI
 * concise. Pass the explanation as `children` (or `text`); the icon carries the
 * accessible label so screen readers announce it as a button revealing the tip.
 */
function InfoTip({
  children,
  text,
  side,
  align,
  className,
  iconClassName,
  label = "More info",
}: {
  children?: React.ReactNode
  text?: React.ReactNode
  side?: TooltipPrimitive.Positioner.Props["side"]
  align?: TooltipPrimitive.Positioner.Props["align"]
  className?: string
  iconClassName?: string
  label?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:text-ink-soft focus-visible:text-ink-soft focus-visible:outline-none",
              className
            )}
          />
        }
      >
        <Info className={cn("size-3.5", iconClassName)} aria-hidden />
      </TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {children ?? text}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent, InfoTip }
