/**
 * CampusPulse Event Store & State Manager
 * Maintains reactive state for loaded events, active filters, and selected views.
 * Zero hardcoded mock data.
 */

import { api } from './api.js';
import { queryEvents } from './filters.js';
import { classifyEventPriority } from './utils.js';

class EventStore {
  constructor() {
    /** @type {Array<object>} */
    this.events = [];
    this.isLoading = false;
    this.error = null;
    this.selectedEventId = null;
    this.listeners = new Set();

    this.filters = {
      search: '',
      category: 'all',
      priority: 'all',
      sortBy: 'date-asc'
    };

    this.activeView = 'list'; // 'list' | 'calendar'
  }

  /**
   * Subscribes a listener callback to store changes.
   *
   * @param {() => void} listener
   * @returns {() => void} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }

  /**
   * Fetches published campus events from the backend.
   */
  async loadEvents() {
    this.isLoading = true;
    this.error = null;
    this.notify();

    const response = await api.getEvents();

    this.isLoading = false;

    if (response.success && Array.isArray(response.data)) {
      this.events = response.data.map(event => ({
        ...event,
        priority: classifyEventPriority(event.startDate || event.date)
      }));
    } else {
      // If backend is not yet populated or offline, reflect state without crash
      this.events = [];
      if (!response.success && !response.isConfigMissing) {
        this.error = response.error || 'Unable to connect to events service.';
      }
    }

    this.notify();
  }

  /**
   * Synchronizes events directly from real-time Firestore snapshots.
   *
   * @param {Array<object>} liveEvents
   */
  syncFromRealtime(liveEvents) {
    if (!Array.isArray(liveEvents)) return;
    this.events = liveEvents.map(event => ({
      ...event,
      priority: classifyEventPriority(event.startDate || event.date)
    }));
    this.isLoading = false;
    this.error = null;
    this.notify();
  }

  /**
   * Archives an event and removes it from active collections.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async archiveEvent(id) {
    if (!id) return { success: false, error: 'Event ID required.' };
    const response = await api.archiveEvent(id);
    if (response.success) {
      this.events = this.events.filter(e => e.id !== id);
      this.notify();
      return { success: true };
    }
    return { success: false, error: response.error || 'Failed to archive event.' };
  }

  /**
   * Returns filtered and sorted events based on current criteria.
   *
   * @returns {Array<object>}
   */
  getFilteredEvents() {
    return queryEvents(this.events, this.filters);
  }

  /**
   * Returns metrics breakdown: today, upcoming, this-week, expired.
   *
   * @returns {{ today: number, upcoming: number, thisWeek: number, expired: number, total: number }}
   */
  getMetrics() {
    let today = 0;
    let upcoming = 0;
    let thisWeek = 0;
    let expired = 0;

    const now = new Date();
    for (const event of this.events) {
      const priority = classifyEventPriority(event.startDate || event.date, now);
      switch (priority) {
        case 'urgent': today++; break;
        case 'upcoming': upcoming++; break;
        case 'this-week': thisWeek++; break;
        case 'expired': expired++; break;
      }
    }

    return {
      today,
      upcoming,
      thisWeek,
      expired,
      total: this.events.length
    };
  }

  /**
   * Updates filter state.
   *
   * @param {Partial<{ search: string, category: string, priority: string, sortBy: string }>} patch
   */
  setFilters(patch) {
    this.filters = { ...this.filters, ...patch };
    this.notify();
  }

  /**
   * Switches active view mode.
   *
   * @param {'list' | 'calendar'} view
   */
  setActiveView(view) {
    if (view === 'list' || view === 'calendar') {
      this.activeView = view;
      this.notify();
    }
  }

  /**
   * Sets the selected event ID for details modal and syncs URL.
   *
   * @param {string | null} id
   */
  setSelectedEvent(id) {
    this.selectedEventId = id;
    this.syncUrlWithSelectedEvent(id);
    this.notify();
  }

  /**
   * Gets the currently selected event object.
   *
   * @returns {object | null}
   */
  getSelectedEvent() {
    if (!this.selectedEventId) return null;
    return this.events.find(e => e.id === this.selectedEventId) || null;
  }

  /**
   * Saves an event by awaiting backend persistence first,
   * then adding the canonical saved event to the collection.
   * Does NOT perform optimistic in-memory additions that mask save failures.
   *
   * @param {object} eventData
   * @returns {Promise<{ success: boolean, data?: object, error?: string, status?: number, isConfigMissing?: boolean }>}
   */
  async addEvent(eventData) {
    if (!eventData || !eventData.title || !eventData.startDate) {
      return {
        success: false,
        status: 400,
        error: 'Event requires at least a title and start date.'
      };
    }

    // Await backend save request before altering in-memory event collection
    const response = await api.saveEvent(eventData);

    if (!response.success || !response.data) {
      return {
        success: false,
        status: response.status || 500,
        isConfigMissing: response.isConfigMissing,
        error: response.error || 'Failed to save event to Firestore database.'
      };
    }

    // Canonical event confirmed and returned by backend
    const canonicalEvent = {
      ...response.data,
      priority: classifyEventPriority(response.data.startDate || response.data.date)
    };

    // Add or update canonical event in collection
    const existingIndex = this.events.findIndex(e => e.id === canonicalEvent.id);
    if (existingIndex >= 0) {
      this.events[existingIndex] = canonicalEvent;
    } else {
      this.events = [canonicalEvent, ...this.events];
    }

    this.notify();

    return {
      success: true,
      data: canonicalEvent
    };
  }

  /**
   * Synchronizes browser URL parameter with the currently viewed event.
   *
   * @param {string | null} id
   */
  syncUrlWithSelectedEvent(id) {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('event', id);
    } else {
      url.searchParams.delete('event');
    }
    window.history.replaceState({}, '', url.toString());
  }

  /**
   * Checks URL query parameters for an initial event to open.
   */
  checkUrlForSelectedEvent() {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get('event');
    if (eventId) {
      this.selectedEventId = eventId;
      this.notify();
    }
  }
}

export const eventStore = new EventStore();

