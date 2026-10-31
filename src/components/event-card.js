/**
 * CampusPulse Event Card Component
 * Accessible card representing an individual campus event.
 */

import {
  formatDateDisplay,
  formatTimeDisplay,
  classifyEventPriority,
  sanitizeText,
  truncateText
} from '../js/utils.js';
import { CONFIG } from '../js/config.js';
import { toast } from './toast.js';

/**
 * Creates an event card DOM element.
 *
 * @param {object} event
 * @param {{(event: object): void}} [onSelect]
 * @returns {HTMLElement}
 */
export function createEventCard(event, onSelect) {
  const card = document.createElement('article');
  card.className = 'event-card';
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'article');
  card.setAttribute('aria-labelledby', `event-title-${event.id}`);

  const priority = classifyEventPriority(event.startDate || event.date);
  const priorityInfo = CONFIG.PRIORITIES[priority.toUpperCase().replace('-', '_')] || {
    label: priority,
    badgeClass: `badge-${priority}`
  };

  const categoryMatch = CONFIG.CATEGORIES.find(c => c.id === (event.category || '').toLowerCase());
  const categoryLabel = categoryMatch ? categoryMatch.label : (event.category || 'General');

  const formattedDate = formatDateDisplay(event.startDate || event.date);
  const formattedTime = formatTimeDisplay(event.startDate || event.date);

  card.innerHTML = `
    <header class="event-card-header">
      <div class="event-card-badges">
        <span class="badge ${priorityInfo.badgeClass}" title="Priority level">
          <span class="badge-dot" aria-hidden="true"></span>
          ${sanitizeText(priorityInfo.label)}
        </span>
        <span class="badge badge-category">
          ${sanitizeText(categoryLabel)}
        </span>
      </div>
      <h3 id="event-title-${event.id}" class="event-card-title">
        ${sanitizeText(event.title)}
      </h3>
    </header>

    <div class="event-card-meta">
      <div class="meta-item">
        <svg class="meta-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <span>${formattedDate}${formattedTime ? ` • ${formattedTime}` : ''}</span>
      </div>

      <div class="meta-item">
        <svg class="meta-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        <span>${sanitizeText(event.venue || 'Campus Venue TBD')}</span>
      </div>
    </div>

    <p class="event-card-desc">
      ${sanitizeText(truncateText(event.description || 'No description provided.', 120))}
    </p>

    <footer class="event-card-footer">
      <button type="button" class="btn btn-secondary btn-sm btn-view-details" aria-label="View details for ${sanitizeText(event.title)}">
        View Details
      </button>
      <button type="button" class="btn btn-ghost btn-sm btn-share-event" aria-label="Share event link">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="18" cy="5" r="3"></circle>
          <circle cx="6" cy="12" r="3"></circle>
          <circle cx="18" cy="19" r="3"></circle>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>
        Share
      </button>
    </footer>
  `;

  // Handle card click and keyboard navigation
  const triggerSelect = () => {
    if (typeof onSelect === 'function') {
      onSelect(event);
    }
  };

  card.addEventListener('click', (e) => {
    if (e.target.closest('.btn-share-event')) {
      e.stopPropagation();
      const shareUrl = `${window.location.origin}${window.location.pathname}?event=${event.id}`;
      navigator.clipboard?.writeText(shareUrl)
        .then(() => {
          toast.success('Shareable event link copied to clipboard!');
        })
        .catch(() => {
          toast.info(`Link: ${shareUrl}`);
        });
      return;
    }
    triggerSelect();
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerSelect();
    }
  });

  return card;
}
