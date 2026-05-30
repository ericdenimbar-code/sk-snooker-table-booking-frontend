import { cn } from '@/lib/utils';

export type SlotStatusInput = {
  isExpired: boolean;
  isFull: boolean;
  isBlocked: boolean;
  isSelected: boolean;
  isAdmin: boolean;
  isPendingBlockAdd?: boolean;
  isPendingBlockRemove?: boolean;
};

export type SlotStatusResult = {
  isGray: boolean;
  isDisabled: boolean;
  variant: 'default' | 'secondary' | 'outline';
  className: string;
};

const baseClass = 'h-auto py-1.5 w-full';
const availableClass = cn(baseClass, 'bg-white text-gray-900 hover:bg-green-50');
const fullClass = cn(baseClass, 'bg-gray-200 text-gray-400 pointer-events-none cursor-not-allowed');
const expiredClass = cn(baseClass, 'bg-gray-100 text-gray-400 pointer-events-none cursor-not-allowed');
const adminBlockedClass = cn(baseClass, 'bg-yellow-400 hover:bg-yellow-500 text-gray-900');
const adminPendingAddClass = cn(baseClass, 'bg-yellow-300 text-gray-900 ring-1 ring-yellow-600');
const adminPendingRemoveClass = cn(baseClass, 'bg-gray-200 text-gray-500 line-through');

export function isSlotGray(isFull: boolean, isBlocked: boolean, isExpired: boolean): boolean {
  return isFull || isBlocked || isExpired;
}

export function resolveSlotStatus(input: SlotStatusInput): SlotStatusResult {
  const {
    isExpired,
    isFull,
    isBlocked,
    isSelected,
    isAdmin,
    isPendingBlockAdd,
    isPendingBlockRemove,
  } = input;

  const isGray = isSlotGray(isFull, isBlocked, isExpired);

  if (isSelected) {
    return {
      isGray,
      isDisabled: isGray,
      variant: 'default',
      className: baseClass,
    };
  }

  if (isAdmin) {
    if (isPendingBlockRemove) {
      return {
        isGray: true,
        isDisabled: false,
        variant: 'outline',
        className: adminPendingRemoveClass,
      };
    }
    if (isPendingBlockAdd || (isBlocked && !isPendingBlockRemove)) {
      return {
        isGray: false,
        isDisabled: false,
        variant: 'outline',
        className: isPendingBlockAdd ? adminPendingAddClass : adminBlockedClass,
      };
    }
    if (isFull) {
      return { isGray: true, isDisabled: true, variant: 'secondary', className: fullClass };
    }
    if (isExpired) {
      return { isGray: true, isDisabled: true, variant: 'secondary', className: expiredClass };
    }
    return {
      isGray: false,
      isDisabled: false,
      variant: 'outline',
      className: availableClass,
    };
  }

  if (isGray) {
    return {
      isGray: true,
      isDisabled: true,
      variant: 'secondary',
      className: isExpired ? expiredClass : fullClass,
    };
  }

  return {
    isGray: false,
    isDisabled: false,
    variant: 'outline',
    className: availableClass,
  };
}
