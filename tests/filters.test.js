import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterBySearch,
  filterByCategory,
  filterByPriority,
  sortEvents,
  queryEvents
} from '../src/js/filters.js';

describe('CampusPulse Search and Category Filtering', () => {
  const sampleEvents = [
    {
      id: '1',
      title: 'Annual Hackathon 2026',
      description: 'Exciting 24-hour coding challenge at the main auditorium',
      venue: 'Main Auditorium',
      category: 'academic',
      startDate: '2026-10-31T18:00:00'
    },
    {
      id: '2',
      title: 'Inter-College Football Tournament',
      description: 'Championship match on the central sports ground',
      venue: 'Sports Arena',
      category: 'sports',
      startDate: '2026-11-01T09:00:00'
    },
    {
      id: '3',
      title: 'AI and Robotics Seminar',
      description: 'Deep dive into LLMs and autonomous systems',
      venue: 'Tech Hall B',
      category: 'workshop',
      startDate: '2026-11-03T14:00:00'
    },
    {
      id: '4',
      title: 'Cultural Fest Orientation',
      description: 'Introduction to music and dance club activities',
      venue: 'Open Air Amphitheatre',
      category: 'cultural',
      startDate: '2026-10-25T10:00:00' // expired
    }
  ];

  it('filters events by search query matching title, description or venue', () => {
    const searchHack = filterBySearch(sampleEvents, 'hackathon');
    assert.equal(searchHack.length, 1);
    assert.equal(searchHack[0].id, '1');

    const searchTech = filterBySearch(sampleEvents, 'hall b');
    assert.equal(searchTech.length, 1);
    assert.equal(searchTech[0].id, '3');

    const searchNone = filterBySearch(sampleEvents, 'nonexistent query term');
    assert.equal(searchNone.length, 0);

    const withOrganizer = [{ id: '5', title: 'Workshop', organizer: 'Robotics Club', startDate: '2026-11-10T10:00:00' }];
    assert.equal(filterBySearch(withOrganizer, 'robotics').length, 1);
  });

  it('returns all events when search query is empty or whitespace', () => {
    assert.equal(filterBySearch(sampleEvents, '').length, 4);
    assert.equal(filterBySearch(sampleEvents, '   ').length, 4);
    assert.equal(filterBySearch(sampleEvents, null).length, 4);
  });

  it('filters events strictly by category', () => {
    const sportsOnly = filterByCategory(sampleEvents, 'sports');
    assert.equal(sportsOnly.length, 1);
    assert.equal(sportsOnly[0].title, 'Inter-College Football Tournament');

    const allCat = filterByCategory(sampleEvents, 'all');
    assert.equal(allCat.length, 4);

    const noneCat = filterByCategory(sampleEvents, 'nonexistent');
    assert.equal(noneCat.length, 0);
  });

  it('handles empty collections and invalid inputs safely', () => {
    assert.deepEqual(filterBySearch([], 'test'), []);
    assert.deepEqual(filterBySearch(null, 'test'), []);
    assert.deepEqual(filterByCategory([], 'sports'), []);
    assert.deepEqual(filterByCategory(null, 'sports'), []);
  });
});

describe('CampusPulse Sorting and Query Engine', () => {
  const reference = new Date('2026-10-31T10:00:00');

  const events = [
    { id: 'a', title: 'Zebra Discussion', startDate: '2026-11-05T10:00:00' }, // scheduled
    { id: 'b', title: 'Alpha Hackathon', startDate: '2026-10-31T14:00:00' },  // urgent (today)
    { id: 'c', title: 'Beta Workshop', startDate: '2026-11-01T08:00:00' },    // upcoming (24h)
    { id: 'd', title: 'Past Gathering', startDate: '2026-10-20T10:00:00' }   // expired
  ];

  it('sorts events by date ascending (soonest first)', () => {
    const sorted = sortEvents(events, 'date-asc');
    assert.equal(sorted[0].id, 'd'); // 2026-10-20
    assert.equal(sorted[1].id, 'b'); // 2026-10-31
    assert.equal(sorted[2].id, 'c'); // 2026-11-01
    assert.equal(sorted[3].id, 'a'); // 2026-11-05
  });

  it('sorts events by date descending (latest first)', () => {
    const sorted = sortEvents(events, 'date-desc');
    assert.equal(sorted[0].id, 'a'); // 2026-11-05
    assert.equal(sorted[3].id, 'd'); // 2026-10-20
  });

  it('sorts events by priority weight (urgent first)', () => {
    const sorted = sortEvents(events, 'priority', reference);
    assert.equal(sorted[0].id, 'b'); // urgent
    assert.equal(sorted[1].id, 'c'); // upcoming
    assert.equal(sorted[2].id, 'a'); // scheduled
    assert.equal(sorted[3].id, 'd'); // expired
  });

  it('sorts events alphabetically by title', () => {
    const sorted = sortEvents(events, 'title');
    assert.equal(sorted[0].title, 'Alpha Hackathon');
    assert.equal(sorted[1].title, 'Beta Workshop');
    assert.equal(sorted[3].title, 'Zebra Discussion');
  });

  it('filters events by priority correctly', () => {
    const urgentEvents = filterByPriority(events, 'urgent', reference);
    assert.equal(urgentEvents.length, 1);
    assert.equal(urgentEvents[0].id, 'b');

    const expiredEvents = filterByPriority(events, 'expired', reference);
    assert.equal(expiredEvents.length, 1);
    assert.equal(expiredEvents[0].id, 'd');
  });

  it('combines search, category, priority and sorting via queryEvents', () => {
    const mixed = [
      { id: '1', title: 'Hackathon 1', category: 'academic', startDate: '2026-10-31T12:00:00' },
      { id: '2', title: 'Hackathon 2', category: 'academic', startDate: '2026-11-01T08:00:00' },
      { id: '3', title: 'Music Night', category: 'cultural', startDate: '2026-10-31T19:00:00' }
    ];

    const result = queryEvents(mixed, {
      search: 'hackathon',
      category: 'academic',
      priority: 'urgent',
      sortBy: 'date-asc'
    }, reference);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });
});

