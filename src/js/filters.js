/**
 * CampusPulse Filter & Sort Engine
 * Pure, deterministic functions for querying and arranging campus events.
 */

import { parseDateSafely, classifyEventPriority, getPriorityWeight } from './utils.js';

/**
 * Filters an event collection based on search query matching title, description, venue, or category.
 *
 * @param {Array<object>} events
 * @param {string} query
 * @returns {Array<object>}
 */
export function filterBySearch(events, query) {
  if (!Array.isArray(events)) return [];
  if (!query || typeof query !== 'string' || !query.trim()) {
    return [...events];
  }

  const terms = query.toLowerCase().trim().split(/\s+/);

  return events.filter(event => {
    if (!event || typeof event !== 'object') return false;

    const searchableText = [
      event.title || '',
      event.description || '',
      event.venue || '',
      event.category || '',
      event.organizer || '',
      Array.isArray(event.tags) ? event.tags.join(' ') : ''
    ].join(' ').toLowerCase();

    return terms.every(term => searchableText.includes(term));
  });
}

/**
 * Filters an event collection by a specific category.
 * Passing 'all', null, or empty string returns all events.
 *
 * @param {Array<object>} events
 * @param {string} category
 * @returns {Array<object>}
 */
export function filterByCategory(events, category) {
  if (!Array.isArray(events)) return [];
  if (!category || category === 'all' || typeof category !== 'string') {
    return [...events];
  }

  const targetCategory = category.toLowerCase().trim();
  return events.filter(event => {
    if (!event || typeof event !== 'object') return false;
    return (event.category || '').toLowerCase() === targetCategory;
  });
}

/**
 * Filters events by priority classification ('urgent', 'upcoming', 'this-week', 'scheduled', 'expired').
 *
 * @param {Array<object>} events
 * @param {string} priority
 * @param {Date} [referenceDate]
 * @returns {Array<object>}
 */
export function filterByPriority(events, priority, referenceDate = new Date()) {
  if (!Array.isArray(events)) return [];
  if (!priority || priority === 'all' || typeof priority !== 'string') {
    return [...events];
  }

  const targetPriority = priority.toLowerCase().trim();
  return events.filter(event => {
    if (!event || typeof event !== 'object') return false;
    const computedPriority = classifyEventPriority(event.startDate || event.date, referenceDate);
    return computedPriority === targetPriority;
  });
}

/**
 * Sorts events deterministically based on the selected criteria:
 * - 'date-asc': Soonest first
 * - 'date-desc': Latest first
 * - 'priority': Urgent -> Upcoming -> This Week -> Scheduled -> Expired
 * - 'title': Alphabetical A-Z
 *
 * @param {Array<object>} events
 * @param {'date-asc' | 'date-desc' | 'priority' | 'title'} sortBy
 * @param {Date} [referenceDate]
 * @returns {Array<object>}
 */
export function sortEvents(events, sortBy = 'date-asc', referenceDate = new Date()) {
  if (!Array.isArray(events)) return [];
  const copy = [...events];

  return copy.sort((a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;

    switch (sortBy) {
      case 'date-asc': {
        const dateA = parseDateSafely(a.startDate || a.date);
        const dateB = parseDateSafely(b.startDate || b.date);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA.getTime() - dateB.getTime();
      }

      case 'date-desc': {
        const dateA = parseDateSafely(a.startDate || a.date);
        const dateB = parseDateSafely(b.startDate || b.date);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB.getTime() - dateA.getTime();
      }

      case 'priority': {
        const priorityA = classifyEventPriority(a.startDate || a.date, referenceDate);
        const priorityB = classifyEventPriority(b.startDate || b.date, referenceDate);
        const weightDiff = getPriorityWeight(priorityB) - getPriorityWeight(priorityA);
        if (weightDiff !== 0) return weightDiff;

        // Secondary sort: soonest date
        const dateA = parseDateSafely(a.startDate || a.date);
        const dateB = parseDateSafely(b.startDate || b.date);
        if (dateA && dateB) return dateA.getTime() - dateB.getTime();
        return 0;
      }

      case 'title': {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB);
      }

      default:
        return 0;
    }
  });
}

/**
 * Composite query executor that applies search, category, priority filters and sorting.
 *
 * @param {Array<object>} events
 * @param {object} criteria
 * @param {string} [criteria.search]
 * @param {string} [criteria.category]
 * @param {string} [criteria.priority]
 * @param {'date-asc' | 'date-desc' | 'priority' | 'title'} [criteria.sortBy]
 * @param {Date} [referenceDate]
 * @returns {Array<object>}
 */
export function queryEvents(events, criteria = {}, referenceDate = new Date()) {
  if (!Array.isArray(events)) return [];

  let result = [...events];

  if (criteria.search) {
    result = filterBySearch(result, criteria.search);
  }

  if (criteria.category && criteria.category !== 'all') {
    result = filterByCategory(result, criteria.category);
  }

  if (criteria.priority && criteria.priority !== 'all') {
    result = filterByPriority(result, criteria.priority, referenceDate);
  }

  const sortBy = criteria.sortBy || 'date-asc';
  return sortEvents(result, sortBy, referenceDate);
}

