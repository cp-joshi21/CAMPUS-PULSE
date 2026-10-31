/**
 * CampusPulse Client Configuration
 * Locked Design Tokens, Categories, and API Endpoints
 */

export const CONFIG = Object.freeze({
  APP_NAME: 'CampusPulse',
  APP_TAGLINE: 'Everything happening on your campus. One intelligent place.',
  API_BASE_URL: '/api', // Netlify Functions rewrite: /api/* -> /.netlify/functions/*
  FALLBACK_FUNCTIONS_URL: '/.netlify/functions',
  TIMEZONE: 'Asia/Kolkata',
  CATEGORIES: [
    { id: 'academic', label: 'Academic & Exams', color: '#0E7C86' },
    { id: 'cultural', label: 'Cultural & Fests', color: '#8B5CF6' },
    { id: 'sports', label: 'Sports & Athletics', color: '#F59E0B' },
    { id: 'career', label: 'Career & Placement', color: '#10B981' },
    { id: 'workshop', label: 'Workshops & Seminars', color: '#3B82F6' },
    { id: 'club', label: 'Club Activities', color: '#EC4899' },
    { id: 'general', label: 'General Notices', color: '#64748B' }
  ],
  PRIORITIES: {
    EXPIRED: { id: 'expired', label: 'Expired', weight: 0, badgeClass: 'badge-expired' },
    URGENT: { id: 'urgent', label: 'Urgent (Today)', weight: 4, badgeClass: 'badge-urgent' },
    UPCOMING: { id: 'upcoming', label: 'Upcoming (24h)', weight: 3, badgeClass: 'badge-upcoming' },
    THIS_WEEK: { id: 'this-week', label: 'This Week', weight: 2, badgeClass: 'badge-this-week' },
    SCHEDULED: { id: 'scheduled', label: 'Scheduled', weight: 1, badgeClass: 'badge-scheduled' }
  },
  FIREBASE_CLIENT: {
    apiKey: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_API_KEY) || 'AIzaSyDdvXB4FM2BnNhgzh_33z_5HORmeDRafck',
    authDomain: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN) || 'campus-pulse-291af.firebaseapp.com',
    projectId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_PROJECT_ID) || 'campus-pulse-291af',
    storageBucket: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET) || 'campus-pulse-291af.firebasestorage.app',
    messagingSenderId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID) || '406553050541',
    appId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_APP_ID) || '1:406553050541:web:6cd054882904506532b524',
    measurementId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID) || 'G-D0FNMJTH3V'
  }
});

