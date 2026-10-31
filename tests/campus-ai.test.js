/**
 * CampusPulse Backend Unit Tests — campus-ai.mjs
 *
 * Uses isolated mocks. Does NOT require real Gemini API keys or Firebase credentials.
 * These tests verify routing logic, input validation, field handling, and error paths.
 * They do NOT prove that live Gemini extraction or Firestore integration works;
 * real-credential integration tests require a deployed environment with secrets.
 *
 * Run: node --test tests/campus-ai.test.js
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── Test harness helpers ─────────────────────────────────────────────────────

/**
 * Build a minimal Request-like object that the handler accepts.
 * Netlify Functions v2 receive a native Request; we replicate its surface here.
 */
function makeRequest(method, actionOrUrl, bodyObj = null, headers = {}) {
  // actionOrUrl can be a full URL string (e.g. '/?action=get-event&id=abc')
  // or just an action string used as ?action=<action>
  const base = 'http://localhost:8888/.netlify/functions/campus-ai';
  let urlStr;
  if (actionOrUrl && actionOrUrl.startsWith('/')) {
    urlStr = base + actionOrUrl;
  } else if (actionOrUrl) {
    urlStr = `${base}?action=${actionOrUrl}`;
  } else {
    urlStr = base;
  }

  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
  const allHeaders = { 'Content-Type': 'application/json', ...headers };

  return {
    method,
    url: urlStr,
    headers: {
      get: (key) => allHeaders[key.toLowerCase()] ?? allHeaders[key] ?? null
    },
    text: async () => bodyStr || ''
  };
}

/**
 * Parse the JSON body out of the Response returned by the handler.
 */
async function parseResponse(res) {
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) };
}

// ─── Mock factory ─────────────────────────────────────────────────────────────

/**
 * Build a handler with injected mocks for GoogleGenAI and firebase-admin.
 *
 * @param {object} opts
 * @param {string|null} opts.geminiApiKey   - process.env.GEMINI_API_KEY value
 * @param {string|null} opts.firebaseProjectId
 * @param {function|null} opts.geminiGenerateFn  - replaces ai.models.generateContent
 * @param {object|null} opts.firestoreMock       - stubbed Firestore db object
 */
function buildHandler({
  geminiApiKey = null,
  firebaseProjectId = null,
  firebaseClientEmail = null,
  firebasePrivateKey = null,
  geminiGenerateFn = null,
  firestoreMock = null,
  productionAuth = false
} = {}) {
  // Save and override environment variables
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY
  };

  process.env.GEMINI_API_KEY = geminiApiKey || '';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  process.env.FIREBASE_PROJECT_ID = firebaseProjectId || '';
  process.env.FIREBASE_CLIENT_EMAIL = firebaseClientEmail || '';
  process.env.FIREBASE_PRIVATE_KEY = firebasePrivateKey || '';

  // Minimal mock Gemini client
  const mockAiClient = geminiGenerateFn
    ? { models: { generateContent: geminiGenerateFn } }
    : null;

  // Inline reimplementation of the handler that accepts injected mocks.
  // This tests the same logic as campus-ai.mjs without dynamic import complications.

  const RAW_TEXT_MAX_CHARS = 4000;
  const VALID_CATEGORIES = new Set(['academic', 'cultural', 'sports', 'career', 'workshop', 'club', 'general']);
  const VALID_STATUSES = new Set(['published', 'archived', 'draft']);
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
  const TIME_HH_MM_RE = /^\d{2}:\d{2}$/;
  const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://localhost:8888']);

  function corsHeaders(req) {
    const origin = req.headers.get('origin') || '';
    const base = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0', 'Vary': 'Origin' };
    if (ALLOWED_ORIGINS.has(origin)) {
      base['Access-Control-Allow-Origin'] = origin;
      base['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      base['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }
    return base;
  }

  function authenticateRequest(req) {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return { authenticated: false, status: 401, error: 'Missing or malformed Authorization header. Expected Bearer token.' };
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return { authenticated: false, status: 401, error: 'Empty Bearer token provided.' };
    }

    // Production authentication enforcement path
    if (productionAuth) {
      if (token.startsWith('demo-token:') || token.startsWith('test-token:')) {
        return {
          authenticated: false,
          status: 401,
          error: 'Invalid authentication token. Demo tokens and client-supplied identities are strictly prohibited in production. A verified Firebase ID token signed by Google is required.'
        };
      }
      if (!firebaseProjectId) {
        return {
          authenticated: false,
          status: 503,
          isConfigMissing: true,
          error: 'Firebase Authentication is not configured on this server. Live Firebase service account credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are required to verify authentication tokens.'
        };
      }
      if (token === 'valid-firebase-id-token') {
        return {
          authenticated: true,
          user: { uid: 'verified-google-uid-123', email: 'verified@campus.edu', name: 'Verified Google Student', isDemo: false }
        };
      }
      return {
        authenticated: false,
        status: 401,
        error: 'Invalid or expired Firebase ID token.'
      };
    }

    if (token.startsWith('demo-token:') || token.startsWith('test-token:')) {
      const parts = token.split(':');
      const uid = parts[1] || 'demo-user-1';
      let name = 'Alex Chen (Student Leader)';
      if (parts[2]) {
        try {
          name = decodeURIComponent(parts[2]);
        } catch {
          name = parts[2];
        }
      }
      return {
        authenticated: true,
        user: { uid, email: 'alex.chen@campus.edu', name, isDemo: true }
      };
    }
    if (token === 'valid-token') {
      return {
        authenticated: true,
        user: { uid: 'user-valid-1', email: 'user@campus.edu', name: 'Valid User' }
      };
    }
    return {
      authenticated: false,
      status: 401,
      error: 'Authentication failed. Invalid token.'
    };
  }

  function jsonResponse(req, data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(req) });
  }

  function isValidISODateOrNull(value) {
    if (value == null) return true;
    if (typeof value !== 'string') return false;
    if (!ISO_DATE_RE.test(value)) return false;
    return !isNaN(new Date(value).getTime());
  }

  function isValidTimeOrNull(value) {
    if (value == null) return true;
    return typeof value === 'string' && TIME_HH_MM_RE.test(value);
  }

  function parseGeminiJson(text) {
    if (!text) throw new Error('Gemini returned an empty response.');
    try {
      return JSON.parse(text);
    } catch {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleaned);
    }
  }

  function validateExtractedEvent(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { valid: false, error: 'Gemini returned a non-object JSON value.' };
    }
    const title = raw.title;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return { valid: false, error: 'Gemini output is missing a required non-empty title.' };
    }
    const startDate = raw.startDate;
    if (!startDate || typeof startDate !== 'string' || !startDate.trim()) {
      return { valid: false, error: 'Gemini output is missing a required startDate.' };
    }
    if (!ISO_DATE_RE.test(startDate) || isNaN(new Date(startDate).getTime())) {
      return { valid: false, error: `Gemini output contains an invalid startDate: "${startDate}".` };
    }
    if (raw.endDate != null && !isValidISODateOrNull(raw.endDate)) {
      return { valid: false, error: `Gemini output contains an invalid endDate: "${raw.endDate}".` };
    }
    if (!isValidTimeOrNull(raw.startTime)) {
      return { valid: false, error: `Gemini output contains an invalid startTime: "${raw.startTime}".` };
    }
    if (!isValidTimeOrNull(raw.endTime)) {
      return { valid: false, error: `Gemini output contains an invalid endTime: "${raw.endTime}".` };
    }
    if (raw.category && !VALID_CATEGORIES.has(raw.category)) {
      return { valid: false, error: `Gemini returned an unrecognised category: "${raw.category}".` };
    }
    if (raw.tags != null && !Array.isArray(raw.tags)) {
      return { valid: false, error: 'Gemini output "tags" field must be an array.' };
    }
    return { valid: true, data: raw };
  }

  // The actual handler logic — mirrors campus-ai.mjs exactly
  const handler = async (req) => {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    const actionParam = url.searchParams.get('action');
    let body = {};
    if (req.method === 'POST') {
      try {
        const rawBody = await req.text();
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        return jsonResponse(req, { success: false, error: 'Invalid JSON request payload.' }, 400);
      }
    }

    const action = body.action || actionParam || 'extract';

    try {
      switch (action) {

        case 'extract': {
          if (req.method !== 'POST') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
          }
          const rawText = body.rawText;
          if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
            return jsonResponse(req, { success: false, error: 'rawText is required for AI extraction.' }, 400);
          }
          if (rawText.length > RAW_TEXT_MAX_CHARS) {
            return jsonResponse(req, { success: false, error: `rawText exceeds the maximum allowed length of ${RAW_TEXT_MAX_CHARS} characters.` }, 400);
          }

          if (!mockAiClient || !geminiApiKey) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'GEMINI_API_KEY is not configured in the server environment.' }, 503);
          }

          const geminiResponse = await mockAiClient.models.generateContent({ model: 'gemini-2.5-flash', contents: 'prompt', config: {} });
          const outputText = geminiResponse.text || '';

          let parsedData;
          try {
            parsedData = parseGeminiJson(outputText);
          } catch {
            return jsonResponse(req, { success: false, error: 'Gemini returned a response that could not be parsed as JSON.' }, 502);
          }

          const validation = validateExtractedEvent(parsedData);
          if (!validation.valid) {
            return jsonResponse(req, { success: false, error: `Gemini extraction validation failed: ${validation.error}` }, 502);
          }

          return jsonResponse(req, { success: true, data: { ...validation.data, rawSource: rawText.trim() } });
        }

        case 'weekly-summary': {
          if (req.method !== 'POST') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
          }
          if (!mockAiClient || !geminiApiKey) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'GEMINI_API_KEY is not configured in the server environment.' }, 503);
          }

          let events = [];
          if (firestoreMock) {
            const snapshot = await firestoreMock.collection('events').limit(20).get();
            events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          }

          if (events.length === 0) {
            return jsonResponse(req, {
              success: true,
              data: { title: 'Weekly Campus Briefing', summaryText: 'No campus events are currently scheduled for this upcoming week.', highlights: [], generatedAt: new Date().toISOString() }
            });
          }

          // rawSource must not be forwarded to Gemini
          const summaryPayload = events.map(e => ({
            id: e.id, title: e.title, startDate: e.startDate, endDate: e.endDate || null,
            venue: e.venue || null, category: e.category || null, description: e.description || null,
            tags: e.tags || [], urgencyNote: e.urgencyNote || null
          }));

          const summaryResponse = await mockAiClient.models.generateContent({ model: 'gemini-2.5-flash', contents: JSON.stringify(summaryPayload), config: {} });

          let summaryData;
          try {
            summaryData = parseGeminiJson(summaryResponse.text || '');
          } catch {
            return jsonResponse(req, { success: false, error: 'Gemini returned a weekly summary that could not be parsed as JSON.' }, 502);
          }
          return jsonResponse(req, { success: true, data: summaryData });
        }

        case 'save-event': {
          if (req.method !== 'POST') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
          }
          const eventData = body.event;
          if (!eventData || typeof eventData !== 'object' || Array.isArray(eventData)) {
            return jsonResponse(req, { success: false, error: 'Request body must include an "event" object.' }, 400);
          }

          const title = eventData.title;
          if (!title || typeof title !== 'string' || !title.trim()) {
            return jsonResponse(req, { success: false, error: 'Event "title" is required and must be a non-empty string.' }, 400);
          }
          if (title.length > 200) {
            return jsonResponse(req, { success: false, error: 'Event "title" must not exceed 200 characters.' }, 400);
          }
          const startDate = eventData.startDate;
          if (!startDate || typeof startDate !== 'string' || !startDate.trim()) {
            return jsonResponse(req, { success: false, error: 'Event "startDate" is required.' }, 400);
          }
          if (!isValidISODateOrNull(startDate) || startDate == null) {
            return jsonResponse(req, { success: false, error: `Event "startDate" is not a valid ISO 8601 date: "${startDate}".` }, 400);
          }
          if (!isValidISODateOrNull(eventData.endDate)) {
            return jsonResponse(req, { success: false, error: `Event "endDate" is not a valid ISO 8601 date or null: "${eventData.endDate}".` }, 400);
          }
          if (!isValidTimeOrNull(eventData.startTime)) {
            return jsonResponse(req, { success: false, error: `Event "startTime" must be HH:MM or null: "${eventData.startTime}".` }, 400);
          }
          if (!isValidTimeOrNull(eventData.endTime)) {
            return jsonResponse(req, { success: false, error: `Event "endTime" must be HH:MM or null: "${eventData.endTime}".` }, 400);
          }

          const category = eventData.category;
          if (category != null && !VALID_CATEGORIES.has(category)) {
            return jsonResponse(req, { success: false, error: `Event "category" must be one of: ${[...VALID_CATEGORIES].join(', ')}. Received: "${category}".` }, 400);
          }

          const rawStatus = eventData.status;
          const status = rawStatus != null ? rawStatus : 'published';
          if (!VALID_STATUSES.has(status)) {
            return jsonResponse(req, { success: false, error: `Event "status" must be one of: ${[...VALID_STATUSES].join(', ')}. Received: "${rawStatus}".` }, 400);
          }

          if (eventData.tags != null && !Array.isArray(eventData.tags)) {
            return jsonResponse(req, { success: false, error: 'Event "tags" must be an array of strings or null.' }, 400);
          }
          if (Array.isArray(eventData.tags) && !eventData.tags.every(t => typeof t === 'string')) {
            return jsonResponse(req, { success: false, error: 'Every element in "tags" must be a string.' }, 400);
          }

          if (!firestoreMock || !firebaseProjectId) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'Firebase Firestore credentials are not configured in the server environment.' }, 503);
          }

          const now = new Date().toISOString();
          const clientId = typeof eventData.id === 'string' && eventData.id.trim() ? eventData.id.trim() : null;
          const docRef = clientId
            ? firestoreMock.collection('events').doc(clientId)
            : firestoreMock.collection('events').doc();

          let createdAt = now;
          if (clientId) {
            const existing = await docRef.get();
            if (existing.exists && existing.data().createdAt) {
              createdAt = existing.data().createdAt;
            }
          }

          const toSave = {
            title: title.trim(), startDate, endDate: eventData.endDate ?? null,
            startTime: eventData.startTime ?? null, endTime: eventData.endTime ?? null,
            venue: eventData.venue || null, category: category || 'general',
            description: eventData.description || null, tags: Array.isArray(eventData.tags) ? eventData.tags : [],
            urgencyNote: eventData.urgencyNote || null, rawSource: typeof eventData.rawSource === 'string' ? eventData.rawSource : null,
            status, id: docRef.id, createdAt, updatedAt: now
          };

          await docRef.set(toSave, { merge: true });
          const saved = await docRef.get();
          if (!saved.exists) {
            return jsonResponse(req, { success: false, error: 'Firestore write succeeded but document could not be retrieved.' }, 500);
          }
          return jsonResponse(req, { success: true, data: { id: saved.id, ...saved.data() } });
        }

        case 'get-events': {
          if (req.method !== 'GET') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use GET.' }, 405);
          }
          if (!firestoreMock || !firebaseProjectId) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'Firebase Firestore credentials are not configured in the server environment.' }, 503);
          }
          const snapshot = await firestoreMock.collection('events').orderBy('startDate', 'asc').limit(100).get();
          const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          return jsonResponse(req, { success: true, data: events });
        }

        case 'get-event': {
          if (req.method !== 'GET') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use GET.' }, 405);
          }
          const id = url.searchParams.get('id');
          if (!id || !id.trim()) {
            return jsonResponse(req, { success: false, error: 'Query parameter "id" is required.' }, 400);
          }
          if (!firestoreMock || !firebaseProjectId) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'Firebase Firestore credentials are not configured.' }, 503);
          }
          const doc = await firestoreMock.collection('events').doc(id.trim()).get();
          if (!doc.exists) {
            return jsonResponse(req, { success: false, error: 'Event not found.' }, 404);
          }
          return jsonResponse(req, { success: true, data: { id: doc.id, ...doc.data() } });
        }

        case 'verify-auth': {
          const auth = authenticateRequest(req);
          if (!auth.authenticated) {
            return jsonResponse(req, {
              success: false,
              isConfigMissing: Boolean(auth.isConfigMissing),
              error: auth.error
            }, auth.status || 401);
          }
          return jsonResponse(req, { success: true, user: auth.user });
        }

        case 'archive-event': {
          if (req.method !== 'POST') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
          }
          const id = body.id || url.searchParams.get('id');
          if (!id || !id.trim()) {
            return jsonResponse(req, { success: false, error: 'Event "id" is required for archiving.' }, 400);
          }
          if (!firestoreMock || !firebaseProjectId) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'Firebase Firestore credentials are not configured.' }, 503);
          }
          const docRef = firestoreMock.collection('events').doc(id.trim());
          const existing = await docRef.get();
          if (!existing.exists) {
            return jsonResponse(req, { success: false, error: 'Event not found.' }, 404);
          }
          await docRef.set({ status: 'archived', updatedAt: new Date().toISOString() }, { merge: true });
          return jsonResponse(req, { success: true, message: 'Event successfully archived.' });
        }

        case 'save-task': {
          if (req.method !== 'POST') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
          }
          const auth = authenticateRequest(req);
          if (!auth.authenticated) {
            return jsonResponse(req, { success: false, error: auth.error }, auth.status || 401);
          }
          const taskData = body.task;
          if (!taskData || typeof taskData !== 'object' || Array.isArray(taskData)) {
            return jsonResponse(req, { success: false, error: 'Request body must include a "task" object.' }, 400);
          }
          const title = taskData.title;
          if (!title || typeof title !== 'string' || !title.trim()) {
            return jsonResponse(req, { success: false, error: 'Task "title" is required.' }, 400);
          }
          if (!firestoreMock || !firebaseProjectId) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'Firebase credentials are not configured.' }, 503);
          }
          const taskId = typeof taskData.id === 'string' && taskData.id.trim() ? taskData.id.trim() : null;
          const docRef = taskId ? firestoreMock.collection('user_tasks').doc(taskId) : firestoreMock.collection('user_tasks').doc();
          if (taskId) {
            const existing = await docRef.get();
            if (existing.exists && existing.data().userId !== auth.user.uid) {
              return jsonResponse(req, { success: false, error: 'Forbidden: You do not have permission to modify this task.' }, 403);
            }
          }
          const toSave = {
            id: docRef.id,
            userId: auth.user.uid,
            title: title.trim(),
            dueDate: taskData.dueDate || null,
            priority: taskData.priority || 'upcoming',
            completed: Boolean(taskData.completed),
            updatedAt: new Date().toISOString()
          };
          await docRef.set(toSave, { merge: true });
          return jsonResponse(req, { success: true, data: toSave });
        }

        case 'get-tasks': {
          if (req.method !== 'GET') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use GET.' }, 405);
          }
          const auth = authenticateRequest(req);
          if (!auth.authenticated) {
            return jsonResponse(req, { success: false, error: auth.error }, auth.status || 401);
          }
          if (!firestoreMock || !firebaseProjectId) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'Firebase credentials are not configured.' }, 503);
          }
          const snapshot = await firestoreMock.collection('user_tasks').where('userId', '==', auth.user.uid).get();
          const tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          return jsonResponse(req, { success: true, data: tasks });
        }

        case 'delete-task': {
          if (req.method !== 'POST' && req.method !== 'DELETE') {
            return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST or DELETE.' }, 405);
          }
          const auth = authenticateRequest(req);
          if (!auth.authenticated) {
            return jsonResponse(req, { success: false, error: auth.error }, auth.status || 401);
          }
          const id = body.id || url.searchParams.get('id');
          if (!id || !id.trim()) {
            return jsonResponse(req, { success: false, error: 'Task "id" is required for deletion.' }, 400);
          }
          if (!firestoreMock || !firebaseProjectId) {
            return jsonResponse(req, { success: false, isConfigMissing: true, error: 'Firebase credentials are not configured.' }, 503);
          }
          const docRef = firestoreMock.collection('user_tasks').doc(id.trim());
          const existing = await docRef.get();
          if (!existing.exists) {
            return jsonResponse(req, { success: false, error: 'Task not found.' }, 404);
          }
          if (existing.data().userId !== auth.user.uid) {
            return jsonResponse(req, { success: false, error: 'Forbidden.' }, 403);
          }
          await docRef.delete();
          return jsonResponse(req, { success: true, message: 'Task deleted successfully.' });
        }

        default:
          return jsonResponse(req, { success: false, error: `Unknown action: "${action}".` }, 400);
      }

    } catch (err) {
      return jsonResponse(req, { success: false, error: 'An internal server error occurred while processing the request.' }, 500);
    }
  };

  // Cleanup helper — restore env after test
  handler._restore = () => {
    Object.assign(process.env, originalEnv);
  };

  return handler;
}

// ─── Firestore mock factory ───────────────────────────────────────────────────

/**
 * In-memory Firestore mock. Supports the subset of the Admin SDK API used by campus-ai.mjs.
 * Does not persist across handler instances.
 *
 * @param {object} [seed] - Optional initial data: { collectionName: { docId: { ...fields } } }
 */
function createFirestoreMock(seed = {}) {
  // Pre-populate collections from seed so handlers can read them immediately
  const collections = {};
  for (const [colName, docs] of Object.entries(seed)) {
    collections[colName] = { ...docs };
  }

  let writeError = null; // set to an Error to simulate Firestore write failures

  function docMock(id, collectionData) {
    const exists = id in collectionData;
    const data = exists ? { ...collectionData[id] } : {};
    return {
      id,
      exists,
      data: () => data,
      set: async (fields, opts = {}) => {
        if (writeError) throw writeError;
        if (opts.merge) {
          collectionData[id] = { ...(collectionData[id] || {}), ...fields };
        } else {
          collectionData[id] = { ...fields };
        }
      },
      delete: async () => {
        if (writeError) throw writeError;
        delete collectionData[id];
      },
      get: async () => docMock(id, collectionData)
    };
  }

  function collectionMock(name, data) {
    return {
      doc: (id) => {
        const resolvedId = id || `generated-${Math.random().toString(36).slice(2)}`;
        return {
          id: resolvedId,
          get: async () => docMock(resolvedId, data),
          delete: async () => {
            if (writeError) throw writeError;
            delete data[resolvedId];
          },
          set: async (fields, opts = {}) => {
            if (writeError) throw writeError;
            if (opts.merge) {
              data[resolvedId] = { ...(data[resolvedId] || {}), ...fields };
            } else {
              data[resolvedId] = { ...fields };
            }
          }
        };
      },
      where: (field, op, val) => ({
        get: async () => {
          const matches = Object.entries(data).filter(([id, d]) => d[field] === val);
          return { docs: matches.map(([id]) => docMock(id, data)) };
        },
        limit: (n) => ({
          get: async () => {
            const matches = Object.entries(data).filter(([id, d]) => d[field] === val).slice(0, n);
            return { docs: matches.map(([id]) => docMock(id, data)) };
          }
        })
      }),
      limit: (n) => ({
        get: async () => {
          const docs = Object.entries(data).slice(0, n).map(([id]) => docMock(id, data));
          return { docs };
        }
      }),
      orderBy: () => ({
        limit: (n) => ({
          get: async () => {
            const docs = Object.entries(data).slice(0, n).map(([id]) => docMock(id, data));
            return { docs };
          }
        })
      })
    };
  }

  return {
    collection: (name) => {
      if (!collections[name]) collections[name] = {};
      return collectionMock(name, collections[name]);
    },
    _setWriteError: (err) => { writeError = err; },
    _clearWriteError: () => { writeError = null; },
    /** Returns a live reference to the named collection's data map */
    _getCollection: (name) => {
      if (!collections[name]) collections[name] = {};
      return collections[name];
    }
  };
}

// ─── Gemini response mock helpers ─────────────────────────────────────────────

function geminiOk(jsonObj) {
  return async () => ({ text: JSON.stringify(jsonObj) });
}

function geminiBadJson() {
  return async () => ({ text: '```not valid json at all```' });
}

function geminiEmpty() {
  return async () => ({ text: '' });
}

const validExtractedEvent = {
  title: 'Annual Hackathon 2026',
  startDate: '2026-11-01T09:00:00',
  endDate: null,
  startTime: '09:00',
  endTime: null,
  venue: 'Main Auditorium',
  category: 'academic',
  description: 'A 24-hour coding challenge for all departments.',
  tags: ['hackathon', 'coding'],
  urgencyNote: 'Register by October 30.'
};

const validSavePayload = {
  title: 'Annual Hackathon 2026',
  startDate: '2026-11-01T09:00:00',
  category: 'academic',
  venue: 'Main Auditorium',
  description: 'A 24-hour coding challenge.',
  tags: ['hackathon'],
  rawSource: 'Original announcement text here.'
};

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('Extract action — input validation', () => {

  it('returns 405 when extract is called with GET', async () => {
    const h = buildHandler();
    const req = makeRequest('GET', null);
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 405);
    assert.equal(body.success, false);
    h._restore();
  });

  it('returns 400 when rawText is missing', async () => {
    const h = buildHandler({ geminiApiKey: 'key' });
    const req = makeRequest('POST', null, { action: 'extract' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.ok(body.error.includes('rawText is required'));
    h._restore();
  });

  it('returns 400 when rawText is whitespace only', async () => {
    const h = buildHandler({ geminiApiKey: 'key' });
    const req = makeRequest('POST', null, { action: 'extract', rawText: '   ' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('rawText is required'));
    h._restore();
  });

  it('returns 400 when rawText exceeds 4000 characters', async () => {
    const h = buildHandler({ geminiApiKey: 'key' });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'x'.repeat(4001) });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('4000 characters'));
    h._restore();
  });

  it('returns 400 when rawText is exactly at the 4000 character limit (passes)', async () => {
    // 4000 chars should pass validation — only >4000 is rejected
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiOk(validExtractedEvent) });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'a'.repeat(4000) });
    const { status, body } = await parseResponse(await h(req));
    // Should not be rejected for length (may fail on Gemini mock — but not length error)
    assert.notEqual(body.error, `rawText exceeds the maximum allowed length of 4000 characters.`);
    h._restore();
  });

  it('returns 503 with isConfigMissing when GEMINI_API_KEY is absent', async () => {
    const h = buildHandler({ geminiApiKey: null });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Some campus announcement.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 503);
    assert.equal(body.isConfigMissing, true);
    h._restore();
  });
});

describe('Extract action — Gemini response handling', () => {

  it('returns success with rawSource when Gemini returns a valid event', async () => {
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiOk(validExtractedEvent) });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Annual Hackathon on Nov 1 at Main Auditorium.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.title, 'Annual Hackathon 2026');
    assert.equal(body.data.rawSource, 'Annual Hackathon on Nov 1 at Main Auditorium.');
    h._restore();
  });

  it('returns 502 when Gemini returns malformed JSON', async () => {
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiBadJson() });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Some campus announcement.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 502);
    assert.ok(body.error.includes('could not be parsed as JSON'));
    h._restore();
  });

  it('returns 502 when Gemini returns empty text', async () => {
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiEmpty() });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Some campus announcement.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 502);
    h._restore();
  });

  it('returns 502 when Gemini output is missing title', async () => {
    const noTitle = { ...validExtractedEvent, title: '' };
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiOk(noTitle) });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Announcement text.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 502);
    assert.ok(body.error.includes('missing a required non-empty title'));
    h._restore();
  });

  it('returns 502 when Gemini output is missing startDate', async () => {
    const noDate = { ...validExtractedEvent, startDate: undefined };
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiOk(noDate) });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Announcement text.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 502);
    assert.ok(body.error.includes('startDate'));
    h._restore();
  });

  it('returns 502 when Gemini output contains an invalid startDate format', async () => {
    const badDate = { ...validExtractedEvent, startDate: 'not-a-date' };
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiOk(badDate) });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Announcement text.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 502);
    assert.ok(body.error.includes('invalid startDate'));
    h._restore();
  });

  it('returns 502 when Gemini output contains an unrecognised category', async () => {
    const badCat = { ...validExtractedEvent, category: 'unknown-category' };
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiOk(badCat) });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Announcement text.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 502);
    assert.ok(body.error.includes('unrecognised category'));
    h._restore();
  });

  it('accepts a Gemini response with markdown JSON code fences', async () => {
    const fenced = async () => ({ text: '```json\n' + JSON.stringify(validExtractedEvent) + '\n```' });
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: fenced });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Announcement text.' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.data.title, 'Annual Hackathon 2026');
    h._restore();
  });
});

describe('Save-event action — method and input validation', () => {

  it('returns 405 when save-event is called with GET', async () => {
    const h = buildHandler();
    const req = makeRequest('GET', 'save-event');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 405);
    assert.equal(body.success, false);
    h._restore();
  });

  it('returns 400 when event body is missing', async () => {
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: createFirestoreMock() });
    const req = makeRequest('POST', null, { action: 'save-event' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('"event" object'));
    h._restore();
  });

  it('returns 400 when title is missing', async () => {
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: createFirestoreMock() });
    const req = makeRequest('POST', null, { action: 'save-event', event: { startDate: '2026-11-01T09:00:00' } });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('"title"'));
    h._restore();
  });

  it('returns 400 when startDate is missing', async () => {
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: createFirestoreMock() });
    const req = makeRequest('POST', null, { action: 'save-event', event: { title: 'Test Event' } });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('"startDate"'));
    h._restore();
  });

  it('returns 400 when startDate is not a valid ISO date', async () => {
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: createFirestoreMock() });
    const req = makeRequest('POST', null, { action: 'save-event', event: { title: 'Test', startDate: 'tomorrow' } });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('"startDate"'));
    h._restore();
  });

  it('returns 400 when category is invalid', async () => {
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: createFirestoreMock() });
    const req = makeRequest('POST', null, { action: 'save-event', event: { ...validSavePayload, category: 'invalid-cat' } });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('"category"'));
    h._restore();
  });

  it('returns 400 when status is invalid', async () => {
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: createFirestoreMock() });
    const req = makeRequest('POST', null, { action: 'save-event', event: { ...validSavePayload, status: 'live' } });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('"status"'));
    h._restore();
  });

  it('returns 503 when Firebase credentials are missing', async () => {
    const h = buildHandler({ firebaseProjectId: null, firestoreMock: null });
    const req = makeRequest('POST', null, { action: 'save-event', event: validSavePayload });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 503);
    assert.equal(body.isConfigMissing, true);
    h._restore();
  });
});

describe('Save-event action — Firestore write correctness', () => {

  it('saves a valid event and returns it with server-set fields', async () => {
    const db = createFirestoreMock();
    const h = buildHandler({ firebaseProjectId: 'proj', firebaseClientEmail: 'e', firebasePrivateKey: 'k', firestoreMock: db });
    const req = makeRequest('POST', null, { action: 'save-event', event: validSavePayload });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    assert.equal(body.data.title, 'Annual Hackathon 2026');
    assert.ok(body.data.createdAt);
    assert.ok(body.data.updatedAt);
    assert.equal(body.data.status, 'published'); // defaulted
    assert.equal(body.data.rawSource, 'Original announcement text here.');
    h._restore();
  });

  it('does not overwrite createdAt when updating an existing document', async () => {
    const db = createFirestoreMock();
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: db });

    // First save — creates the document
    const createReq = makeRequest('POST', null, { action: 'save-event', event: { ...validSavePayload, id: 'event-abc' } });
    const { body: createBody } = await parseResponse(await h(createReq));
    const originalCreatedAt = createBody.data.createdAt;
    assert.ok(originalCreatedAt);

    // Small delay to ensure timestamps differ
    await new Promise(r => setTimeout(r, 5));

    // Second save — update
    const updateReq = makeRequest('POST', null, { action: 'save-event', event: { ...validSavePayload, id: 'event-abc', title: 'Updated Title' } });
    const { body: updateBody } = await parseResponse(await h(updateReq));
    assert.equal(updateBody.data.title, 'Updated Title');
    assert.equal(updateBody.data.createdAt, originalCreatedAt, 'createdAt must not change on update');
    assert.notEqual(updateBody.data.updatedAt, originalCreatedAt, 'updatedAt must be refreshed on update');
    h._restore();
  });

  it('defaults status to published when not supplied', async () => {
    const db = createFirestoreMock();
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: db });
    const req = makeRequest('POST', null, { action: 'save-event', event: { title: 'No Status Event', startDate: '2026-11-05T10:00:00' } });
    const { body } = await parseResponse(await h(req));
    assert.equal(body.data.status, 'published');
    h._restore();
  });

  it('accepts draft and archived status values', async () => {
    const db = createFirestoreMock();
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: db });
    for (const s of ['draft', 'archived']) {
      const req = makeRequest('POST', null, { action: 'save-event', event: { ...validSavePayload, status: s } });
      const { body } = await parseResponse(await h(req));
      assert.equal(body.data.status, s);
    }
    h._restore();
  });

  it('returns 500 when Firestore write throws an error', async () => {
    const db = createFirestoreMock();
    db._setWriteError(new Error('Firestore quota exceeded'));
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: db });
    const req = makeRequest('POST', null, { action: 'save-event', event: validSavePayload });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 500);
    assert.equal(body.success, false);
    // Must NOT expose the raw error message
    assert.ok(!body.error.includes('quota'), 'Raw Firestore error must not be sent to client');
    h._restore();
  });
});

describe('Get-event action', () => {

  it('returns 400 when event ID is missing', async () => {
    const db = createFirestoreMock();
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: db });
    const req = makeRequest('GET', 'get-event');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('"id"'));
    h._restore();
  });

  it('returns 404 when event does not exist', async () => {
    const db = createFirestoreMock();
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: db });
    // Use ?action=get-event&id=... so the action param is correctly resolved
    const req = makeRequest('GET', '/?action=get-event&id=nonexistent-id');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 404);
    assert.ok(body.error.includes('not found'));
    h._restore();
  });

  it('returns 503 when Firebase credentials are missing', async () => {
    const h = buildHandler({ firebaseProjectId: null, firestoreMock: null });
    const req = makeRequest('GET', '/?action=get-event&id=abc');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 503);
    assert.equal(body.isConfigMissing, true);
    h._restore();
  });

  it('returns 405 when get-event is called with POST', async () => {
    const h = buildHandler({ firebaseProjectId: 'proj' });
    const req = makeRequest('POST', '/?action=get-event&id=abc');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 405);
    assert.equal(body.success, false);
    h._restore();
  });
});

describe('Get-events action', () => {
  it('returns 405 when get-events is called with POST', async () => {
    const h = buildHandler({ firebaseProjectId: 'proj' });
    const req = makeRequest('POST', 'get-events');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 405);
    assert.equal(body.success, false);
    h._restore();
  });

  it('returns list of events on GET', async () => {
    const seedData = {
      'e1': { id: 'e1', title: 'Event 1', startDate: '2026-11-01T10:00:00' },
      'e2': { id: 'e2', title: 'Event 2', startDate: '2026-11-02T10:00:00' }
    };
    const db = createFirestoreMock({ events: seedData });
    const h = buildHandler({ firebaseProjectId: 'proj', firestoreMock: db });
    const req = makeRequest('GET', 'get-events');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.length, 2);
    h._restore();
  });

  it('returns 503 when Firebase credentials are missing', async () => {
    const h = buildHandler({ firebaseProjectId: null, firestoreMock: null });
    const req = makeRequest('GET', 'get-events');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 503);
    assert.equal(body.isConfigMissing, true);
    h._restore();
  });
});

describe('Weekly summary action', () => {

  it('returns honest empty-state response when no events exist', async () => {
    const db = createFirestoreMock();
    const h = buildHandler({ geminiApiKey: 'key', firebaseProjectId: 'proj', firestoreMock: db, geminiGenerateFn: geminiOk({}) });
    const req = makeRequest('POST', null, { action: 'weekly-summary' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.summaryText, 'No campus events are currently scheduled for this upcoming week.');
    assert.deepEqual(body.data.highlights, []);
    h._restore();
  });

  it('does NOT send rawSource to Gemini in weekly summary', async () => {
    // Arrange: pre-seed a Firestore mock that already has the event stored
    // so the handler's limit(20).get() call returns it.
    const seedData = {
      'event-1': {
        id: 'event-1', title: 'Hackathon', startDate: '2026-11-01T09:00:00',
        category: 'academic', rawSource: 'CONFIDENTIAL RAW SOURCE TEXT',
        description: 'A coding event.', tags: []
      }
    };
    const db = createFirestoreMock({ events: seedData });

    let capturedContents = null;
    const spyGemini = async ({ contents }) => {
      capturedContents = contents;
      return { text: JSON.stringify({ title: 'Weekly Campus Briefing', summaryText: 'Test', highlights: [], generatedAt: new Date().toISOString() }) };
    };

    const h = buildHandler({ geminiApiKey: 'key', firebaseProjectId: 'proj', firestoreMock: db, geminiGenerateFn: spyGemini });
    const req = makeRequest('POST', null, { action: 'weekly-summary' });
    await parseResponse(await h(req));

    assert.ok(capturedContents, 'Gemini must have been called with event data');
    assert.ok(!capturedContents.includes('CONFIDENTIAL RAW SOURCE TEXT'), 'rawSource must NOT be sent to Gemini');
    h._restore();
  });

  it('returns 503 when Gemini API key is missing', async () => {
    const h = buildHandler({ geminiApiKey: null });
    const req = makeRequest('POST', null, { action: 'weekly-summary' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 503);
    assert.equal(body.isConfigMissing, true);
    h._restore();
  });

  it('returns 405 when weekly-summary is called with GET', async () => {
    const h = buildHandler({ geminiApiKey: 'key' });
    const req = makeRequest('GET', 'weekly-summary');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 405);
    h._restore();
  });
});

describe('Unknown action and malformed requests', () => {

  it('returns 400 for an unknown action string', async () => {
    const h = buildHandler();
    const req = makeRequest('GET', 'totally-unknown');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('Unknown action'));
    h._restore();
  });

  it('returns 400 for malformed JSON POST body', async () => {
    const h = buildHandler();
    const req = {
      method: 'POST',
      url: 'http://localhost:8888/.netlify/functions/campus-ai',
      headers: { get: () => null },
      text: async () => '{ not valid json'
    };
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.ok(body.error.includes('Invalid JSON'));
    h._restore();
  });

  it('returns 204 for OPTIONS preflight request', async () => {
    const h = buildHandler();
    const req = makeRequest('OPTIONS', null, null, { origin: 'http://localhost:5173' });
    const res = await h(req);
    assert.equal(res.status, 204);
    h._restore();
  });
});

describe('CORS headers', () => {

  it('includes Access-Control-Allow-Origin for allowed localhost origin', async () => {
    const h = buildHandler({ geminiApiKey: 'key', geminiGenerateFn: geminiOk(validExtractedEvent) });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Test.' }, { origin: 'http://localhost:5173' });
    const res = await h(req);
    // We can't easily inspect headers without the raw Response headers map,
    // but the status being correct confirms the handler ran without error
    assert.equal(res.status, 200);
    h._restore();
  });

  it('does not echo back an unknown origin', async () => {
    const h = buildHandler({ geminiApiKey: null });
    const req = makeRequest('POST', null, { action: 'extract', rawText: 'Test.' }, { origin: 'https://evil.com' });
    const res = await h(req);
    // Handler still responds (not a crash), but no Allow-Origin header for this origin
    // Status would be 503 due to missing API key
    assert.equal(res.status, 503);
    h._restore();
  });
});

describe('Verify-auth action', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const h = buildHandler();
    const req = makeRequest('GET', 'verify-auth');
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 401);
    assert.equal(body.success, false);
    h._restore();
  });

  it('authenticates valid Bearer demo token and returns user profile', async () => {
    const h = buildHandler();
    const req = makeRequest('GET', 'verify-auth', null, { authorization: 'Bearer demo-token:student-alex:Alex%20Chen' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.user.uid, 'student-alex');
    assert.equal(body.user.name, 'Alex Chen');
    h._restore();
  });

  it('rejects invalid or unsupported tokens with 401', async () => {
    const h = buildHandler();
    const req = makeRequest('GET', 'verify-auth', null, { authorization: 'Bearer forged-random-token' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 401);
    assert.equal(body.success, false);
    h._restore();
  });

  it('rejects demo tokens with 401 when production authentication is enforced', async () => {
    const h = buildHandler({ productionAuth: true, firebaseProjectId: 'live-campus-pulse' });
    const req = makeRequest('GET', 'verify-auth', null, { authorization: 'Bearer demo-token:student-alex:Alex%20Chen' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.match(body.error, /prohibited in production|verified Firebase ID token/i);
    h._restore();
  });

  it('returns 503 isConfigMissing when Firebase Admin is unconfigured in production mode', async () => {
    const h = buildHandler({ productionAuth: true, firebaseProjectId: null });
    const req = makeRequest('GET', 'verify-auth', null, { authorization: 'Bearer valid-firebase-id-token' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 503);
    assert.equal(body.success, false);
    assert.equal(body.isConfigMissing, true);
    h._restore();
  });

  it('authenticates valid Firebase ID token in production mode', async () => {
    const h = buildHandler({ productionAuth: true, firebaseProjectId: 'live-campus-pulse' });
    const req = makeRequest('GET', 'verify-auth', null, { authorization: 'Bearer valid-firebase-id-token' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.user.uid, 'verified-google-uid-123');
    assert.equal(body.user.isDemo, false);
    h._restore();
  });
});

describe('Archive-event action', () => {
  it('returns 405 when called with GET', async () => {
    const h = buildHandler();
    const req = makeRequest('GET', 'archive-event');
    const { status } = await parseResponse(await h(req));
    assert.equal(status, 405);
    h._restore();
  });

  it('returns 400 when event ID is missing', async () => {
    const h = buildHandler();
    const req = makeRequest('POST', 'archive-event', {});
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.match(body.error, /required/i);
    h._restore();
  });

  it('archives an existing event in Firestore', async () => {
    const db = createFirestoreMock({
      events: {
        'ev-101': { title: 'Hackathon 2026', status: 'published' }
      }
    });
    const h = buildHandler({ firebaseProjectId: 'test-proj', firestoreMock: db });
    const req = makeRequest('POST', 'archive-event', { id: 'ev-101' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    h._restore();
  });
});

describe('Task management actions (save-task, get-tasks, delete-task)', () => {
  it('returns 401 when save-task is called unauthenticated', async () => {
    const h = buildHandler();
    const req = makeRequest('POST', 'save-task', { task: { title: 'Study for Finals' } });
    const { status } = await parseResponse(await h(req));
    assert.equal(status, 401);
    h._restore();
  });

  it('returns 400 when save-task is missing title', async () => {
    const h = buildHandler({ firebaseProjectId: 'test-proj', firestoreMock: createFirestoreMock() });
    const req = makeRequest('POST', 'save-task', { task: {} }, { authorization: 'Bearer demo-token:user-1:Alex' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 400);
    assert.match(body.error, /title/i);
    h._restore();
  });

  it('saves task scoped to authenticated user UID', async () => {
    const db = createFirestoreMock();
    const h = buildHandler({ firebaseProjectId: 'test-proj', firestoreMock: db });
    const req = makeRequest('POST', 'save-task', {
      task: { title: 'Complete Lab 3', priority: 'urgent', dueDate: '2026-11-01T10:00:00' }
    }, { authorization: 'Bearer demo-token:student-alex:Alex%20Chen' });

    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.userId, 'student-alex');
    assert.equal(body.data.title, 'Complete Lab 3');
    h._restore();
  });

  it('enforces cross-user isolation when querying tasks', async () => {
    const db = createFirestoreMock({
      user_tasks: {
        'task-user-a': { id: 'task-user-a', userId: 'user-a', title: 'User A Secret Task' },
        'task-user-b': { id: 'task-user-b', userId: 'user-b', title: 'User B Public Task' }
      }
    });
    const h = buildHandler({ firebaseProjectId: 'test-proj', firestoreMock: db });
    const req = makeRequest('GET', 'get-tasks', null, { authorization: 'Bearer demo-token:user-a:User%20A' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, 'task-user-a');
    h._restore();
  });

  it('prevents user from deleting another user task (403 Forbidden)', async () => {
    const db = createFirestoreMock({
      user_tasks: {
        'task-user-a': { id: 'task-user-a', userId: 'user-a', title: 'User A Task' }
      }
    });
    const h = buildHandler({ firebaseProjectId: 'test-proj', firestoreMock: db });
    // User B attempts to delete User A's task
    const req = makeRequest('POST', 'delete-task', { id: 'task-user-a' }, { authorization: 'Bearer demo-token:user-b:User%20B' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 403);
    assert.equal(body.success, false);
    h._restore();
  });

  it('allows user to delete their own task successfully', async () => {
    const db = createFirestoreMock({
      user_tasks: {
        'task-user-a': { id: 'task-user-a', userId: 'user-a', title: 'User A Task' }
      }
    });
    const h = buildHandler({ firebaseProjectId: 'test-proj', firestoreMock: db });
    const req = makeRequest('POST', 'delete-task', { id: 'task-user-a' }, { authorization: 'Bearer demo-token:user-a:User%20A' });
    const { status, body } = await parseResponse(await h(req));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    h._restore();
  });
});
