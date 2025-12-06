"use client"

import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

// A custom Checkbox implementation that removes the dependency on @radix-ui/react-checkbox
// to resolve the persistent module resolution issue.

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLButtonElement>, 'value'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<
  HTMLButtonElement,
  CheckboxProps
>(({ className, checked, onCheckedChange, ...props }, ref) => {
  const handleClick = () => {
    if (onCheckedChange) {
      onCheckedChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      ref={ref}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className
      )}
      onClick={handleClick}
      {...props}
    >
      {checked && (
        <div className={cn("flex items-center justify-center text-current")}>
          <Check className="h-4 w-4" />
        </div>
      )}
    </button>
  );
});
Checkbox.displayName = "Checkbox"

export { Checkbox }
