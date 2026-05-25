import DOMPurify from 'dompurify';

const SANITIZE_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: ['strong', 'b', 'em', 'i', 'u', 'br', 'p'],
  ALLOWED_ATTR: [],
};

/** Strip to allowed inline formatting tags for safe rendering. */
export function sanitizeNotificationHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

/** True when HTML has visible text after sanitization. */
export function hasNotificationContent(html: string): boolean {
  if (!html) return false;
  const sanitized = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  const text = sanitized.replace(/\s|&nbsp;/g, '');
  return text.length > 0;
}
