/**
 * CampusPulse Real-Time Synchronization Engine
 * Listens for live Firestore database changes, cross-tab visibility updates,
 * and manages network online/offline resilience.
 */

import { CONFIG } from './config.js';
import { eventStore } from './events.js';
import { taskStore } from './tasks.js';
import { authStore } from './auth.js';
import { subscribeEvents, subscribeUserTasks } from './firebase.js';
import { toast } from '../components/toast.js';

class RealtimeSyncManager {
  constructor() {
    this.unsubscribeEvents = null;
    this.unsubscribeTasks = null;
    this.isListening = false;
    this.status = 'idle'; // 'idle' | 'connected' | 'reconnecting' | 'offline'
    this.listeners = new Set();
    this.lastSyncTime = null;
  }

  /**
   * Initializes real-time listeners and visibility handlers.
   */
  async init() {
    this.bindWindowEvents();
    this.bindAuthLifecycle();
    await this.startFirestoreListener();
  }

  bindAuthLifecycle() {
    authStore.subscribe((auth) => {
      if (auth && auth.isAuthenticated && auth.currentUser?.uid) {
        this.startTaskListener(auth.currentUser.uid);
      } else {
        this.stopTaskListener();
      }
    });
  }

  bindWindowEvents() {
    // Cross-tab / Window refocus synchronization
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const timeSinceSync = Date.now() - (this.lastSyncTime || 0);
        // If more than 30 seconds since last sync, trigger refresh
        if (timeSinceSync > 30000) {
          eventStore.loadEvents();
          taskStore.loadTasks();
          this.lastSyncTime = Date.now();
        }
      }
    });

    window.addEventListener('focus', () => {
      const timeSinceSync = Date.now() - (this.lastSyncTime || 0);
      if (timeSinceSync > 30000) {
        eventStore.loadEvents();
        taskStore.loadTasks();
        this.lastSyncTime = Date.now();
      }
    });

    window.addEventListener('online', () => {
      this.status = 'connected';
      this.notify();
      toast.success('Connection restored. Synchronizing campus intelligence...');
      eventStore.loadEvents();
      taskStore.loadTasks();
    });

    window.addEventListener('offline', () => {
      this.status = 'offline';
      this.notify();
      toast.warning('Offline mode active. CampusPulse is operating with local cache.');
    });
  }

  async startFirestoreListener() {
    if (this.unsubscribeEvents) return; // Prevent duplicate listeners

    const clientCfg = CONFIG.FIREBASE_CLIENT;
    const hasKeys = Boolean(clientCfg && clientCfg.apiKey && clientCfg.projectId);

    if (!hasKeys) {
      this.status = 'connected'; // Operates in polling/eventStore sync mode
      this.lastSyncTime = Date.now();
      this.notify();
      return;
    }

    try {
      this.unsubscribeEvents = await subscribeEvents(
        (liveEvents) => {
          this.status = 'connected';
          this.lastSyncTime = Date.now();
          this.notify();
          eventStore.syncFromRealtime(liveEvents);
        },
        (error) => {
          console.warn('Real-time listener notice (relying on REST API):', error.message);
          this.status = 'reconnecting';
          this.notify();
        }
      );
      this.isListening = true;
    } catch (err) {
      console.warn('Real-time Firestore initialization notice:', err.message);
      this.status = 'connected';
      this.notify();
    }
  }

  async startTaskListener(uid) {
    if (!uid) return;
    this.stopTaskListener(); // Ensure no duplicate task listeners

    const clientCfg = CONFIG.FIREBASE_CLIENT;
    const hasKeys = Boolean(clientCfg && clientCfg.apiKey && clientCfg.projectId);
    if (!hasKeys) return;

    try {
      this.unsubscribeTasks = await subscribeUserTasks(
        uid,
        (liveTasks) => {
          taskStore.tasks = liveTasks;
          taskStore.persist();
          taskStore.notify();
        },
        (error) => {
          console.warn('Real-time tasks listener notice:', error.message);
        }
      );
    } catch (err) {
      console.warn('Real-time task listener notice:', err.message);
    }
  }

  stopTaskListener() {
    if (this.unsubscribeTasks) {
      this.unsubscribeTasks();
      this.unsubscribeTasks = null;
    }
  }

  stop() {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    this.stopTaskListener();
    this.isListening = false;
    this.status = 'idle';
    this.notify();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (err) {
        console.error('RealtimeSyncManager listener error:', err);
      }
    }
  }
}

export const realtimeManager = new RealtimeSyncManager();
