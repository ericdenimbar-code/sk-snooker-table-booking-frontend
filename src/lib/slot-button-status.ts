import { cn } from '@/lib/utils';

export type SlotStatusInput = {
  isExpired: boolean;
  isFull: boolean;
  isBlocked: boolean;
  isSelected: boolean;
  isAdmin: boolean;
};

export type SlotStatusResult = {
  isGray: boolean;
  isDisabled: boolean;
  variant: 'default' | 'secondary' | 'outline';
  className: string;
};

const baseClass = 'h-auto py-1.5 w-full';
const grayClass = cn(baseClass, 'bg-gray-200 text-gray-800 cursor-not-allowed');
const availableClass = cn(baseClass, 'bg-white text-gray-900 hover:bg-green-50');
const adminBlockedClass = cn(baseClass, 'bg-yellow-400 hover:bg-yellow-500 text-gray-900');

/** Shared gray rule: full, blocked, or expired → unavailable */
export function isSlotGray(isFull: boolean, isBlocked: boolean, isExpired: boolean): boolean {
  return isFull || isBlocked || isExpired;
}

export function resolveSlotStatus(input: SlotStatusInput): SlotStatusResult {
  const { isExpired, isFull, isBlocked, isSelected, isAdmin } = input;
  const isGray = isSlotGray(isFull, isBlocked, isExpired);

  if (isSelected) {
    return {
      isGray,
      isDisabled: isGray,
      variant: 'default',
      className: baseClass,
    };
  }

  // Admin 預留：黃色、可點擊解除（唯一例外，不套用灰色）
  if (isAdmin && isBlocked) {
    return {
      isGray,
      isDisabled: false,
      variant: 'outline',
      className: adminBlockedClass,
    };
  }

  if (isGray) {
    return {
      isGray,
      isDisabled: true,
      variant: 'secondary',
      className: grayClass,
    };
  }

  return {
    isGray: false,
    isDisabled: false,
    variant: 'outline',
    className: availableClass,
  };
}
