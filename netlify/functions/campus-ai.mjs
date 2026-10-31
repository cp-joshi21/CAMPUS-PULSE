/**
 * CampusPulse Serverless Backend — Netlify Function
 * Secure server-side orchestration for Google Gemini AI and Firebase Firestore.
 * Zero secrets exposed to client. Handles missing credentials gracefully without crashing.
 *
 * Firestore collection: "events"
 * Date storage format: ISO 8601 strings (YYYY-MM-DDTHH:MM:SS), not Firestore Timestamps.
 *   Lexicographic ordering of consistently-formatted ISO strings is valid for orderBy queries.
 *   Native Timestamp conversion is NOT used to keep client/server date handling uniform.
 *
 * Priority field: computed client-side only (not persisted). This matches the frontend
 *   contract in src/js/utils.js (classifyEventPriority). The server never stores "priority".
 *
 * Rate limiting: NOT implemented server-side. Netlify serverless instances are ephemeral;
 *   in-memory counters would not be shared across concurrent instances. Throttling must be
 *   handled at the Netlify Edge or an external service (remaining deployment risk).
 *
 * Summary persistence: NOT implemented in this phase. Weekly summaries are generated
 *   on demand and returned to the client only; the "summaries" collection is reserved
 *   for a future phase.
 */

// ─── SDK imports (silent fail when unavailable in test/build environments) ───

let GoogleGenAI;
try {
  const genaiModule = await import('@google/genai');
  GoogleGenAI = genaiModule.GoogleGenAI;
} catch {
  GoogleGenAI = null;
}

let admin;
try {
  const firebaseAdminModule = await import('firebase-admin');
  admin = firebaseAdminModule.default || firebaseAdminModule;
} catch {
  admin = null;
}

// ─── Global cached instances across warm serverless invocations ───────────────

let geminiClient = null;
let firestoreDb = null;

// ─── Constants ────────────────────────────────────────────────────────────────

const RAW_TEXT_MAX_CHARS = 4000;

const VALID_CATEGORIES = new Set([
  'academic', 'cultural', 'sports', 'career', 'workshop', 'club', 'general'
]);

const VALID_STATUSES = new Set(['published', 'archived', 'draft']);

const VALID_TASK_PRIORITIES = new Set(['urgent', 'upcoming', 'this-week', 'scheduled', 'expired']);

/** ISO 8601 date-only or datetime string: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

/** HH:MM 24-hour time */
const TIME_HH_MM_RE = /^\d{2}:\d{2}$/;

/**
 * Allowed origins for CORS.
 * Extend with your production Netlify subdomain once deployed, e.g.:
 *   'https://campus-pulse.netlify.app'
 * Do NOT use '*' in production — credentials are server-side but CORS
 * headers protect the browser's same-origin policy for authenticated sessions.
 */
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:8888',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  if (!geminiClient && GoogleGenAI) {
    try {
      geminiClient = new GoogleGenAI({ apiKey });
    } catch (e) {
      console.error('Failed to initialize Gemini Client:', e.message);
      return null;
    }
  }
  return geminiClient;
}

function getFirestoreDb() {
  if (firestoreDb) return firestoreDb;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey || !admin) {
    return null;
  }

  try {
    if (admin.apps.length === 0) {
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey })
      });
    }

    firestoreDb = admin.firestore();
    return firestoreDb;
  } catch (err) {
    console.error('Failed to initialize Firebase Admin:', err.message);
    return null;
  }
}

/**
 * Build CORS headers appropriate for the request Origin.
 * Returns a specific origin when it matches the allowlist; never returns '*'.
 * Unknown origins receive no Allow-Origin header (browser blocks the response).
 */
function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const base = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Vary': 'Origin'
  };

  if (ALLOWED_ORIGINS.has(origin)) {
    base['Access-Control-Allow-Origin'] = origin;
    base['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, DELETE';
    base['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  }

  return base;
}

/**
 * Extracts and verifies the Bearer authentication token from the request.
 * Resolves user identity from verified Firebase ID tokens, or structured demo/test tokens.
 *
 * @param {Request} req
 * @returns {Promise<{ authenticated: boolean, user?: object, status?: number, error?: string }>}
 */
async function authenticateRequest(req) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      status: 401,
      error: 'Missing or malformed Authorization header. Expected Bearer token.'
    };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return {
      authenticated: false,
      status: 401,
      error: 'Empty Bearer token provided.'
    };
  }

  // Explicit test-runner isolation:
  // ONLY active when NODE_ENV === 'test' AND CAMPUSPULSE_ALLOW_TEST_AUTH === 'true'.
  // Under NO circumstances is this active in production, staging, development, or Netlify deployments.
  const isIsolatedTestEnvironment = process.env.NODE_ENV === 'test' && process.env.CAMPUSPULSE_ALLOW_TEST_AUTH === 'true';

  if (!isIsolatedTestEnvironment) {
    // In production and all live execution paths:
    // Any demo-token, test-token, or client-supplied mock token is strictly rejected.
    if (token.startsWith('demo-token:') || token.startsWith('test-token:')) {
      return {
        authenticated: false,
        status: 401,
        error: 'Invalid authentication token. Demo tokens and client-supplied identities are strictly prohibited in production. A verified Firebase ID token signed by Google is required.'
      };
    }
  }

  // Ensure Firebase Admin SDK is initialized
  const db = getFirestoreDb();
  const hasServerCredentials = Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    (process.env.FIREBASE_CLIENT_EMAIL || process.env.GOOGLE_APPLICATION_CREDENTIALS)
  );

  if (!hasServerCredentials || !admin || admin.apps.length === 0) {
    // If running in isolated test runner with test auth explicitly enabled:
    if (isIsolatedTestEnvironment && (token.startsWith('demo-token:') || token.startsWith('test-token:'))) {
      const parts = token.split(':');
      const uid = parts[1] || 'test-user-1';
      let name = 'Test User';
      if (parts[2]) {
        try {
          name = decodeURIComponent(parts[2]);
        } catch {
          name = parts[2];
        }
      }
      return {
        authenticated: true,
        user: {
          uid,
          email: `${uid}@campus.test`,
          name,
          isDemo: true
        }
      };
    }

    // Honest configuration error — NEVER bypass authentication when credentials are missing!
    return {
      authenticated: false,
      status: 503,
      isConfigMissing: true,
      error: 'Firebase Authentication is not configured on this server. Live Firebase service account credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are required to verify authentication tokens.'
    };
  }

  // Live Firebase Admin ID Token verification
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return {
      authenticated: true,
      user: {
        uid: decoded.uid,
        email: decoded.email || null,
        name: decoded.name || decoded.displayName || 'Campus User',
        picture: decoded.picture || null,
        isDemo: false
      }
    };
  } catch (err) {
    return {
      authenticated: false,
      status: 401,
      error: `Invalid or expired authentication token. Verified Firebase ID token required: ${err.message}`
    };
  }
}

function jsonResponse(req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(req)
  });
}

/**
 * Validate that a value is a well-formed ISO date string or null.
 * Returns true for null/undefined (optional fields), false for non-null bad values.
 */
function isValidISODateOrNull(value) {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

/**
 * Validate that a value is a HH:MM time string or null.
 */
function isValidTimeOrNull(value) {
  if (value == null) return true;
  return typeof value === 'string' && TIME_HH_MM_RE.test(value);
}

/**
 * Strip Gemini markdown code-fences if present and parse JSON.
 * Throws on malformed JSON.
 */
function parseGeminiJson(text) {
  if (!text) throw new Error('Gemini returned an empty response.');
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

/**
 * Validate Gemini extraction output against the required event schema.
 * Returns { valid: true, data } or { valid: false, error }.
 */
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

// ─── Netlify Function handler (Dual Export: v2 default + v1 AWS Lambda) ────────

async function defaultHandler(req, context = {}) {
  const url = new URL(req.url);

  // Handle CORS preflight
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

      // ── extract ────────────────────────────────────────────────────────────
      case 'extract': {
        if (req.method !== 'POST') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
        }

        const rawText = body.rawText;
        if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
          return jsonResponse(req, { success: false, error: 'rawText is required for AI extraction.' }, 400);
        }
        if (rawText.length > RAW_TEXT_MAX_CHARS) {
          return jsonResponse(req, {
            success: false,
            error: `rawText exceeds the maximum allowed length of ${RAW_TEXT_MAX_CHARS} characters.`
          }, 400);
        }

        const ai = getGeminiClient();
        if (!ai) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'GEMINI_API_KEY is not configured in the server environment.'
          }, 503);
        }

        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

        const prompt = `You are CampusPulse AI, an intelligent college announcement parser.
Extract structured event information from the following unstructured campus text.
Return ONLY valid JSON matching this exact schema. Do not invent details that are not present in the text.
{
  "title": "Clear concise event title",
  "startDate": "YYYY-MM-DDTHH:MM:SS (ISO 8601, required)",
  "endDate": "YYYY-MM-DDTHH:MM:SS or null",
  "startTime": "HH:MM (24-hour format) or null",
  "endTime": "HH:MM or null",
  "venue": "Specific room, hall or building, or null if unknown",
  "category": "One of: academic | cultural | sports | career | workshop | club | general",
  "description": "2-3 sentence clear summary of the announcement",
  "tags": ["tag1", "tag2"],
  "urgencyNote": "Brief note on deadlines or attendance requirements if present, or null"
}

Announcement text:
${rawText}`;

        const geminiResponse = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: { responseMimeType: 'application/json' }
        });

        const outputText = geminiResponse.text || '';
        let parsedData;
        try {
          parsedData = parseGeminiJson(outputText);
        } catch {
          return jsonResponse(req, {
            success: false,
            error: 'Gemini returned a response that could not be parsed as JSON.'
          }, 502);
        }

        const validation = validateExtractedEvent(parsedData);
        if (!validation.valid) {
          return jsonResponse(req, {
            success: false,
            error: `Gemini extraction validation failed: ${validation.error}`
          }, 502);
        }

        // Return rawSource so the frontend can forward it when saving
        return jsonResponse(req, {
          success: true,
          data: { ...validation.data, rawSource: rawText.trim() }
        });
      }

      // ── weekly-summary ─────────────────────────────────────────────────────
      case 'weekly-summary': {
        if (req.method !== 'POST') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
        }

        const ai = getGeminiClient();
        if (!ai) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'GEMINI_API_KEY is not configured in the server environment.'
          }, 503);
        }

        const db = getFirestoreDb();
        let events = [];
        if (db) {
          const snapshot = await db.collection('events').limit(20).get();
          events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        if (events.length === 0) {
          return jsonResponse(req, {
            success: true,
            data: {
              title: 'Weekly Campus Briefing',
              summaryText: 'No campus events are currently scheduled for this upcoming week.',
              highlights: [],
              generatedAt: new Date().toISOString()
            }
          });
        }

        // Project only the public, summary-relevant fields — never send rawSource to Gemini
        const summaryPayload = events.map(e => ({
          id: e.id,
          title: e.title,
          startDate: e.startDate,
          endDate: e.endDate || null,
          venue: e.venue || null,
          category: e.category || null,
          description: e.description || null,
          tags: e.tags || [],
          urgencyNote: e.urgencyNote || null
        }));

        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const summaryPrompt = `Generate a concise, professional executive weekly summary for a college campus dashboard.
Only summarise the events provided. Do not invent events or highlights not present in the data.
Events: ${JSON.stringify(summaryPayload)}
Return JSON:
{
  "title": "Weekly Campus Briefing",
  "summaryText": "Concise paragraph overview based only on the provided events",
  "highlights": ["Highlight 1", "Highlight 2", "Highlight 3"],
  "generatedAt": "${new Date().toISOString()}"
}`;

        const summaryResponse = await ai.models.generateContent({
          model: modelName,
          contents: summaryPrompt,
          config: { responseMimeType: 'application/json' }
        });

        let summaryData;
        try {
          summaryData = parseGeminiJson(summaryResponse.text || '');
        } catch {
          return jsonResponse(req, {
            success: false,
            error: 'Gemini returned a weekly summary that could not be parsed as JSON.'
          }, 502);
        }

        return jsonResponse(req, { success: true, data: summaryData });
      }

      // ── save-event ─────────────────────────────────────────────────────────
      case 'save-event': {
        if (req.method !== 'POST') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
        }

        const eventData = body.event;
        if (!eventData || typeof eventData !== 'object' || Array.isArray(eventData)) {
          return jsonResponse(req, { success: false, error: 'Request body must include an "event" object.' }, 400);
        }

        // Required fields
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

        // Optional date/time field validation
        if (!isValidISODateOrNull(eventData.endDate)) {
          return jsonResponse(req, { success: false, error: `Event "endDate" is not a valid ISO 8601 date or null: "${eventData.endDate}".` }, 400);
        }
        if (!isValidTimeOrNull(eventData.startTime)) {
          return jsonResponse(req, { success: false, error: `Event "startTime" must be HH:MM or null: "${eventData.startTime}".` }, 400);
        }
        if (!isValidTimeOrNull(eventData.endTime)) {
          return jsonResponse(req, { success: false, error: `Event "endTime" must be HH:MM or null: "${eventData.endTime}".` }, 400);
        }

        // Category validation
        const category = eventData.category;
        if (category != null && !VALID_CATEGORIES.has(category)) {
          return jsonResponse(req, {
            success: false,
            error: `Event "category" must be one of: ${[...VALID_CATEGORIES].join(', ')}. Received: "${category}".`
          }, 400);
        }

        // Status validation (default to 'published')
        const rawStatus = eventData.status;
        const status = rawStatus != null ? rawStatus : 'published';
        if (!VALID_STATUSES.has(status)) {
          return jsonResponse(req, {
            success: false,
            error: `Event "status" must be one of: ${[...VALID_STATUSES].join(', ')}. Received: "${rawStatus}".`
          }, 400);
        }

        // Tags validation
        if (eventData.tags != null && !Array.isArray(eventData.tags)) {
          return jsonResponse(req, { success: false, error: 'Event "tags" must be an array of strings or null.' }, 400);
        }
        if (Array.isArray(eventData.tags) && !eventData.tags.every(t => typeof t === 'string')) {
          return jsonResponse(req, { success: false, error: 'Every element in "tags" must be a string.' }, 400);
        }

        // Description length
        if (eventData.description != null && typeof eventData.description === 'string' && eventData.description.length > 2000) {
          return jsonResponse(req, { success: false, error: 'Event "description" must not exceed 2,000 characters.' }, 400);
        }

        const db = getFirestoreDb();
        if (!db) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'Firebase Firestore credentials are not configured in the server environment.'
          }, 503);
        }

        // Determine if this is a create or update by checking Firestore
        const now = new Date().toISOString();
        const clientId = typeof eventData.id === 'string' && eventData.id.trim() ? eventData.id.trim() : null;
        const docRef = clientId
          ? db.collection('events').doc(clientId)
          : db.collection('events').doc();

        // Only set createdAt for genuinely new documents
        let createdAt = now;
        if (clientId) {
          const existing = await docRef.get();
          if (existing.exists && existing.data().createdAt) {
            createdAt = existing.data().createdAt; // preserve original
          }
        }

        const toSave = {
          title: title.trim(),
          startDate,
          endDate: eventData.endDate != null ? eventData.endDate : null,
          startTime: eventData.startTime != null ? eventData.startTime : null,
          endTime: eventData.endTime != null ? eventData.endTime : null,
          venue: typeof eventData.venue === 'string' ? eventData.venue.trim() : (eventData.venue || null),
          category: category || 'general',
          description: typeof eventData.description === 'string' ? eventData.description.trim() : (eventData.description || null),
          tags: Array.isArray(eventData.tags) ? eventData.tags.map(t => String(t)) : [],
          urgencyNote: typeof eventData.urgencyNote === 'string' ? eventData.urgencyNote.trim() : (eventData.urgencyNote || null),
          rawSource: typeof eventData.rawSource === 'string' ? eventData.rawSource : null,
          status,
          id: docRef.id,
          createdAt,
          updatedAt: now
        };

        await docRef.set(toSave, { merge: true });

        // Read back from Firestore to return the authoritative saved document
        const saved = await docRef.get();
        if (!saved.exists) {
          return jsonResponse(req, { success: false, error: 'Firestore write succeeded but document could not be retrieved.' }, 500);
        }

        return jsonResponse(req, { success: true, data: { id: saved.id, ...saved.data() } });
      }

      // ── get-events ─────────────────────────────────────────────────────────
      case 'get-events': {
        if (req.method !== 'GET') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use GET.' }, 405);
        }

        const db = getFirestoreDb();
        if (!db) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'Firebase Firestore credentials are not configured in the server environment.'
          }, 503);
        }

        const snapshot = await db.collection('events').orderBy('startDate', 'asc').limit(100).get();
        const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return jsonResponse(req, { success: true, data: events });
      }

      // ── get-event ──────────────────────────────────────────────────────────
      case 'get-event': {
        if (req.method !== 'GET') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use GET.' }, 405);
        }

        const id = url.searchParams.get('id');
        if (!id || !id.trim()) {
          return jsonResponse(req, { success: false, error: 'Query parameter "id" is required.' }, 400);
        }

        const db = getFirestoreDb();
        if (!db) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'Firebase Firestore credentials are not configured.'
          }, 503);
        }

        const doc = await db.collection('events').doc(id.trim()).get();
        if (!doc.exists) {
          return jsonResponse(req, { success: false, error: 'Event not found.' }, 404);
        }

        return jsonResponse(req, { success: true, data: { id: doc.id, ...doc.data() } });
      }

      // ── verify-auth ────────────────────────────────────────────────────────
      case 'verify-auth': {
        const auth = await authenticateRequest(req);
        if (!auth.authenticated) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: Boolean(auth.isConfigMissing),
            error: auth.error
          }, auth.status || 401);
        }
        return jsonResponse(req, { success: true, user: auth.user });
      }

      // ── archive-event ──────────────────────────────────────────────────────
      case 'archive-event': {
        if (req.method !== 'POST') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
        }

        const auth = await authenticateRequest(req);
        if (!auth.authenticated) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: Boolean(auth.isConfigMissing),
            error: auth.error
          }, auth.status || 401);
        }

        const id = body.id || url.searchParams.get('id');
        if (!id || !id.trim()) {
          return jsonResponse(req, { success: false, error: 'Query parameter or body "id" is required to archive an event.' }, 400);
        }

        const db = getFirestoreDb();
        if (!db) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'Firebase Firestore credentials are not configured.'
          }, 503);
        }

        const docRef = db.collection('events').doc(id.trim());
        const existing = await docRef.get();
        if (!existing.exists) {
          return jsonResponse(req, { success: false, error: 'Event not found.' }, 404);
        }

        await docRef.update({
          status: 'archived',
          updatedAt: new Date().toISOString()
        });

        return jsonResponse(req, { success: true, message: 'Event successfully archived.' });
      }

      // ── save-task ──────────────────────────────────────────────────────────
      case 'save-task': {
        if (req.method !== 'POST') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST.' }, 405);
        }

        const auth = await authenticateRequest(req);
        if (!auth.authenticated) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: Boolean(auth.isConfigMissing),
            error: auth.error
          }, auth.status || 401);
        }

        const taskData = body.task;
        if (!taskData || typeof taskData !== 'object' || Array.isArray(taskData)) {
          return jsonResponse(req, { success: false, error: 'Request body must include a "task" object.' }, 400);
        }

        const title = taskData.title;
        if (!title || typeof title !== 'string' || !title.trim()) {
          return jsonResponse(req, { success: false, error: 'Task "title" is required.' }, 400);
        }
        if (title.length > 200) {
          return jsonResponse(req, { success: false, error: 'Task "title" must not exceed 200 characters.' }, 400);
        }

        const dueDate = taskData.dueDate;
        if (dueDate != null && !isValidISODateOrNull(dueDate)) {
          return jsonResponse(req, { success: false, error: `Task "dueDate" must be a valid ISO 8601 date: "${dueDate}".` }, 400);
        }

        const priority = taskData.priority || 'upcoming';
        if (!VALID_TASK_PRIORITIES.has(priority)) {
          return jsonResponse(req, {
            success: false,
            error: `Task "priority" must be one of: ${[...VALID_TASK_PRIORITIES].join(', ')}.`
          }, 400);
        }

        const db = getFirestoreDb();
        if (!db) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'Firebase Firestore credentials are not configured.'
          }, 503);
        }

        const now = new Date().toISOString();
        const taskId = typeof taskData.id === 'string' && taskData.id.trim() ? taskData.id.trim() : null;
        const docRef = taskId ? db.collection('user_tasks').doc(taskId) : db.collection('user_tasks').doc();

        let createdAt = now;
        if (taskId) {
          const existing = await docRef.get();
          if (existing.exists) {
            // Verify ownership: User A cannot update User B's task!
            if (existing.data().userId !== auth.user.uid) {
              return jsonResponse(req, { success: false, error: 'Forbidden: You do not have permission to modify this task.' }, 403);
            }
            if (existing.data().createdAt) {
              createdAt = existing.data().createdAt;
            }
          }
        }

        const taskToSave = {
          id: docRef.id,
          userId: auth.user.uid,
          title: title.trim(),
          description: typeof taskData.description === 'string' ? taskData.description.trim() : '',
          dueDate: dueDate || null,
          priority,
          completed: Boolean(taskData.completed),
          eventId: typeof taskData.eventId === 'string' ? taskData.eventId.trim() : null,
          createdAt,
          updatedAt: now
        };

        await docRef.set(taskToSave, { merge: true });
        const saved = await docRef.get();

        return jsonResponse(req, { success: true, data: { id: saved.id, ...saved.data() } });
      }

      // ── get-tasks ──────────────────────────────────────────────────────────
      case 'get-tasks': {
        if (req.method !== 'GET') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use GET.' }, 405);
        }

        const auth = await authenticateRequest(req);
        if (!auth.authenticated) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: Boolean(auth.isConfigMissing),
            error: auth.error
          }, auth.status || 401);
        }

        const db = getFirestoreDb();
        if (!db) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'Firebase Firestore credentials are not configured.'
          }, 503);
        }

        const snapshot = await db.collection('user_tasks')
          .where('userId', '==', auth.user.uid)
          .limit(100)
          .get();

        const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return jsonResponse(req, { success: true, data: tasks });
      }

      // ── delete-task ────────────────────────────────────────────────────────
      case 'delete-task': {
        if (req.method !== 'POST' && req.method !== 'DELETE') {
          return jsonResponse(req, { success: false, error: 'Method not allowed. Use POST or DELETE.' }, 405);
        }

        const auth = await authenticateRequest(req);
        if (!auth.authenticated) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: Boolean(auth.isConfigMissing),
            error: auth.error
          }, auth.status || 401);
        }

        const id = body.id || url.searchParams.get('id');
        if (!id || !id.trim()) {
          return jsonResponse(req, { success: false, error: 'Task "id" is required for deletion.' }, 400);
        }

        const db = getFirestoreDb();
        if (!db) {
          return jsonResponse(req, {
            success: false,
            isConfigMissing: true,
            error: 'Firebase Firestore credentials are not configured.'
          }, 503);
        }

        const docRef = db.collection('user_tasks').doc(id.trim());
        const existing = await docRef.get();
        if (!existing.exists) {
          return jsonResponse(req, { success: false, error: 'Task not found.' }, 404);
        }

        // Verify ownership
        if (existing.data().userId !== auth.user.uid) {
          return jsonResponse(req, { success: false, error: 'Forbidden: You do not have permission to delete this task.' }, 403);
        }

        await docRef.delete();
        return jsonResponse(req, { success: true, message: 'Task deleted successfully.' });
      }

      // ── unknown action ─────────────────────────────────────────────────────
      default:
        return jsonResponse(req, { success: false, error: `Unknown action: "${action}".` }, 400);
    }

  } catch (err) {
    console.error('Campus AI function error:', err);
    return jsonResponse(req, {
      success: false,
      error: 'An internal server error occurred while processing the request.'
    }, 500);
  }
}

export default defaultHandler;

/**
 * Netlify Functions v1 / AWS Lambda compatible export.
 * Translates Lambda event/context to Web API Request/Response.
 */
export async function handler(event, context = {}) {
  if (typeof Request !== 'undefined' && event instanceof Request) {
    return defaultHandler(event, context);
  }

  const host = event.headers?.host || event.headers?.Host || 'localhost';
  const proto = event.headers?.['x-forwarded-proto'] || 'http';
  const path = event.path || '/.netlify/functions/campus-ai';
  const queryStr = event.queryStringParameters
    ? '?' + new URLSearchParams(event.queryStringParameters).toString()
    : (event.rawQuery ? '?' + event.rawQuery : '');

  const fullUrl = event.rawUrl || `${proto}://${host}${path}${queryStr}`;

  const headers = new Headers();
  if (event.headers) {
    for (const [k, v] of Object.entries(event.headers)) {
      if (v) headers.set(k, v);
    }
  }

  const reqInit = {
    method: event.httpMethod || 'GET',
    headers
  };

  if (event.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes((event.httpMethod || '').toUpperCase())) {
    reqInit.body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  }

  const req = new Request(fullUrl, reqInit);
  const response = await defaultHandler(req, context);

  const resHeaders = {};
  response.headers.forEach((v, k) => {
    resHeaders[k] = v;
  });

  const bodyText = await response.text();

  return {
    statusCode: response.status,
    headers: resHeaders,
    body: bodyText
  };
}
