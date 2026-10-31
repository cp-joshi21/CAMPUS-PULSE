import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDate,
  parseDateSafely,
  isEventExpired,
  classifyEventPriority,
  getPriorityWeight,
  sanitizeText,
  truncateText
} from '../src/js/utils.js';

describe('CampusPulse Date Utilities', () => {
  it('validates correct ISO date strings', () => {
    assert.equal(isValidDate('2026-10-31T10:00:00Z'), true);
    assert.equal(isValidDate('2026-11-05'), true);
    assert.equal(isValidDate(new Date()), true);
    assert.equal(isValidDate(1730371200000), true);
  });

  it('rejects invalid dates, null, undefined, and non-date values', () => {
    assert.equal(isValidDate(null), false);
    assert.equal(isValidDate(undefined), false);
    assert.equal(isValidDate(''), false);
    assert.equal(isValidDate('not-a-date'), false);
    assert.equal(isValidDate('2026-99-99'), false);
  });

  it('parses date safely without throwing', () => {
    const valid = parseDateSafely('2026-10-31T12:00:00Z');
    assert.ok(valid instanceof Date);
    assert.equal(valid.getUTCFullYear(), 2026);

    assert.equal(parseDateSafely('invalid'), null);
    assert.equal(parseDateSafely(null), null);
    assert.equal(parseDateSafely(undefined), null);
  });

  it('detects expired events correctly', () => {
    const reference = new Date('2026-10-31T12:00:00Z');
    const pastEvent = '2026-10-30T10:00:00Z';
    const futureEvent = '2026-11-01T10:00:00Z';

    assert.equal(isEventExpired(pastEvent, reference), true);
    assert.equal(isEventExpired(futureEvent, reference), false);
    assert.equal(isEventExpired('invalid-date', reference), false);
  });
});

describe('CampusPulse Priority Classification Algorithm', () => {
  const reference = new Date('2026-10-31T10:00:00'); // Saturday Oct 31, 2026, 10:00 AM local

  it('classifies past event as expired', () => {
    const past = new Date('2026-10-30T18:00:00');
    assert.equal(classifyEventPriority(past, reference), 'expired');
  });

  it('classifies event on the same calendar day as urgent (today)', () => {
    const todayEvening = new Date('2026-10-31T19:00:00');
    assert.equal(classifyEventPriority(todayEvening, reference), 'urgent');
  });

  it('classifies event within next 24 hours on next calendar day as upcoming', () => {
    // Tomorrow morning: Nov 1 at 08:00 AM (22 hours from reference 10:00 AM)
    const tomorrowMorning = new Date('2026-11-01T08:00:00');
    assert.equal(classifyEventPriority(tomorrowMorning, reference), 'upcoming');
  });

  it('classifies event within 7 days as this-week', () => {
    // 4 days later: Nov 4 at 14:00
    const fourDaysLater = new Date('2026-11-04T14:00:00');
    assert.equal(classifyEventPriority(fourDaysLater, reference), 'this-week');
  });

  it('classifies event beyond 7 days as scheduled', () => {
    // 14 days later: Nov 14 at 10:00
    const twoWeeksLater = new Date('2026-11-14T10:00:00');
    assert.equal(classifyEventPriority(twoWeeksLater, reference), 'scheduled');
  });

  it('returns scheduled for invalid or missing dates as fallback', () => {
    assert.equal(classifyEventPriority(null, reference), 'scheduled');
    assert.equal(classifyEventPriority('invalid', reference), 'scheduled');
  });

  it('returns accurate numeric weights for sorting', () => {
    assert.equal(getPriorityWeight('urgent'), 4);
    assert.equal(getPriorityWeight('upcoming'), 3);
    assert.equal(getPriorityWeight('this-week'), 2);
    assert.equal(getPriorityWeight('scheduled'), 1);
    assert.equal(getPriorityWeight('expired'), 0);
  });
});

describe('CampusPulse Sanitization and Text Utilities', () => {
  it('escapes dangerous HTML characters', () => {
    const dirty = '<script>alert("xss")</script> & "quote" \'single\'';
    const clean = sanitizeText(dirty);
    assert.equal(clean.includes('<script>'), false);
    assert.equal(clean.includes('&lt;script&gt;'), true);
    assert.equal(clean.includes('&amp;'), true);
    assert.equal(clean.includes('&quot;'), true);
  });

  it('handles null and undefined safely in sanitizeText', () => {
    assert.equal(sanitizeText(null), '');
    assert.equal(sanitizeText(undefined), '');
  });

  it('truncates text with ellipsis at word boundaries', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const truncated = truncateText(text, 20);
    assert.equal(truncated, 'The quick brown fox...');
  });
});
