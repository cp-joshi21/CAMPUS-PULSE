/**
 * CampusPulse Task & Reminder Manager Component
 * Controls personal student tasks, filter switching, completion states,
 * and accessible DOM rendering.
 */

import { taskStore } from '../js/tasks.js';
import { authStore } from '../js/auth.js';
import { formatDateDisplay, sanitizeText } from '../js/utils.js';
import { toast } from './toast.js';

export class TaskManagerController {
  constructor() {
    this.listEl = document.getElementById('tasks-list');
    this.formEl = document.getElementById('form-add-task');
    this.titleInput = document.getElementById('task-input-title');
    this.dateInput = document.getElementById('task-input-date');
    this.priorityInput = document.getElementById('task-input-priority');
    this.filterChips = document.querySelectorAll('[data-task-filter]');
  }

  init() {
    this.bindForm();
    this.bindFilters();

    // Subscribe to taskStore state updates
    taskStore.subscribe(() => {
      this.render();
    });

    // Initial load
    taskStore.loadTasks();
  }

  bindForm() {
    if (!this.formEl) return;

    this.formEl.addEventListener('submit', async (e) => {
      e.preventDefault();

      const title = this.titleInput ? this.titleInput.value.trim() : '';
      const date = this.dateInput ? this.dateInput.value : '';
      const priority = this.priorityInput ? this.priorityInput.value : 'upcoming';

      if (!title) {
        toast.warning('Please enter a task title.');
        return;
      }

      const result = await taskStore.addTask({
        title,
        dueDate: date ? `${date}T23:59:00` : null,
        priority
      });

      if (!result.success) {
        toast.error(result.error || 'Failed to add task.');
        return;
      }

      // Reset form
      if (this.titleInput) this.titleInput.value = '';
      if (this.dateInput) this.dateInput.value = '';
      toast.success('Task added to your academic schedule!');
    });
  }

  bindFilters() {
    this.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        this.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const filter = chip.getAttribute('data-task-filter') || 'all';
        taskStore.setFilter(filter);
      });
    });
  }

  render() {
    if (!this.listEl) return;

    const tasks = taskStore.getFilteredTasks();
    this.listEl.innerHTML = '';

    if (tasks.length === 0) {
      this.listEl.innerHTML = `
        <div class="empty-state" style="padding: 2.5rem 1.5rem;">
          <div class="empty-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 11l3 3L22 4"></path>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
          </div>
          <h3 class="empty-title">No ${taskStore.filter === 'all' ? '' : taskStore.filter + ' '}tasks found</h3>
          <p class="empty-desc">
            ${taskStore.filter === 'completed'
              ? 'Completed tasks will appear here once marked complete.'
              : 'Add upcoming assignments, lab reports, or campus reminders using the form above.'}
          </p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const task of tasks) {
      const item = document.createElement('div');
      item.className = `task-item ${task.completed ? 'is-completed' : ''}`;
      item.setAttribute('data-task-id', task.id);

      const priorityBadgeClass = `badge-${task.priority || 'upcoming'}`;
      const priorityLabel = (task.priority || 'upcoming').replace('-', ' ').toUpperCase();
      const formattedDue = task.dueDate ? formatDateDisplay(task.dueDate) : 'No deadline';

      item.innerHTML = `
        <label class="task-checkbox-label">
          <input
            type="checkbox"
            class="task-checkbox"
            ${task.completed ? 'checked' : ''}
            aria-label="Mark task '${sanitizeText(task.title)}' as ${task.completed ? 'incomplete' : 'complete'}"
          />
          <span class="custom-checkbox" aria-hidden="true"></span>
        </label>

        <div class="task-info">
          <span class="task-title">${sanitizeText(task.title)}</span>
          <div class="task-meta">
            <span class="badge ${priorityBadgeClass}">${sanitizeText(priorityLabel)}</span>
            <span class="task-due-date">
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              ${sanitizeText(formattedDue)}
            </span>
          </div>
        </div>

        <button type="button" class="btn btn-ghost btn-sm btn-delete-task" aria-label="Delete task">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;

      // Checkbox event
      const checkbox = item.querySelector('.task-checkbox');
      if (checkbox) {
        checkbox.addEventListener('change', async () => {
          await taskStore.toggleTask(task.id);
        });
      }

      // Delete event
      const deleteBtn = item.querySelector('.btn-delete-task');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await taskStore.deleteTask(task.id);
          if (res.success) {
            toast.info('Task removed.');
          } else {
            toast.error(res.error || 'Failed to delete task.');
          }
        });
      }

      fragment.appendChild(item);
    }

    this.listEl.appendChild(fragment);
  }
}

