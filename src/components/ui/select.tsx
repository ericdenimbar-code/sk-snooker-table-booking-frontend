
"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// Re-implementing Select using Popover and React Context to avoid
// the persistent @radix-ui/react-select dependency issue.

interface SelectContextValue {
  value: string | undefined
  onValueChange: (value: string) => void
  setOpen: (open: boolean) => void
  children: React.ReactNode
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

const useSelectContext = () => {
  const context = React.useContext(SelectContext)
  if (!context) {
    throw new Error("Select components must be used within a Select provider")
  }
  return context
}

const Select = ({
  value,
  onValueChange,
  children,
  ...props
}: {
  value?: string
  onValueChange: (value: string) => void
  children: React.ReactNode
} & React.ComponentProps<typeof PopoverPrimitive.Root>) => {
  const [open, setOpen] = React.useState(false)

  return (
    <SelectContext.Provider value={{ value, onValueChange, setOpen, children }}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen} {...props}>
        {children}
      </PopoverPrimitive.Root>
    </SelectContext.Provider>
  )
}

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <PopoverPrimitive.Trigger ref={ref} asChild {...props}>
    <Button
      variant="outline"
      role="combobox"
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        "[&>span]:line-clamp-1",
        className
      )}
    >
      {children}
      <ChevronDown className="h-4 w-4 opacity-50" />
    </Button>
  </PopoverPrimitive.Trigger>
))
SelectTrigger.displayName = "SelectTrigger"

const SelectContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        "w-[var(--radix-popover-trigger-width)]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <div className="p-1 h-auto w-full min-w-[var(--radix-popover-trigger-width)]">
        {children}
      </div>
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
))
SelectContent.displayName = "SelectContent"

const SelectItem = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & { value: string }
>(({ className, children, value, ...props }, ref) => {
  const { value: selectedValue, onValueChange, setOpen } = useSelectContext()
  const isSelected = selectedValue === value

  const handleSelect = () => {
    onValueChange(value)
    setOpen(false)
  }

  return (
    <button
      ref={ref}
      onClick={handleSelect}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        {isSelected && <Check className="h-4 w-4" />}
      </span>
      {children}
    </button>
  )
})
SelectItem.displayName = "SelectItem"

const SelectValue = ({ placeholder }: { placeholder?: string }) => {
  const { value, children } = useSelectContext();
  const selectedChild = React.Children.toArray(children).find(
    (child) => React.isValidElement(child) && child.props.value === value
  );

  if (selectedChild) {
    // Access children prop of the selected item
    const grandChildren = React.isValidElement(selectedChild) ? selectedChild.props.children : null;
    return <>{grandChildren}</>;
  }
  
  if (value) {
    return <>{value}</>
  }
  
  return <span className="text-muted-foreground">{placeholder}</span>
}
SelectValue.displayName = "SelectValue"

const SelectGroup = ({ children }: { children: React.ReactNode }) => <>{children}</>
SelectGroup.displayName = "SelectGroup"

const SelectLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = "SelectLabel"

const SelectSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = "SelectSeparator"

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
}
