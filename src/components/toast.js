/**
 * CampusPulse Toast Notification Component
 * Accessible, temporary notification banners with polite aria-live announcements.
 */

import { sanitizeText } from '../js/utils.js';

class ToastManager {
  constructor() {
    this.container = null;
    this.ensureContainer();
  }

  ensureContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'System notifications');
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    this.container = container;
  }

  /**
   * Displays a toast notification.
   *
   * @param {string} message
   * @param {'info' | 'success' | 'warning' | 'error'} [type]
   * @param {number} [duration] In milliseconds
   */
  show(message, type = 'info', duration = 4000) {
    this.ensureContainer();

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const iconMap = {
      info: 'ℹ',
      success: '✓',
      warning: '⚠',
      error: '✕'
    };

    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${iconMap[type] || 'ℹ'}</span>
      <span class="toast-message">${sanitizeText(message)}</span>
      <button type="button" class="toast-close" aria-label="Dismiss notification">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    let timer = null;

    const removeToast = () => {
      if (timer) clearTimeout(timer);
      toast.classList.add('toast-exit');
      setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 300);
    };

    closeBtn.addEventListener('click', removeToast);

    // Pause dismissal on mouse hover or keyboard focus
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => {
      timer = setTimeout(removeToast, duration);
    });

    this.container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      toast.classList.add('toast-enter');
    });

    timer = setTimeout(removeToast, duration);
  }

  info(msg, dur) { this.show(msg, 'info', dur); }
  success(msg, dur) { this.show(msg, 'success', dur); }
  warning(msg, dur) { this.show(msg, 'warning', dur); }
  error(msg, dur) { this.show(msg, 'error', dur); }
}

export const toast = new ToastManager();

