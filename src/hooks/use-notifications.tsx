'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { parseSiteNotificationsFromFirestore } from '@/lib/notifications/firestore';
import type { NotificationBlock, SiteNotifications } from '@/lib/notifications/types';
import { DEFAULT_SITE_NOTIFICATIONS } from '@/lib/notifications/types';
import { shouldShowNotification } from '@/lib/notifications/time';

const NOTIFICATIONS_DOC_PATH = 'settings/notifications';
const TOP_BANNER_DISMISSED_KEY = 'topBannerDismissedContent';
const POPUP_SEEN_CONTENT_KEY = 'hasSeenPopupContent';

type NotificationsContextValue = {
  notifications: SiteNotifications;
  isLoading: boolean;
  showPopup: boolean;
  showTopBanner: boolean;
  isTopBannerDismissed: boolean;
  dismissTopBanner: () => void;
  markPopupSeen: () => void;
  isLoggedIn: boolean;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(
  undefined
);

function useLoggedInState() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const check = () => {
      try {
        const raw = localStorage.getItem('user');
        setIsLoggedIn(!!raw && !!JSON.parse(raw));
      } catch {
        setIsLoggedIn(false);
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

  return isLoggedIn;
}

function getDismissedBannerContent(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOP_BANNER_DISMISSED_KEY);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<SiteNotifications>(
    DEFAULT_SITE_NOTIFICATIONS
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasSeenPopup, setHasSeenPopup] = useState(true);
  const [dismissedBannerContent, setDismissedBannerContent] = useState<string | null>(
    null
  );
  const isLoggedIn = useLoggedInState();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissedBannerContent(getDismissedBannerContent());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const content = notifications.popup.content.trim();
    const seenContent = sessionStorage.getItem(POPUP_SEEN_CONTENT_KEY);
    if (!content) {
      setHasSeenPopup(true);
      return;
    }
    setHasSeenPopup(seenContent === content);
  }, [notifications.popup.content]);

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

  const showTopBannerRaw = shouldShowNotification(notifications.topBanner);
  const showTopBanner =
    showTopBannerRaw &&
    dismissedBannerContent !== notifications.topBanner.content.trim();

  const showPopup =
    isLoggedIn &&
    shouldShowNotification(notifications.popup) &&
    !hasSeenPopup;

  const dismissTopBanner = useCallback(() => {
    const content = notifications.topBanner.content.trim();
    sessionStorage.setItem(TOP_BANNER_DISMISSED_KEY, content);
    setDismissedBannerContent(content);
  }, [notifications.topBanner.content]);

  const markPopupSeen = useCallback(() => {
    const content = notifications.popup.content.trim();
    sessionStorage.setItem(POPUP_SEEN_CONTENT_KEY, content);
    setHasSeenPopup(true);
  }, [notifications.popup.content]);

  const value = useMemo(
    () => ({
      notifications,
      isLoading,
      showPopup,
      showTopBanner,
      isTopBannerDismissed: !showTopBanner && showTopBannerRaw,
      dismissTopBanner,
      markPopupSeen,
      isLoggedIn,
    }),
    [
      notifications,
      isLoading,
      showPopup,
      showTopBanner,
      showTopBannerRaw,
      dismissTopBanner,
      markPopupSeen,
      isLoggedIn,
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
