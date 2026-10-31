/**
 * CampusPulse Main Application Entry Point
 * Orchestrates component initialization, state subscriptions, view rendering,
 * and user interactions.
 */

import { eventStore } from './js/events.js';
import { authStore } from './js/auth.js';
import { taskStore } from './js/tasks.js';
import { DashboardController } from './js/dashboard.js';
import { ModalController } from './components/event-modal.js';
import { AnnouncementFormController } from './components/announcement-form.js';
import { TaskManagerController } from './components/task-manager.js';
import { AuthModalController } from './components/auth-modal.js';
import { createEventCard } from './components/event-card.js';
import { groupEventsByDate, getMonthMatrix } from './js/calendar.js';
import { generateWeeklySummary } from './js/ai.js';
import { debounce, sanitizeText } from './js/utils.js';
import { toast } from './components/toast.js';

class CampusPulseApp {
  constructor() {
    this.modal = null;
    this.dashboard = null;
    this.announcementForm = null;
    this.taskManager = null;
    this.authModal = null;

    // Calendar state — tracks which month is being displayed
    this.calendarYear = new Date().getFullYear();
    this.calendarMonth = new Date().getMonth();

    this.eventsListEl = document.getElementById('events-list');
    this.calendarViewEl = document.getElementById('events-calendar-view');
    this.btnViewList = document.getElementById('btn-view-list');
    this.btnViewCalendar = document.getElementById('btn-view-calendar');
    this.searchInput = document.getElementById('global-search-input');
    this.sortSelect = document.getElementById('sort-by-select');
    this.categoryChips = document.querySelectorAll('.category-chips .chip');
    this.btnGenerateSummary = document.getElementById('btn-generate-summary');
    this.summaryContentEl = document.getElementById('summary-content');
  }

  init() {
    // 1. Initialize view and dialog controllers
    this.modal = new ModalController();
    this.dashboard = new DashboardController();
    this.dashboard.init();

    this.announcementForm = new AnnouncementFormController(this.modal);
    this.announcementForm.init();

    this.taskManager = new TaskManagerController();
    this.taskManager.init();

    this.authModal = new AuthModalController(this.modal);
    this.authModal.init();

    // 2. Initialize authentication session
    authStore.init();

    // 3. Bind UI event listeners
    this.bindFilters();
    this.bindViewToggles();
    this.bindSummaryActions();
    this.bindNetworkStatus();
    this.bindRealtimeSync();

    // 4. Subscribe to EventStore changes to re-render views
    eventStore.subscribe(() => {
      this.render();
    });

    // 5. Check for deep link / share URL
    eventStore.checkUrlForSelectedEvent();
    const preselected = eventStore.getSelectedEvent();
    if (preselected) {
      this.modal.showEventDetail(preselected);
    }

    // 6. Initial events load from backend
    eventStore.loadEvents();
  }

  bindRealtimeSync() {
    // Cross-tab & window focus synchronization:
    // When returning to CampusPulse, refresh data without forcing full browser reload
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        eventStore.loadEvents();
        taskStore.loadTasks();
      }
    });

    // Cross-session storage synchronization
    window.addEventListener('storage', (e) => {
      if (e.key === 'campuspulse_auth_user') {
        authStore.init();
      }
      if (e.key === 'campuspulse_tasks_cache') {
        taskStore.loadTasks();
      }
    });
  }

  bindFilters() {
    // Debounced search input
    if (this.searchInput) {
      this.searchInput.addEventListener(
        'input',
        debounce((e) => {
          eventStore.setFilters({ search: e.target.value });
        }, 250)
      );
    }

    // Category chips
    this.categoryChips.forEach(chip => {
      chip.addEventListener('click', () => {
        this.categoryChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const category = chip.getAttribute('data-category') || 'all';
        eventStore.setFilters({ category });
      });
    });

    // Sort select
    if (this.sortSelect) {
      this.sortSelect.addEventListener('change', (e) => {
        eventStore.setFilters({ sortBy: e.target.value });
      });
    }
  }

  bindViewToggles() {
    if (this.btnViewList && this.btnViewCalendar) {
      this.btnViewList.addEventListener('click', () => {
        this.btnViewList.classList.add('active');
        this.btnViewList.setAttribute('aria-pressed', 'true');
        this.btnViewCalendar.classList.remove('active');
        this.btnViewCalendar.setAttribute('aria-pressed', 'false');
        eventStore.setActiveView('list');
      });

      this.btnViewCalendar.addEventListener('click', () => {
        this.btnViewCalendar.classList.add('active');
        this.btnViewCalendar.setAttribute('aria-pressed', 'true');
        this.btnViewList.classList.remove('active');
        this.btnViewList.setAttribute('aria-pressed', 'false');
        eventStore.setActiveView('calendar');
      });
    }
  }

  bindSummaryActions() {
    if (this.btnGenerateSummary && this.summaryContentEl) {
      this.btnGenerateSummary.addEventListener('click', async () => {
        this.btnGenerateSummary.disabled = true;
        this.btnGenerateSummary.innerHTML = `
          <span class="spinner" aria-hidden="true"></span>
          <span>Synthesizing with Gemini AI...</span>
        `;

        try {
          const result = await generateWeeklySummary();
          this.btnGenerateSummary.disabled = false;
          this.btnGenerateSummary.innerHTML = `
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
            </svg>
            Generate Weekly Summary
          `;

          if (!result.success) {
            if (result.isConfigMissing) {
              toast.warning(result.error, 8000);
              this.summaryContentEl.innerHTML = `
                <div class="alert alert-warning" role="alert">
                  <strong>Backend Configuration Notice:</strong>
                  ${sanitizeText(result.error)}
                </div>
              `;
            } else {
              toast.error(result.error);
              this.summaryContentEl.innerHTML = `
                <div class="alert alert-warning" role="alert">
                  <strong>Unable to generate summary:</strong>
                  ${sanitizeText(result.error || 'An error occurred. Please try again.')}
                </div>
              `;
            }
            return;
          }

          const summary = result.data;
          this.summaryContentEl.innerHTML = `
            <div style="margin-bottom: 1rem;">
              <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-dark); margin-bottom: 0.5rem;">
                ${sanitizeText(summary.title || 'Weekly Campus Briefing')}
              </h3>
              <p class="summary-text">${sanitizeText(summary.summaryText || 'No summary text available.')}</p>
            </div>
            ${Array.isArray(summary.highlights) && summary.highlights.length > 0 ? `
              <div>
                <h4 style="font-size: 0.95rem; font-weight: 600; color: var(--color-dark); margin-bottom: 0.5rem;">
                  Key Highlights &amp; Deadlines:
                </h4>
                <ul class="summary-highlights">
                  ${summary.highlights.map(h => `
                    <li class="summary-highlight-item">
                      <span class="highlight-bullet" aria-hidden="true"></span>
                      <span>${sanitizeText(h)}</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            ` : ''}
            <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 1rem;">
              Generated at ${sanitizeText(summary.generatedAt ? new Date(summary.generatedAt).toLocaleString() : new Date().toLocaleString())}
            </p>
          `;

          toast.success('Weekly campus briefing generated successfully.');
        } catch (err) {
          this.btnGenerateSummary.disabled = false;
          this.btnGenerateSummary.innerHTML = `
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
            </svg>
            Generate Weekly Summary
          `;
          toast.error(err.message || 'Failed to generate weekly briefing.');
        }
      });
    }
  }

  bindNetworkStatus() {
    window.addEventListener('online', () => {
      toast.success('Network connection restored. Syncing events...');
      eventStore.loadEvents();
    });

    window.addEventListener('offline', () => {
      toast.warning('You are currently offline. CampusPulse is operating in local cached mode.');
    });
  }

  render() {
    const isCalendarView = eventStore.activeView === 'calendar';

    if (isCalendarView) {
      if (this.eventsListEl) {
        this.eventsListEl.setAttribute('hidden', '');
        this.eventsListEl.classList.add('is-hidden');
      }
      if (this.calendarViewEl) {
        this.calendarViewEl.removeAttribute('hidden');
        this.calendarViewEl.classList.remove('is-hidden');
        this.renderCalendarView();
      }
    } else {
      if (this.calendarViewEl) {
        this.calendarViewEl.setAttribute('hidden', '');
        this.calendarViewEl.classList.add('is-hidden');
      }
      if (this.eventsListEl) {
        this.eventsListEl.removeAttribute('hidden');
        this.eventsListEl.classList.remove('is-hidden');
        this.renderListView();
      }
    }
  }

  renderListView() {
    if (!this.eventsListEl) return;

    const filtered = eventStore.getFilteredEvents();
    this.eventsListEl.innerHTML = '';

    if (eventStore.isLoading) {
      this.eventsListEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--color-text-muted);">
          <span class="spinner" aria-hidden="true"></span>
          <p style="margin-top: 0.75rem;">Loading campus announcements...</p>
        </div>
      `;
      return;
    }

    if (eventStore.error) {
      this.eventsListEl.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; border-color: rgba(220, 38, 38, 0.3);">
          <div class="empty-icon" style="color: var(--color-urgent); background: var(--color-urgent-bg);" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h3 class="empty-title">Unable to Load Events</h3>
          <p class="empty-desc">${sanitizeText(eventStore.error)}</p>
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      const hasEventsInStore = eventStore.events.length > 0;
      this.eventsListEl.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </div>
          <h3 class="empty-title">
            ${hasEventsInStore ? 'No matching events found' : 'No campus announcements yet'}
          </h3>
          <p class="empty-desc">
            ${hasEventsInStore
              ? 'Try adjusting your search terms or selecting a different category filter.'
              : 'Paste an announcement, circular, or departmental email above and click "Extract with AI" to add structured campus events.'
            }
          </p>
        </div>
      `;
      return;
    }

    // Render cards
    for (const event of filtered) {
      const card = createEventCard(event, (selected) => {
        this.modal.showEventDetail(selected);
      });
      this.eventsListEl.appendChild(card);
    }
  }

  renderCalendarView() {
    if (!this.calendarViewEl) return;

    const events = eventStore.getFilteredEvents();
    const grouped = groupEventsByDate(events);
    const matrix = getMonthMatrix(this.calendarYear, this.calendarMonth);

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let html = `
      <div class="calendar-header">
        <button type="button" class="btn btn-ghost btn-sm" id="calendar-prev-month" aria-label="Previous month">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div>
          <h3 class="calendar-title">${sanitizeText(matrix.monthName)}</h3>
          <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; text-align: center;">Campus Event Schedule</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="calendar-next-month" aria-label="Next month">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <div class="calendar-weekdays" aria-hidden="true">
        ${weekdays.map(w => `<div>${w}</div>`).join('')}
      </div>

      <div class="calendar-grid" role="grid" aria-label="Calendar for ${sanitizeText(matrix.monthName)}">
    `;

    // Blank cells before month start
    for (let i = 0; i < matrix.startDayOfWeek; i++) {
      html += `<div class="calendar-cell empty" role="gridcell" aria-hidden="true"></div>`;
    }

    // Day cells
    for (const day of matrix.days) {
      const dayEvents = grouped[day.dateKey] || [];
      const cellClasses = ['calendar-cell'];
      if (day.isToday) cellClasses.push('today');

      html += `
        <div class="${cellClasses.join(' ')}" role="gridcell" aria-label="${day.dateKey}${day.isToday ? ' (Today)' : ''}">
          <span class="cell-date" aria-hidden="true">${day.dayNumber}</span>
          <div class="cell-events">
            ${dayEvents.map(e => `
              <button
                type="button"
                class="cell-pill"
                title="${sanitizeText(e.title)}"
                data-event-id="${e.id}"
                aria-label="View event: ${sanitizeText(e.title)}"
              >${sanitizeText(e.title)}</button>
            `).join('')}
          </div>
        </div>
      `;
    }

    html += `</div>`;
    this.calendarViewEl.innerHTML = html;

    // Month navigation
    const prevBtn = this.calendarViewEl.querySelector('#calendar-prev-month');
    const nextBtn = this.calendarViewEl.querySelector('#calendar-next-month');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.calendarMonth--;
        if (this.calendarMonth < 0) {
          this.calendarMonth = 11;
          this.calendarYear--;
        }
        this.renderCalendarView();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.calendarMonth++;
        if (this.calendarMonth > 11) {
          this.calendarMonth = 0;
          this.calendarYear++;
        }
        this.renderCalendarView();
      });
    }

    // Add click listeners to event pills in calendar
    this.calendarViewEl.querySelectorAll('.cell-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const eventId = pill.getAttribute('data-event-id');
        const found = eventStore.events.find(e => e.id === eventId);
        if (found) {
          this.modal.showEventDetail(found);
        }
      });
    });
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new CampusPulseApp();
  app.init();
});
