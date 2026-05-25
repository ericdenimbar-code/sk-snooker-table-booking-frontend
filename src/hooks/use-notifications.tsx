'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { parseSiteNotificationsFromFirestore } from '@/lib/notifications/firestore';
import type { NotificationBlock, SiteNotifications } from '@/lib/notifications/types';
import { DEFAULT_SITE_NOTIFICATIONS } from '@/lib/notifications/types';
import { shouldShowNotification } from '@/lib/notifications/time';
import { hasNotificationContent } from '@/lib/notifications/sanitize';
import { isRoleVisible } from '@/lib/notifications/roles';

type NotificationsContextValue = {
  notifications: SiteNotifications;
  isLoading: boolean;
  showPopup: boolean;
  showTopBanner: boolean;
  dismissTopBanner: () => void;
  dismissPopup: () => void;
  isLoggedIn: boolean;
  userRole: string | null;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(
  undefined
);

function useAuthUserState() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const check = () => {
      try {
        const raw = localStorage.getItem('user');
        if (!raw) {
          setIsLoggedIn(false);
          setUserRole(null);
          return;
        }
        const parsed = JSON.parse(raw) as { role?: string };
        setIsLoggedIn(true);
        setUserRole(parsed.role ?? null);
      } catch {
        setIsLoggedIn(false);
        setUserRole(null);
      }
    };

    check();
    window.addEventListener('storage', check);
    window.addEventListener('userUpdated', check);
    return () => {
      window.removeEventListener('storage', check);
      window.removeEventListener('userUpdated', check);
    };
  }, []);

  return { isLoggedIn, userRole };
}

function passesNotificationFilters(
  block: NotificationBlock,
  userRole: string | null,
  isLoggedIn: boolean,
  requireLogin: boolean
): boolean {
  if (requireLogin && !isLoggedIn) return false;
  if (!shouldShowNotification(block)) return false;
  if (!hasNotificationContent(block.content)) return false;
  return isRoleVisible(block.visibleRoles, userRole, isLoggedIn);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<SiteNotifications>(
    DEFAULT_SITE_NOTIFICATIONS
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isPopupDismissed, setIsPopupDismissed] = useState(false);
  const [isTopBannerDismissed, setIsTopBannerDismissed] = useState(false);
  const { isLoggedIn, userRole } = useAuthUserState();

  useEffect(() => {
    if (!db) {
      setIsLoading(false);
      return;
    }

    const docRef = doc(db, 'settings', 'notifications');
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setNotifications(parseSiteNotificationsFromFirestore(snapshot.data()));
        } else {
          setNotifications(DEFAULT_SITE_NOTIFICATIONS);
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('notifications onSnapshot error:', error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const popupEligible = passesNotificationFilters(
    notifications.popup,
    userRole,
    isLoggedIn,
    true
  );

  const topBannerEligible = passesNotificationFilters(
    notifications.topBanner,
    userRole,
    isLoggedIn,
    false
  );

  const showPopup = popupEligible && !isPopupDismissed;
  const showTopBanner = topBannerEligible && !isTopBannerDismissed;

  const dismissTopBanner = useCallback(() => {
    setIsTopBannerDismissed(true);
  }, []);

  const dismissPopup = useCallback(() => {
    setIsPopupDismissed(true);
  }, []);

  const prevPopupContentRef = useRef('');

  useEffect(() => {
    const content = notifications.popup.content;
    if (
      prevPopupContentRef.current &&
      prevPopupContentRef.current !== content
    ) {
      setIsPopupDismissed(false);
    }
    prevPopupContentRef.current = content;
  }, [notifications.popup.content]);

  const value = useMemo(
    () => ({
      notifications,
      isLoading,
      showPopup,
      showTopBanner,
      dismissTopBanner,
      dismissPopup,
      isLoggedIn,
      userRole,
    }),
    [
      notifications,
      isLoading,
      showPopup,
      showTopBanner,
      dismissTopBanner,
      dismissPopup,
      isLoggedIn,
      userRole,
    ]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationsProvider');
  }
  return context;
}

export type { NotificationBlock, SiteNotifications };
