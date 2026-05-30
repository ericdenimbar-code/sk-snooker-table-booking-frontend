import { cn } from '@/lib/utils';

export type SlotStatusInput = {
  isExpired: boolean;
  isFull: boolean;
  isBlocked: boolean;
  isSelected: boolean;
  isAdmin: boolean;
};

export type SlotStatusResult = {
  isExpired: boolean;
  isFull: boolean;
  isBlocked: boolean;
  isSelected: boolean;
  isDisabled: boolean;
  variant: 'default' | 'secondary' | 'outline';
  className: string;
};

/**
 * Unified slot status with Admin priority:
 * 1. blocked (yellow)  2. full (gray-200)  3. expired (gray-100)  4. available
 */
export function resolveSlotStatus(input: SlotStatusInput): SlotStatusResult {
  const { isExpired, isFull, isBlocked, isSelected, isAdmin } = input;

  const isDisabled = isAdmin
    ? isExpired || (isFull && !isBlocked)
    : isExpired || isFull || isBlocked;

  if (isSelected) {
    return {
      isExpired,
      isFull,
      isBlocked,
      isSelected,
      isDisabled,
      variant: 'default',
      className: cn('h-auto py-1.5 w-full'),
    };
  }

  if (isAdmin) {
    if (isBlocked) {
      return {
        isExpired,
        isFull,
        isBlocked,
        isSelected,
        isDisabled: false,
        variant: 'outline',
        className: cn(
          'h-auto py-1.5 w-full',
          'bg-yellow-400 hover:bg-yellow-500 text-yellow-950 border-yellow-500',
        ),
      };
    }
    if (isFull) {
      return {
        isExpired,
        isFull,
        isBlocked,
        isSelected,
        isDisabled: true,
        variant: 'secondary',
        className: cn(
          'h-auto py-1.5 w-full',
          'bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed',
        ),
      };
    }
    if (isExpired) {
      return {
        isExpired,
        isFull,
        isBlocked,
        isSelected,
        isDisabled: true,
        variant: 'secondary',
        className: cn(
          'h-auto py-1.5 w-full',
          'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed',
        ),
      };
    }
    return {
      isExpired,
      isFull,
      isBlocked,
      isSelected,
      isDisabled: false,
      variant: 'outline',
      className: cn(
        'h-auto py-1.5 w-full',
        'border-primary/40 text-primary hover:bg-primary/5',
      ),
    };
  }

  // User端
  if (!isExpired && (isFull || isBlocked)) {
    return {
      isExpired,
      isFull,
      isBlocked,
      isSelected,
      isDisabled: true,
      variant: 'secondary',
      className: cn(
        'h-auto py-1.5 w-full',
        'bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed',
      ),
    };
  }
  if (isExpired) {
    return {
      isExpired,
      isFull,
      isBlocked,
      isSelected,
      isDisabled: true,
      variant: 'secondary',
      className: cn(
        'h-auto py-1.5 w-full',
        'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed',
      ),
    };
  }

  return {
    isExpired,
    isFull,
    isBlocked,
    isSelected,
    isDisabled: false,
    variant: 'outline',
    className: cn('h-auto py-1.5 w-full'),
  };
}
