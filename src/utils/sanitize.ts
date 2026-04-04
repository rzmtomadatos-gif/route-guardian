/**
 * Centralized sanitization for user/file-provided content.
 * Uses DOMPurify to strip dangerous HTML/JS from KML descriptions
 * and other imported text fields.
 */
import DOMPurify from 'dompurify';

/**
 * Sanitize an HTML string — keeps safe tags (table, tr, td, b, i, br, p, span)
 * but strips scripts, event handlers, iframes, etc.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['table', 'tr', 'td', 'th', 'tbody', 'thead', 'b', 'i', 'em', 'strong', 'br', 'p', 'span', 'div', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['colspan', 'rowspan'],
    KEEP_CONTENT: true,
  });
}

/**
 * Strip ALL HTML tags, returning plain text only.
 * Useful for fields that should never contain markup (names, IDs).
 */
export function stripHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], KEEP_CONTENT: true }).trim();
}

/**
 * Sanitize a plain-text field: trim, limit length, remove control chars.
 */
export function sanitizeTextField(value: string, maxLength = 500): string {
  // Remove control characters except newline/tab
  const cleaned = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned.trim().slice(0, maxLength);
}
