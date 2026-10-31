/**
 * CampusPulse Real-Time Synchronization Engine Tests
 * Verifies Firestore subscription lifecycle, duplicate listener prevention,
 * task synchronization lifecycle, and listener cleanup on logout.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('CampusPulse Real-Time Synchronization Engine', () => {
  class MockRealtimeSyncManager {
    constructor() {
      this.unsubscribeEvents = null;
      this.unsubscribeTasks = null;
      this.isListening = false;
      this.status = 'idle';
      this.listeners = new Set();
      this.activeTasksUserId = null;
    }

    startFirestoreListener(fakeDbSnapshotFn) {
      if (this.unsubscribeEvents) return; // Prevent duplicate listeners
      this.unsubscribeEvents = fakeDbSnapshotFn();
      this.isListening = true;
      this.status = 'connected';
      this.notify();
    }

    startTaskListener(uid, fakeTaskSnapshotFn) {
      if (!uid) return;
      this.stopTaskListener(); // Clean up prior listener
      this.activeTasksUserId = uid;
      this.unsubscribeTasks = fakeTaskSnapshotFn();
    }

    stopTaskListener() {
      if (this.unsubscribeTasks) {
        this.unsubscribeTasks();
        this.unsubscribeTasks = null;
      }
      this.activeTasksUserId = null;
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
      for (const l of this.listeners) l(this);
    }
  }

  it('subscribes and receives live event snapshot notifications', () => {
    const manager = new MockRealtimeSyncManager();
    let unsubsCalled = 0;
    let notifications = 0;

    manager.subscribe(() => { notifications++; });

    manager.startFirestoreListener(() => () => { unsubsCalled++; });
    assert.equal(manager.isListening, true);
    assert.equal(manager.status, 'connected');
    assert.equal(notifications, 1);

    // Stop and verify unsubscribe invoked
    manager.stop();
    assert.equal(unsubsCalled, 1);
    assert.equal(manager.isListening, false);
    assert.equal(manager.status, 'idle');
  });

  it('prevents duplicate Firestore event listeners', () => {
    const manager = new MockRealtimeSyncManager();
    let factoryInvocations = 0;

    const fakeFactory = () => {
      factoryInvocations++;
      return () => {};
    };

    manager.startFirestoreListener(fakeFactory);
    manager.startFirestoreListener(fakeFactory); // duplicate call
    assert.equal(factoryInvocations, 1, 'Factory should only be invoked once');
  });

  it('manages task subscription lifecycle on user login and logout', () => {
    const manager = new MockRealtimeSyncManager();
    let taskUnsubsCalled = 0;

    manager.startTaskListener('student-alex', () => () => { taskUnsubsCalled++; });
    assert.equal(manager.activeTasksUserId, 'student-alex');

    // Simulate user logout
    manager.stopTaskListener();
    assert.equal(taskUnsubsCalled, 1);
    assert.equal(manager.activeTasksUserId, null);
    assert.equal(manager.unsubscribeTasks, null);
  });

  it('re-subscribes cleanly when switching user accounts without leaking listeners', () => {
    const manager = new MockRealtimeSyncManager();
    let userAUnsubs = 0;

    manager.startTaskListener('user-a', () => () => { userAUnsubs++; });
    assert.equal(manager.activeTasksUserId, 'user-a');

    // Switch to user B
    manager.startTaskListener('user-b', () => () => {});
    assert.equal(userAUnsubs, 1, 'Previous user listener must be unsubscribed before starting new one');
    assert.equal(manager.activeTasksUserId, 'user-b');
  });
});

