/**
 * CampusPulse Accessible Modal Dialog
 * Implements WAI-ARIA Dialog (Modal) design pattern with focus trapping,
 * keyboard accessibility (Escape), and dynamic view rendering (Event Detail & Extraction Review).
 */

import {
  formatDateDisplay,
  formatTimeDisplay,
  classifyEventPriority,
  sanitizeText,
  normalizeDateForInput,
  normalizeTimeForInput
} from '../js/utils.js';
import { generateICalContent } from '../js/calendar.js';
import { CONFIG } from '../js/config.js';
import { eventStore } from '../js/events.js';
import { authStore } from '../js/auth.js';
import { taskStore } from '../js/tasks.js';
import { toast } from './toast.js';

export class ModalController {
  constructor() {
    this.dialogEl = document.getElementById('app-modal');
    this.modalContentEl = document.getElementById('modal-dynamic-content');
    this.previousActiveElement = null;
    this.boundKeyHandler = this.handleKeyDown.bind(this);

    this.bindBackdrop();
  }

  bindBackdrop() {
    if (this.dialogEl) {
      this.dialogEl.addEventListener('click', (e) => {
        if (e.target === this.dialogEl || e.target.classList.contains('modal-backdrop')) {
          this.close();
        }
      });
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }

    if (e.key === 'Tab') {
      this.trapFocus(e);
    }
  }

  trapFocus(e) {
    if (!this.dialogEl) return;
    const focusable = this.dialogEl.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  open(contentHtml) {
    if (!this.dialogEl || !this.modalContentEl) return;

    this.previousActiveElement = document.activeElement;
    this.modalContentEl.innerHTML = contentHtml;

    this.dialogEl.removeAttribute('hidden');
    this.dialogEl.classList.add('is-open');
    document.body.classList.add('modal-open');

    document.addEventListener('keydown', this.boundKeyHandler);

    // Focus close button or first interactive element
    requestAnimationFrame(() => {
      const closeBtn = this.dialogEl.querySelector('.modal-close');
      if (closeBtn) closeBtn.focus();
    });
  }

  close() {
    if (!this.dialogEl) return;

    this.dialogEl.classList.remove('is-open');
    this.dialogEl.setAttribute('hidden', '');
    document.body.classList.remove('modal-open');

    document.removeEventListener('keydown', this.boundKeyHandler);

    if (this.previousActiveElement && typeof this.previousActiveElement.focus === 'function') {
      this.previousActiveElement.focus();
    }

    eventStore.setSelectedEvent(null);
  }

  /**
   * Renders the Event Detail view in the modal.
   *
   * @param {object} event
   */
  showEventDetail(event) {
    const priority = classifyEventPriority(event.startDate || event.date);
    const priorityInfo = CONFIG.PRIORITIES[priority.toUpperCase().replace('-', '_')] || { label: priority, badgeClass: `badge-${priority}` };
    const categoryMatch = CONFIG.CATEGORIES.find(c => c.id === (event.category || '').toLowerCase());
    const categoryLabel = categoryMatch ? categoryMatch.label : (event.category || 'General');

    const formattedDate = formatDateDisplay(event.startDate || event.date);
    const formattedTime = formatTimeDisplay(event.startDate || event.date);
    const shareUrl = `${window.location.origin}${window.location.pathname}?event=${event.id}`;

    const html = `
      <div class="modal-header">
        <div class="modal-badges">
          <span class="badge ${priorityInfo.badgeClass}">
            <span class="badge-dot" aria-hidden="true"></span>
            ${sanitizeText(priorityInfo.label)}
          </span>
          <span class="badge badge-category">${sanitizeText(categoryLabel)}</span>
        </div>
        <button type="button" class="modal-close" aria-label="Close dialog">&times;</button>
      </div>

      <div class="modal-body">
        <h2 id="modal-title" class="modal-title">${sanitizeText(event.title)}</h2>

        <div class="modal-meta-grid">
          <div class="meta-card">
            <span class="meta-label">Date & Time</span>
            <span class="meta-value">${formattedDate}${formattedTime ? ` at ${formattedTime}` : ''}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Venue</span>
            <span class="meta-value">${sanitizeText(event.venue || 'Campus Venue TBD')}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Category</span>
            <span class="meta-value">${sanitizeText(categoryLabel)}</span>
          </div>
        </div>

        <div class="modal-section">
          <h3>Event Overview</h3>
          <p class="modal-description">${sanitizeText(event.description || 'No detailed description available.')}</p>
        </div>

        ${event.rawSource ? `
          <div class="modal-section modal-raw-source">
            <h3>Original Announcement</h3>
            <blockquote class="raw-quote">${sanitizeText(event.rawSource)}</blockquote>
          </div>
        ` : ''}
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="modal-btn-add-task">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"></path>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          Add to My Tasks
        </button>
        <button type="button" class="btn btn-secondary" id="modal-btn-download-ics">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Export (.ics)
        </button>
        <button type="button" class="btn btn-primary" id="modal-btn-share">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
          Share
        </button>
        ${authStore.isAuthenticated ? `
          <button type="button" class="btn btn-ghost btn-sm" id="modal-btn-archive-event" title="Archive this announcement">
            Archive
          </button>
        ` : ''}
      </div>
    `;

    this.open(html);

    // Bind action buttons
    const closeBtn = this.dialogEl.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    const addTaskBtn = this.dialogEl.querySelector('#modal-btn-add-task');
    if (addTaskBtn) {
      addTaskBtn.addEventListener('click', async () => {
        const res = await taskStore.addTask({
          title: `Attend: ${event.title}`,
          dueDate: event.startDate || event.date,
          priority: priority,
          eventId: event.id
        });
        if (res.success) {
          toast.success('Event successfully added to your tasks & reminders!');
        } else {
          toast.error(res.error || 'Could not save task.');
        }
      });
    }

    const archiveBtn = this.dialogEl.querySelector('#modal-btn-archive-event');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to archive this announcement? It will be removed from active campus views.')) {
          const res = await eventStore.archiveEvent(event.id);
          if (res.success) {
            toast.success('Announcement archived successfully.');
            this.close();
          } else {
            toast.error(res.error || 'Failed to archive event.');
          }
        }
      });
    }

    const icsBtn = this.dialogEl.querySelector('#modal-btn-download-ics');
    if (icsBtn) {
      icsBtn.addEventListener('click', () => {
        const icsData = generateICalContent(event);
        const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
        link.click();
        toast.success('Calendar file downloaded successfully.');
      });
    }

    const shareBtn = this.dialogEl.querySelector('#modal-btn-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(shareUrl)
          .then(() => toast.success('Share link copied to clipboard!'))
          .catch(() => toast.info(`Link: ${shareUrl}`));
      });
    }
  }

  /**
   * Renders the AI Extraction Review interface for verification and saving.
   * Carries all fields (id, tags, urgencyNote, rawSource, start/end date & time)
   * without discarding optional metadata.
   *
   * @param {object} extracted
   * @param {string} [rawSource]
   */
  showExtractionReview(extracted = {}, rawSource = '') {
    const normStartDate = normalizeDateForInput(extracted.startDate || extracted.date);
    const normStartTime = normalizeTimeForInput(extracted.startTime, extracted.startDate || extracted.date);
    const normEndDate = normalizeDateForInput(extracted.endDate);
    const normEndTime = normalizeTimeForInput(extracted.endTime, extracted.endDate);

    const actualRawSource = rawSource || extracted.rawSource || '';
    const tagsString = Array.isArray(extracted.tags) ? extracted.tags.join(', ') : (extracted.tags || '');

    const categoryOptions = CONFIG.CATEGORIES.map(c => `
      <option value="${c.id}" ${(extracted.category || '').toLowerCase() === c.id ? 'selected' : ''}>
        ${c.label}
      </option>
    `).join('');

    const html = `
      <div class="modal-header">
        <div class="modal-badges">
          <span class="badge badge-ai">
            <span class="badge-dot" aria-hidden="true"></span>
            AI Extracted • Review Required
          </span>
        </div>
        <button type="button" class="modal-close" aria-label="Close dialog">&times;</button>
      </div>

      <div class="modal-body">
        <h2 id="modal-title" class="modal-title">Review & Verify Extracted Event</h2>
        <p class="modal-subtitle">Verify details extracted from the announcement before saving to Firestore.</p>

        <form id="form-review-event" class="form-grid">
          <div class="form-group full-width">
            <label for="review-title" class="form-label">Event Title <span class="required" style="color: var(--color-urgent);">*</span></label>
            <input type="text" id="review-title" class="form-input" required value="${sanitizeText(extracted.title || '')}" />
          </div>

          <div class="form-group">
            <label for="review-date" class="form-label">Start Date <span class="required" style="color: var(--color-urgent);">*</span></label>
            <input type="date" id="review-date" class="form-input" required value="${sanitizeText(normStartDate)}" />
          </div>

          <div class="form-group">
            <label for="review-time" class="form-label">Start Time</label>
            <input type="time" id="review-time" class="form-input" value="${sanitizeText(normStartTime)}" />
          </div>

          <div class="form-group">
            <label for="review-end-date" class="form-label">End Date (Optional)</label>
            <input type="date" id="review-end-date" class="form-input" value="${sanitizeText(normEndDate)}" />
          </div>

          <div class="form-group">
            <label for="review-end-time" class="form-label">End Time (Optional)</label>
            <input type="time" id="review-end-time" class="form-input" value="${sanitizeText(normEndTime)}" />
          </div>

          <div class="form-group">
            <label for="review-venue" class="form-label">Venue / Location</label>
            <input type="text" id="review-venue" class="form-input" value="${sanitizeText(extracted.venue || '')}" placeholder="Campus Venue / Room" />
          </div>

          <div class="form-group">
            <label for="review-category" class="form-label">Category</label>
            <select id="review-category" class="form-select">
              ${categoryOptions}
            </select>
          </div>

          <div class="form-group full-width">
            <label for="review-tags" class="form-label">Tags (comma-separated)</label>
            <input type="text" id="review-tags" class="form-input" value="${sanitizeText(tagsString)}" placeholder="e.g. coding, workshop, cs-dept" />
          </div>

          ${extracted.urgencyNote ? `
            <div class="form-group full-width">
              <label for="review-urgency" class="form-label">Urgency / Deadline Note</label>
              <input type="text" id="review-urgency" class="form-input" value="${sanitizeText(extracted.urgencyNote)}" />
            </div>
          ` : ''}

          <div class="form-group full-width">
            <label for="review-description" class="form-label">Description</label>
            <textarea id="review-description" class="form-textarea" rows="3">${sanitizeText(extracted.description || '')}</textarea>
          </div>
        </form>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-close">Cancel</button>
        <button type="button" class="btn btn-primary" id="btn-save-reviewed-event">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Confirm & Save Event
        </button>
      </div>
    `;

    this.open(html);

    // Bind close buttons
    this.dialogEl.querySelectorAll('.modal-close').forEach(b => {
      b.addEventListener('click', () => this.close());
    });

    // Save button with duplicate-submission prevention and resilient error handling
    const saveBtn = this.dialogEl.querySelector('#btn-save-reviewed-event');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        if (saveBtn.disabled) return;

        const title = this.dialogEl.querySelector('#review-title')?.value.trim();
        const date = this.dialogEl.querySelector('#review-date')?.value;
        const time = this.dialogEl.querySelector('#review-time')?.value;
        const endDate = this.dialogEl.querySelector('#review-end-date')?.value;
        const endTime = this.dialogEl.querySelector('#review-end-time')?.value;
        const venue = this.dialogEl.querySelector('#review-venue')?.value.trim();
        const category = this.dialogEl.querySelector('#review-category')?.value;
        const description = this.dialogEl.querySelector('#review-description')?.value.trim();
        const tagsInput = this.dialogEl.querySelector('#review-tags')?.value.trim();
        const urgencyInput = this.dialogEl.querySelector('#review-urgency')?.value.trim();

        if (!title || !date) {
          toast.error('Title and Start Date are required.');
          return;
        }

        // Prevent duplicate submissions while request is executing
        saveBtn.disabled = true;
        const originalHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = `
          <span class="spinner" aria-hidden="true"></span>
          <span>Saving to Firestore...</span>
        `;

        // Normalize full timestamps without inventing missing values
        const fullStartDate = time ? `${date}T${time}:00` : `${date}T00:00:00`;
        let fullEndDate = null;
        if (endDate) {
          fullEndDate = endTime ? `${endDate}T${endTime}:00` : `${endDate}T00:00:00`;
        } else if (extracted.endDate) {
          fullEndDate = extracted.endDate;
        }

        const parsedTags = tagsInput
          ? tagsInput.split(',').map(t => t.trim()).filter(Boolean)
          : (Array.isArray(extracted.tags) ? extracted.tags : []);

        const eventToSave = {
          ...extracted,
          title,
          startDate: fullStartDate,
          endDate: fullEndDate,
          startTime: time || extracted.startTime || null,
          endTime: endTime || extracted.endTime || null,
          venue: venue || 'Campus Venue TBD',
          category: category || 'general',
          description: description || '',
          tags: parsedTags,
          urgencyNote: urgencyInput !== undefined ? urgencyInput : (extracted.urgencyNote || ''),
          rawSource: actualRawSource
        };

        if (extracted.id) {
          eventToSave.id = extracted.id;
        }

        try {
          const result = await eventStore.addEvent(eventToSave);

          if (!result.success) {
            // Restore save button so user can retry without losing edits
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalHtml;

            // Do NOT close modal; preserve user edits for retry
            if (result.isConfigMissing) {
              toast.warning(result.error, 8000);
            } else {
              toast.error(result.error || 'Failed to save event. Please check inputs and retry.');
            }
            return;
          }

          // Confirmed successful save from backend
          toast.success('Event successfully saved to CampusPulse!');
          this.close();
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = originalHtml;
          toast.error(err.message || 'An unexpected error occurred while saving.');
        }
      });
    }
  }

  /**
   * Renders the Login modal with Google Sign-In and Demo Student Leader options.
   */
  showAuthModal() {
    const html = `
      <div class="modal-header">
        <div class="modal-badges">
          <span class="badge badge-ai">
            <span class="badge-dot" aria-hidden="true"></span>
            Campus Identity &amp; Auth
          </span>
        </div>
        <button type="button" class="modal-close" aria-label="Close dialog">&times;</button>
      </div>

      <div class="modal-body auth-modal-body">
        <div class="auth-brand-center">
          <div class="brand-icon auth-logo-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <h2 id="modal-title" class="auth-title">Welcome to CampusPulse</h2>
          <p class="auth-desc">Sign in with your university account to manage personal reminders, track deadlines, and submit announcements.</p>
        </div>

        <div class="auth-options">
          <button type="button" id="modal-btn-google-login" class="btn btn-auth-google">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Sign in with Google</span>
          </button>

          <div class="auth-divider">
            <span>or instant evaluation profile</span>
          </div>

          <button type="button" id="modal-btn-demo-login" class="btn btn-secondary btn-auth-demo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span>Demo Profile: Alex Chen (Student Council President)</span>
          </button>
        </div>
      </div>

      <div class="modal-footer auth-modal-footer">
        <button type="button" class="btn btn-ghost modal-close">Continue as Guest</button>
      </div>
    `;

    this.open(html);

    const closeBtn = this.dialogEl.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    const googleBtn = this.dialogEl.querySelector('#modal-btn-google-login');
    if (googleBtn) {
      googleBtn.addEventListener('click', async () => {
        googleBtn.disabled = true;
        googleBtn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Signing in...`;
        const res = await authStore.signInWithGoogle();
        if (res.success) {
          toast.success(`Welcome, ${res.user.displayName}!`);
          this.close();
        } else {
          toast.warning(res.error || 'Google sign-in could not be completed.');
          googleBtn.disabled = false;
          googleBtn.innerHTML = `<span>Sign in with Google</span>`;
        }
      });
    }

    const demoBtn = this.dialogEl.querySelector('#modal-btn-demo-login');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        authStore.signInDemoUser();
        toast.success('Signed in as Alex Chen (Student Council President).');
        this.close();
      });
    }
  }

  /**
   * Renders the Account Profile modal.
   *
   * @param {object} user
   */
  showAccountModal(user) {
    const html = `
      <div class="modal-header">
        <div class="modal-badges">
          <span class="badge badge-category">Account Settings</span>
        </div>
        <button type="button" class="modal-close" aria-label="Close dialog">&times;</button>
      </div>

      <div class="modal-body">
        <div class="account-profile-header">
          <div class="account-avatar-large" aria-hidden="true">
            ${user.photoURL ? `<img src="${user.photoURL}" alt="" class="user-avatar-img" />` : (user.displayName || 'U').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 id="modal-title" class="account-profile-name">${sanitizeText(user.displayName || 'Campus Student')}</h2>
            <p class="account-profile-email">${sanitizeText(user.email || 'campus.member@university.edu')}</p>
            <span class="badge ${user.isDemo ? 'badge-this-week' : 'badge-category'}" style="margin-top: 0.4rem;">
              ${user.isDemo ? 'Student Council Leader (Demo)' : 'Verified Google Account'}
            </span>
          </div>
        </div>

        <div class="account-details-list">
          <div class="account-detail-row">
            <span class="detail-label">User ID (UID):</span>
            <span class="detail-value font-mono">${sanitizeText(user.uid)}</span>
          </div>
          <div class="account-detail-row">
            <span class="detail-label">Authentication:</span>
            <span class="detail-value">${user.isDemo ? 'Offline Evaluation Token' : 'Google Identity Platform'}</span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-close">Close</button>
        <button type="button" class="btn btn-primary" id="modal-btn-logout">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Sign Out
        </button>
      </div>
    `;

    this.open(html);

    const closeBtn = this.dialogEl.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    const logoutBtn = this.dialogEl.querySelector('#modal-btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await authStore.signOut();
        toast.info('You have been signed out.');
        this.close();
      });
    }
  }

  /**
   * Shows events happening on a specific calendar day.
   *
   * @param {string} dateKey
   * @param {Array<object>} dayEvents
   */
  showDayEventsModal(dateKey, dayEvents = []) {
    const html = `
      <div class="modal-header">
        <div class="modal-badges">
          <span class="badge badge-this-week">Daily Campus Schedule</span>
        </div>
        <button type="button" class="modal-close" aria-label="Close dialog">&times;</button>
      </div>

      <div class="modal-body">
        <h2 id="modal-title" class="modal-title">Events for ${sanitizeText(dateKey)}</h2>
        <p class="modal-subtitle">${dayEvents.length} announcement${dayEvents.length === 1 ? '' : 's'} scheduled for this date.</p>

        <div class="day-events-list" style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem;">
          ${dayEvents.map(e => `
            <div class="day-event-item" style="padding: 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: var(--color-dark); font-size: 1rem; display: block;">${sanitizeText(e.title)}</strong>
                <span style="font-size: 0.85rem; color: var(--color-text-muted);">
                  ${e.venue ? sanitizeText(e.venue) : 'Campus Venue TBD'}
                  ${e.startTime ? ` • ${e.startTime}` : ''}
                </span>
              </div>
              <button type="button" class="btn btn-secondary btn-sm btn-open-day-event" data-event-id="${e.id}">
                View Details
              </button>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-close">Close</button>
      </div>
    `;

    this.open(html);

    const closeBtn = this.dialogEl.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    this.dialogEl.querySelectorAll('.btn-open-day-event').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-event-id');
        const found = eventStore.events.find(e => e.id === id);
        if (found) {
          this.showEventDetail(found);
        }
      });
    });
  }
}

