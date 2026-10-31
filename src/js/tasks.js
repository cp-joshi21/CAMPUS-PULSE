/**
 * CampusPulse Personal Tasks & Reminders Store
 * Manages authenticated student reminders, completion states,
 * event-linked tasks, and local/remote synchronization.
 */

import { api } from './api.js';
import { authStore } from './auth.js';
import { classifyEventPriority } from './utils.js';

class TaskStore {
  constructor() {
    this.tasks = [];
    this.isLoading = false;
    this.error = null;
    this.filter = 'all'; // 'all' | 'active' | 'completed'
    this.listeners = new Set();
    this.STORAGE_KEY = 'campuspulse_tasks_cache';
  }

  /**
   * Subscribes a listener to store changes.
   *
   * @param {() => void} listener
   * @returns {() => void}
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
        console.error('TaskStore listener error:', err);
      }
    }
  }

  /**
   * Loads tasks from backend or user-scoped local cache.
   */
  async loadTasks() {
    this.isLoading = true;
    this.error = null;
    this.notify();

    // Check local scoped cache first
    try {
      const cached = localStorage.getItem(this.STORAGE_KEY);
      if (cached) {
        this.tasks = JSON.parse(cached);
      }
    } catch {
      // Storage restricted
    }

    if (authStore.isAuthenticated) {
      const response = await api.getTasks();
      if (response.success && Array.isArray(response.data)) {
        this.tasks = response.data.map(t => ({
          ...t,
          priority: t.priority || classifyEventPriority(t.dueDate)
        }));
        this.persist();
      } else if (!response.success && !response.isConfigMissing) {
        this.error = response.error || 'Unable to sync tasks with server.';
      }
    }

    this.isLoading = false;
    this.notify();
  }

  /**
   * Creates a new task and persists it.
   *
   * @param {object} taskData
   * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
   */
  async addTask(taskData) {
    if (!taskData || !taskData.title || !taskData.title.trim()) {
      return { success: false, error: 'Task title is required.' };
    }

    const payload = {
      title: taskData.title.trim(),
      description: taskData.description ? taskData.description.trim() : '',
      dueDate: taskData.dueDate || null,
      priority: taskData.priority || 'upcoming',
      completed: false,
      eventId: taskData.eventId || null
    };

    if (authStore.isAuthenticated) {
      const response = await api.saveTask(payload);
      if (response.success && response.data) {
        const saved = response.data;
        this.tasks = [saved, ...this.tasks];
        this.persist();
        this.notify();
        return { success: true, data: saved };
      }
      return { success: false, error: response.error || 'Failed to save task to server.' };
    }

    // Local mode for unauthenticated preview or demo
    const localTask = {
      ...payload,
      id: `local-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.tasks = [localTask, ...this.tasks];
    this.persist();
    this.notify();

    return { success: true, data: localTask };
  }

  /**
   * Toggles task completion state.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
   */
  async toggleTask(id) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return { success: false, error: 'Task not found.' };

    const updated = {
      ...task,
      completed: !task.completed,
      updatedAt: new Date().toISOString()
    };

    if (authStore.isAuthenticated && !id.startsWith('local-task-')) {
      const response = await api.saveTask(updated);
      if (response.success && response.data) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index >= 0) this.tasks[index] = response.data;
        this.persist();
        this.notify();
        return { success: true, data: response.data };
      }
      return { success: false, error: response.error || 'Failed to update task.' };
    }

    const index = this.tasks.findIndex(t => t.id === id);
    if (index >= 0) this.tasks[index] = updated;
    this.persist();
    this.notify();

    return { success: true, data: updated };
  }

  /**
   * Deletes a task.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async deleteTask(id) {
    if (authStore.isAuthenticated && !id.startsWith('local-task-')) {
      const response = await api.deleteTask(id);
      if (!response.success) {
        return { success: false, error: response.error || 'Failed to delete task from server.' };
      }
    }

    this.tasks = this.tasks.filter(t => t.id !== id);
    this.persist();
    this.notify();

    return { success: true };
  }

  setFilter(filter) {
    if (['all', 'active', 'completed'].includes(filter)) {
      this.filter = filter;
      this.notify();
    }
  }

  getFilteredTasks() {
    let result = [...this.tasks];

    if (this.filter === 'active') {
      result = result.filter(t => !t.completed);
    } else if (this.filter === 'completed') {
      result = result.filter(t => t.completed);
    }

    // Sort: incomplete tasks first, then by due date
    return result.sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }

  getPendingCount() {
    return this.tasks.filter(t => !t.completed).length;
  }

  persist() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.tasks));
    } catch {
      // Storage restricted
    }
  }

  clear() {
    this.tasks = [];
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch {
      // Storage restricted
    }
    this.notify();
  }
}

export const taskStore = new TaskStore();

// Automatically synchronize tasks with user authentication lifecycle
authStore.subscribe((auth) => {
  if (auth && auth.isAuthenticated) {
    taskStore.loadTasks();
  } else {
    taskStore.clear();
  }
});
