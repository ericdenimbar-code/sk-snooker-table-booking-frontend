import { cn } from '@/lib/utils';

export type SlotHoldAppearance = 'none' | '1' | '2' | 'both';

export type SlotStatusInput = {
  isExpired: boolean;
  isFull: boolean;
  isBlocked: boolean;
  isSelected: boolean;
  isAdmin: boolean;
  hold?: SlotHoldAppearance;
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
const adminHoldTable1Class = cn(baseClass, 'bg-yellow-400 hover:bg-yellow-500 text-gray-900');
const adminHoldTable2Class = cn(baseClass, 'bg-sky-200 hover:bg-sky-300 text-gray-900');
const adminHoldBothClass = cn(baseClass, 'bg-red-200 hover:bg-red-300 text-gray-900');

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
    hold = 'none',
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
    if (!isExpired && hold === 'both') {
      return { isGray: false, isDisabled: false, variant: 'outline', className: adminHoldBothClass };
    }
    if (!isExpired && hold === '1') {
      return { isGray: false, isDisabled: false, variant: 'outline', className: adminHoldTable1Class };
    }
    if (!isExpired && hold === '2') {
      return { isGray: false, isDisabled: false, variant: 'outline', className: adminHoldTable2Class };
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
