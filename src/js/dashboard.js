/**
 * CampusPulse Dashboard View Manager
 * Controls sidebar navigation, header metrics, view toggling, and dashboard statistics.
 */

import { eventStore } from './events.js';
import { taskStore } from './tasks.js';
import { formatDateDisplay } from './utils.js';

export class DashboardController {
  constructor() {
    this.currentNav = 'dashboard';
    this.initElements();
  }

  initElements() {
    this.currentDateEl = document.getElementById('header-current-date');
    this.metricTodayEl = document.getElementById('metric-today-count');
    this.metricUpcomingEl = document.getElementById('metric-upcoming-count');
    this.metricThisWeekEl = document.getElementById('metric-thisweek-count');
    this.metricExpiredEl = document.getElementById('metric-expired-count');
    this.taskBadgeEl = document.getElementById('nav-task-badge');
    this.navLinks = document.querySelectorAll('[data-nav-target]');
    // The announcement section is toggled independently of events
    this.announcementSection = document.getElementById('section-announcement');
    // 'calendar' reuses section-events — no separate section-calendar element exists in HTML
    this.sections = {
      dashboard: document.getElementById('section-dashboard'),
      events: document.getElementById('section-events'),
      calendar: document.getElementById('section-events'), // same DOM node, different view mode
      tasks: document.getElementById('section-tasks'),
      summary: document.getElementById('section-summary')
    };
  }

  init() {
    this.updateHeaderDate();
    this.bindNavigation();
    this.updateMetrics();
    this.updateTaskBadge();

    eventStore.subscribe(() => {
      this.updateMetrics();
    });

    taskStore.subscribe(() => {
      this.updateTaskBadge();
    });

    // Handle deep-link hash on initial page load
    const initialHash = window.location.hash.replace('#', '');
    if (initialHash && ['dashboard', 'events', 'calendar', 'tasks', 'summary'].includes(initialHash)) {
      this.navigateTo(initialHash);
    }
  }

  updateTaskBadge() {
    if (this.taskBadgeEl) {
      const pending = taskStore.getPendingCount();
      this.taskBadgeEl.textContent = String(pending);
      this.taskBadgeEl.style.display = pending > 0 ? 'inline-flex' : 'none';
    }
  }

  updateHeaderDate() {
    if (this.currentDateEl) {
      this.currentDateEl.textContent = formatDateDisplay(new Date(), {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    }
  }

  updateMetrics() {
    const metrics = eventStore.getMetrics();

    if (this.metricTodayEl) this.metricTodayEl.textContent = String(metrics.today);
    if (this.metricUpcomingEl) this.metricUpcomingEl.textContent = String(metrics.upcoming);
    if (this.metricThisWeekEl) this.metricThisWeekEl.textContent = String(metrics.thisWeek);
    if (this.metricExpiredEl) this.metricExpiredEl.textContent = String(metrics.expired);
  }

  bindNavigation() {
    this.navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = link.getAttribute('data-nav-target');
        if (target) {
          this.navigateTo(target);
        }
      });
    });

    // Mobile nav hamburger toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('app-sidebar');
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', () => {
        const isOpen = sidebar.classList.toggle('open');
        mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
      });
    }
  }

  navigateTo(targetNav) {
    this.currentNav = targetNav;

    // Update active nav link indicators
    this.navLinks.forEach(link => {
      const isCurrent = link.getAttribute('data-nav-target') === targetNav;
      link.classList.toggle('active', isCurrent);
      link.setAttribute('aria-current', isCurrent ? 'page' : 'false');
    });

    const dashboardSection = this.sections.dashboard;
    const eventsSection = this.sections.events; // section-events (shared by 'events' and 'calendar')
    const summarySection = this.sections.summary;

    // Dashboard metrics bar: shown only on the 'dashboard' landing view
    if (dashboardSection) {
      if (targetNav === 'dashboard') {
        dashboardSection.removeAttribute('hidden');
        dashboardSection.classList.remove('is-hidden');
      } else {
        dashboardSection.setAttribute('hidden', '');
        dashboardSection.classList.add('is-hidden');
      }
    }

    // Announcement input card: shown on 'dashboard' and 'events' — hidden on 'calendar' and 'summary'
    if (this.announcementSection) {
      if (targetNav === 'dashboard' || targetNav === 'events') {
        this.announcementSection.removeAttribute('hidden');
        this.announcementSection.classList.remove('is-hidden');
      } else {
        this.announcementSection.setAttribute('hidden', '');
        this.announcementSection.classList.add('is-hidden');
      }
    }

    // Events section (contains both list and calendar views): shown for dashboard and events
    if (eventsSection) {
      if (targetNav === 'dashboard' || targetNav === 'events' || targetNav === 'calendar') {
        eventsSection.removeAttribute('hidden');
        eventsSection.classList.remove('is-hidden');
      } else {
        eventsSection.setAttribute('hidden', '');
        eventsSection.classList.add('is-hidden');
      }
    }

    // Switch active view mode when Calendar or Events is clicked directly
    const btnViewList = document.getElementById('btn-view-list');
    const btnViewCalendar = document.getElementById('btn-view-calendar');

    if (targetNav === 'calendar') {
      eventStore.setActiveView('calendar');
      if (btnViewList && btnViewCalendar) {
        btnViewList.classList.remove('active');
        btnViewList.setAttribute('aria-pressed', 'false');
        btnViewCalendar.classList.add('active');
        btnViewCalendar.setAttribute('aria-pressed', 'true');
      }
    } else if (targetNav === 'events' || targetNav === 'dashboard') {
      if (eventStore.activeView !== 'list' && targetNav === 'events') {
        eventStore.setActiveView('list');
        if (btnViewList && btnViewCalendar) {
          btnViewList.classList.add('active');
          btnViewList.setAttribute('aria-pressed', 'true');
          btnViewCalendar.classList.remove('active');
          btnViewCalendar.setAttribute('aria-pressed', 'false');
        }
      }
    }

    // Tasks & Reminders section
    const tasksSection = this.sections.tasks;
    if (tasksSection) {
      if (targetNav === 'tasks') {
        tasksSection.removeAttribute('hidden');
        tasksSection.classList.remove('is-hidden');
      } else {
        tasksSection.setAttribute('hidden', '');
        tasksSection.classList.add('is-hidden');
      }
    }

    // Weekly Summary section
    if (summarySection) {
      if (targetNav === 'summary') {
        summarySection.removeAttribute('hidden');
        summarySection.classList.remove('is-hidden');
      } else {
        summarySection.setAttribute('hidden', '');
        summarySection.classList.add('is-hidden');
      }
    }

    // Close mobile drawer on selection
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      const mobileMenuBtn = document.getElementById('mobile-menu-btn');
      if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }

    // Keep URL hash in sync without reloading
    if (window.location.hash !== `#${targetNav}`) {
      window.history.replaceState(null, '', `#${targetNav}`);
    }

    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
