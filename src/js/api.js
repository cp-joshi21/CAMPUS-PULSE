/**
 * CampusPulse Client API Layer
 * Communicates with Netlify Functions backend endpoints.
 * Handles loading states, network failures, missing backend credentials (503),
 * and structured error responses. Does not fabricate mock responses.
 */

import { CONFIG } from './config.js';
import { authStore } from './auth.js';

class ApiClient {
  constructor() {
    this.baseUrl = CONFIG.API_BASE_URL;
    this.fallbackUrl = CONFIG.FALLBACK_FUNCTIONS_URL;
  }

  /**
   * Internal helper to execute fetch requests with timeouts and error normalization.
   *
   * @param {string} endpoint
   * @param {RequestInit} [options]
   * @returns {Promise<{ success: boolean, data?: any, error?: string, status: number, isConfigMissing?: boolean }>}
   */
  async request(endpoint, options = {}) {
    // Offline detection
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        success: false,
        status: 0,
        error: 'You are currently offline. Please check your internet connection.'
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout for AI calls

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    // Attach Bearer token if user is authenticated
    if (!headers['Authorization'] && !headers['authorization']) {
      try {
        const token = await authStore.getToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch {
        // Proceed unauthenticated
      }
    }

    const config = {
      ...options,
      headers,
      signal: controller.signal
    };

    // Try primary route (/api/...) first, fallback to (/.netlify/functions/...) if 404
    const url = `${this.baseUrl}/${endpoint}`.replace(/\/+/g, '/');

    try {
      let response = await fetch(url, config);

      // If rewrite didn't catch, try direct functions path
      if (response.status === 404 && this.baseUrl !== this.fallbackUrl) {
        const fallback = `${this.fallbackUrl}/${endpoint}`.replace(/\/+/g, '/');
        response = await fetch(fallback, config);
      }

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';
      let payload = null;

      if (contentType.includes('application/json')) {
        try {
          payload = await response.json();
        } catch {
          payload = { error: 'Malformed JSON received from server.' };
        }
      } else {
        const text = await response.text();
        const isHtmlOrRouteNotFound =
          text.includes('<!DOCTYPE') ||
          text.includes('<html') ||
          text.includes('Cannot GET') ||
          text.includes('Cannot POST');

        if (isHtmlOrRouteNotFound) {
          payload = {
            isConfigMissing: true,
            error: 'Backend API service endpoint is not reachable. Ensure Netlify Functions or backend is running.'
          };
        } else {
          payload = text ? { message: text } : {};
        }
      }

      // Check for service configuration errors (e.g. missing API keys / credentials)
      if (response.status === 503 || (payload && payload.isConfigMissing)) {
        return {
          success: false,
          status: response.status || 503,
          isConfigMissing: true,
          error: payload?.error || 'Server backend service credentials are not configured.'
        };
      }

      // Check HTTP error status (400, 404, 405, 500, etc.)
      if (!response.ok) {
        let errorMsg = payload?.error || payload?.message;
        if (!errorMsg || typeof errorMsg !== 'string') {
          switch (response.status) {
            case 400: errorMsg = 'Invalid request parameters.'; break;
            case 404: errorMsg = 'Requested resource not found.'; break;
            case 405: errorMsg = 'HTTP method not allowed for this endpoint.'; break;
            case 500: errorMsg = 'Internal server error. Please try again later.'; break;
            default: errorMsg = `Server responded with status ${response.status}.`;
          }
        }
        return {
          success: false,
          status: response.status,
          error: errorMsg
        };
      }

      // Even if HTTP 200, check if payload specifies an unsuccessful operation
      if (payload && payload.success === false) {
        return {
          success: false,
          status: response.status,
          error: payload.error || 'Server operation was unsuccessful.',
          isConfigMissing: Boolean(payload.isConfigMissing)
        };
      }

      return {
        success: true,
        status: response.status,
        data: payload?.data !== undefined ? payload.data : payload
      };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        return {
          success: false,
          status: 408,
          error: 'Request timed out. The server took too long to respond.'
        };
      }

      return {
        success: false,
        status: 0,
        error: err.message || 'Network error occurred. Unable to connect to server.'
      };
    }
  }

  /**
   * Dispatches raw announcement text to the Gemini AI extractor endpoint.
   *
   * @param {string} rawText
   * @returns {Promise<{ success: boolean, data?: object, error?: string, status: number, isConfigMissing?: boolean }>}
   */
  async extractAnnouncement(rawText) {
    if (!rawText || !rawText.trim()) {
      return {
        success: false,
        status: 400,
        error: 'Announcement text cannot be empty.'
      };
    }

    return this.request('campus-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'extract',
        rawText: rawText.trim()
      })
    });
  }

  /**
   * Saves or updates an event in Firestore via serverless backend.
   *
   * @param {object} eventData
   * @returns {Promise<{ success: boolean, data?: object, error?: string, status: number }>}
   */
  async saveEvent(eventData) {
    if (!eventData || !eventData.title || !eventData.startDate) {
      return {
        success: false,
        status: 400,
        error: 'Event requires at least a title and start date.'
      };
    }

    return this.request('campus-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'save-event',
        event: eventData
      })
    });
  }

  /**
   * Fetches published campus events from Firestore.
   *
   * @param {object} [params]
   * @returns {Promise<{ success: boolean, data?: Array<object>, error?: string, status: number }>}
   */
  async getEvents(params = {}) {
    const query = new URLSearchParams(params).toString();
    const endpoint = `campus-ai?action=get-events${query ? `&${query}` : ''}`;
    return this.request(endpoint, { method: 'GET' });
  }

  /**
   * Fetches a single event by ID.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, data?: object, error?: string, status: number }>}
   */
  async getEventById(id) {
    if (!id) {
      return { success: false, status: 400, error: 'Event ID is required.' };
    }
    return this.request(`campus-ai?action=get-event&id=${encodeURIComponent(id)}`, {
      method: 'GET'
    });
  }

  /**
   * Generates or retrieves an AI-driven weekly campus summary.
   *
   * @returns {Promise<{ success: boolean, data?: object, error?: string, status: number, isConfigMissing?: boolean }>}
   */
  async getWeeklySummary() {
    return this.request('campus-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'weekly-summary'
      })
    });
  }

  /**
   * Archives a campus event.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, error?: string, status: number }>}
   */
  async archiveEvent(id) {
    if (!id) return { success: false, status: 400, error: 'Event ID is required.' };
    return this.request('campus-ai?action=archive-event', {
      method: 'POST',
      body: JSON.stringify({ id })
    });
  }

  /**
   * Verifies current authentication token with backend.
   *
   * @returns {Promise<{ success: boolean, user?: object, error?: string, status: number }>}
   */
  async verifyAuth() {
    return this.request('campus-ai?action=verify-auth', { method: 'GET' });
  }

  /**
   * Saves or updates a personal student task/reminder.
   *
   * @param {object} task
   * @returns {Promise<{ success: boolean, data?: object, error?: string, status: number }>}
   */
  async saveTask(task) {
    return this.request('campus-ai?action=save-task', {
      method: 'POST',
      body: JSON.stringify({ task })
    });
  }

  /**
   * Retrieves personal student tasks.
   *
   * @returns {Promise<{ success: boolean, data?: Array<object>, error?: string, status: number }>}
   */
  async getTasks() {
    return this.request('campus-ai?action=get-tasks', { method: 'GET' });
  }

  /**
   * Deletes a student task.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, error?: string, status: number }>}
   */
  async deleteTask(id) {
    if (!id) return { success: false, status: 400, error: 'Task ID is required.' };
    return this.request('campus-ai?action=delete-task', {
      method: 'POST',
      body: JSON.stringify({ id })
    });
  }
}

export const api = new ApiClient();

