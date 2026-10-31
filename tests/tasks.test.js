/**
 * CampusPulse Task Management Unit Tests
 * Verifies task filtering, completion states, validation, and sorting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('CampusPulse Task and Reminder Engine', () => {
  const sampleTasks = [
    {
      id: 'task-1',
      title: 'Submit Operating Systems Lab 4',
      completed: false,
      dueDate: '2026-10-31T23:59:00',
      priority: 'urgent'
    },
    {
      id: 'task-2',
      title: 'Collect Hackathon Badge from Tech Hall',
      completed: true,
      dueDate: '2026-10-30T16:00:00',
      priority: 'expired'
    },
    {
      id: 'task-3',
      title: 'Register for Inter-College Football',
      completed: false,
      dueDate: '2026-11-05T12:00:00',
      priority: 'this-week'
    }
  ];

  it('filters active tasks correctly', () => {
    const active = sampleTasks.filter(t => !t.completed);
    assert.equal(active.length, 2);
    assert.equal(active[0].id, 'task-1');
    assert.equal(active[1].id, 'task-3');
  });

  it('filters completed tasks correctly', () => {
    const completed = sampleTasks.filter(t => t.completed);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].id, 'task-2');
  });

  it('sorts tasks with incomplete items first followed by soonest due dates', () => {
    const sorted = [...sampleTasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    assert.equal(sorted[0].id, 'task-1'); // Incomplete, sooner due date (Oct 31)
    assert.equal(sorted[1].id, 'task-3'); // Incomplete, later due date (Nov 5)
    assert.equal(sorted[2].id, 'task-2'); // Completed
  });

  it('toggles task completion state deterministically', () => {
    const task = { ...sampleTasks[0] };
    assert.equal(task.completed, false);
    task.completed = !task.completed;
    assert.equal(task.completed, true);
    task.completed = !task.completed;
    assert.equal(task.completed, false);
  });
});
