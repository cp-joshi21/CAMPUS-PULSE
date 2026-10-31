/**
 * CampusPulse Calendar Utilities & View Generator
 * Manages calendar grid calculations, date grouping, and standard .ics export.
 */

import { parseDateSafely, sanitizeText } from './utils.js';

/**
 * Groups an array of events by their YYYY-MM-DD date key.
 *
 * @param {Array<object>} events
 * @returns {Record<string, Array<object>>}
 */
export function groupEventsByDate(events) {
  if (!Array.isArray(events)) return {};

  const groups = {};

  for (const event of events) {
    const date = parseDateSafely(event.startDate || event.date);
    if (!date) continue;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(event);
  }

  return groups;
}

/**
 * Computes calendar month matrix (including days, day-of-week offset, today indicator).
 *
 * @param {number} year
 * @param {number} month 0-indexed (0 = Jan, 11 = Dec)
 * @returns {{
 *   year: number,
 *   month: number,
 *   monthName: string,
 *   totalDays: number,
 *   startDayOfWeek: number,
 *   days: Array<{ dayNumber: number, dateKey: string, isToday: boolean }>
 * }}
 */
export function getMonthMatrix(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay(); // 0 = Sun

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const days = [];
  for (let i = 1; i <= totalDays; i++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    days.push({
      dayNumber: i,
      dateKey,
      isToday: dateKey === todayKey
    });
  }

  const monthName = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return {
    year,
    month,
    monthName,
    totalDays,
    startDayOfWeek,
    days
  };
}

/**
 * Generates an RFC 5545 compliant iCalendar (.ics) string for exporting campus events.
 *
 * @param {object} event
 * @returns {string}
 */
export function generateICalContent(event) {
  if (!event || !event.title) return '';

  const start = parseDateSafely(event.startDate || event.date) || new Date();
  const end = parseDateSafely(event.endDate) || new Date(start.getTime() + 60 * 60 * 1000);

  const formatICSDate = (d) => {
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CampusPulse//Campus Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id || Date.now()}@campuspulse.local`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(start)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${sanitizeText(event.title)}`,
    `DESCRIPTION:${sanitizeText(event.description || '')}`,
    `LOCATION:${sanitizeText(event.venue || '')}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

