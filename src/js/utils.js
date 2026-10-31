/**
 * CampusPulse Core Utilities
 * Pure, testable helper functions for date handling, priority classification,
 * text sanitization, and timing controls.
 */

import { CONFIG } from './config.js';

/**
 * Validates whether an input represents a valid date.
 * Accepts ISO string, Date object, or timestamp.
 * Rejects invalid strings, null, undefined, NaN, and objects without valid dates.
 *
 * @param {unknown} dateInput
 * @returns {boolean}
 */
export function isValidDate(dateInput) {
  if (dateInput === null || dateInput === undefined || dateInput === '') {
    return false;
  }
  const date = new Date(dateInput);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Safely parses any date input into a valid Date object or returns null.
 *
 * @param {unknown} dateInput
 * @returns {Date | null}
 */
export function parseDateSafely(dateInput) {
  if (!isValidDate(dateInput)) {
    return null;
  }
  return new Date(dateInput);
}

/**
 * Formats a date into a standardized display string (e.g., "Sat, Oct 31, 2026").
 *
 * @param {unknown} dateInput
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatDateDisplay(dateInput, options = {}) {
  const date = parseDateSafely(dateInput);
  if (!date) return 'Invalid Date';

  const defaultOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: CONFIG.TIMEZONE,
    ...options
  };

  try {
    return new Intl.DateTimeFormat('en-US', defaultOptions).format(date);
  } catch {
    // Fallback if timezone not supported
    return date.toLocaleDateString('en-US');
  }
}

/**
 * Formats time from an ISO date or time string (e.g., "10:30 AM").
 *
 * @param {unknown} dateInput
 * @returns {string}
 */
export function formatTimeDisplay(dateInput) {
  const date = parseDateSafely(dateInput);
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: CONFIG.TIMEZONE
    }).format(date);
  } catch {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
}

/**
 * Determines whether two dates fall on the same calendar day in local time.
 *
 * @param {Date} date1
 * @param {Date} date2
 * @returns {boolean}
 */
export function isSameDay(date1, date2) {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Determines whether an event date has already passed.
 *
 * @param {unknown} eventDateInput
 * @param {Date} [referenceDate]
 * @returns {boolean}
 */
export function isEventExpired(eventDateInput, referenceDate = new Date()) {
  const eventDate = parseDateSafely(eventDateInput);
  if (!eventDate) return false;
  return eventDate.getTime() < referenceDate.getTime();
}

/**
 * Classifies an event into a priority category based on the campus priority model.
 *
 * Priority Model & Overlap Resolution Rule:
 * 1. 'expired': Event date/time is in the past (eventDate < referenceDate).
 * 2. 'urgent': Event happens on the SAME CALENDAR DAY as today (deadline is today).
 * 3. 'upcoming': Event is scheduled within the NEXT 24 HOURS, but on a future calendar date (e.g. tomorrow morning).
 * 4. 'this-week': Event is within 7 calendar days (<= 7 * 24h) from the reference moment.
 * 5. 'scheduled': Event is scheduled further than 7 days out.
 *
 * If eventDate is invalid, returns 'scheduled' as safe fallback.
 *
 * @param {unknown} eventDateInput
 * @param {Date} [referenceDate] Optional reference date (defaults to now)
 * @returns {'expired' | 'urgent' | 'upcoming' | 'this-week' | 'scheduled'}
 */
export function classifyEventPriority(eventDateInput, referenceDate = new Date()) {
  const eventDate = parseDateSafely(eventDateInput);
  if (!eventDate) {
    return 'scheduled';
  }

  const nowMs = referenceDate.getTime();
  const eventMs = eventDate.getTime();

  // 1. Expired: Event date/time has passed
  if (eventMs < nowMs) {
    return 'expired';
  }

  // 2. Urgent: Event is scheduled for today (same calendar date)
  if (isSameDay(eventDate, referenceDate)) {
    return 'urgent';
  }

  // 3. Upcoming: Tomorrow or future calendar date, but within 24 hours from reference moment
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;
  if (eventMs - nowMs <= twentyFourHoursMs) {
    return 'upcoming';
  }

  // 4. This Week: Within 7 calendar days
  const sevenDaysMs = 7 * twentyFourHoursMs;
  if (eventMs - nowMs <= sevenDaysMs) {
    return 'this-week';
  }

  // 5. Scheduled: Greater than 7 days away
  return 'scheduled';
}

/**
 * Returns numeric priority weight for sorting.
 * Higher weight = higher urgency.
 *
 * @param {string} priority
 * @returns {number}
 */
export function getPriorityWeight(priority) {
  switch (priority) {
    case 'urgent': return 4;
    case 'upcoming': return 3;
    case 'this-week': return 2;
    case 'scheduled': return 1;
    case 'expired': return 0;
    default: return -1;
  }
}

/**
 * Sanitizes plain text to prevent XSS injection when rendering in HTML.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function sanitizeText(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Safely extracts a YYYY-MM-DD date string for HTML <input type="date">.
 * Avoids unintended date shifts caused by timezone conversions when parsing ISO strings.
 *
 * @param {unknown} dateInput
 * @returns {string} YYYY-MM-DD or empty string
 */
export function normalizeDateForInput(dateInput) {
  if (!dateInput) return '';

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }
  }

  const date = parseDateSafely(dateInput);
  if (!date) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Safely extracts an HH:mm 24-hour time string for HTML <input type="time">.
 * Does NOT invent missing times.
 *
 * @param {unknown} timeInput
 * @param {unknown} [fallbackDateInput]
 * @returns {string} HH:mm or empty string
 */
export function normalizeTimeForInput(timeInput, fallbackDateInput) {
  if (timeInput && typeof timeInput === 'string') {
    const trimmed = timeInput.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      return `${match[1].padStart(2, '0')}:${match[2]}`;
    }
  }

  if (fallbackDateInput && typeof fallbackDateInput === 'string') {
    const trimmed = fallbackDateInput.trim();
    const match = trimmed.match(/T(\d{1,2}):(\d{2})/);
    if (match) {
      return `${match[1].padStart(2, '0')}:${match[2]}`;
    }
  }

  return '';
}

/**
 * Truncates text cleanly at word boundaries with ellipsis.
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateText(text, maxLength = 140) {
  if (!text || text.length <= maxLength) return text || '';
  const sub = text.slice(0, maxLength);
  const lastSpace = sub.lastIndexOf(' ');
  return (lastSpace > 0 ? sub.slice(0, lastSpace) : sub) + '...';
}

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds.
 *
 * @template {(...args: any[]) => void} T
 * @param {T} func
 * @param {number} wait
 * @returns {(...args: Parameters<T>) => void}
 */
export function debounce(func, wait = 250) {
  let timeout = null;
  return function executedFunction(...args) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

/**
 * Validates a redirect URL against open-redirect vulnerabilities.
 * Prevents protocol-relative URLs (//evil.com), backslash tricks (/\evil.com),
 * and absolute scheme URLs (http:, https:, javascript:, data:).
 *
 * @param {string | null | undefined} url
 * @returns {boolean}
 */
export function isSafeRedirectUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('\\')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  return trimmed.startsWith('/') || trimmed.startsWith('index.html') || trimmed.startsWith('#');
}