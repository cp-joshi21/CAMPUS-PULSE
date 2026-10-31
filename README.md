# CampusPulse

> **Everything happening on your campus. One intelligent place.**

CampusPulse is an AI-powered campus information platform that converts unstructured college announcements, WhatsApp broadcasts, departmental emails, and event notices into structured, searchable, and actionable campus intelligence.

---

## 🏛️ System Architecture

```
[ Unstructured Campus Notices ]
              │ (Paste/Input)
              ▼
   [ Vanilla JS Client UI ]
     ├── Responsive Dashboard & Metrics Bar
     ├── Dynamic Filtering & Debounced Search
     ├── List & Monthly Calendar Views
     └── RFC 5545 iCalendar (.ics) Export
              │
              ▼ (Fetch API - Same-Origin)
   [ Netlify Serverless Functions ]
     ├── campus-ai.mjs (Secure Backend API)
     ├── Cold-Start & Missing Config Resilience
     └── Zero Credentials Leaked to Client
        │                          │
        ▼                          ▼
[ Google Gemini AI ]     [ Firebase Firestore ]
 • Structured Schema       • Persistent Event Store
 • Weekly Summaries        • Firebase Admin SDK
```

---

## 🔒 Locked Technology Stack

- **Frontend:** Vanilla JavaScript (ES Modules), HTML5, CSS3 Custom Properties.
- **Build System:** Vite.
- **Serverless Backend:** Netlify Functions (`campus-ai.mjs`).
- **AI Engine:** Google Gemini API (`@google/genai`).
- **Database:** Firebase Firestore via Firebase Admin SDK (`firebase-admin`).
- **Hosting:** Netlify.
- **Testing:** Node.js native test runner (`node --test`).

---

## 📂 Project Directory Structure

```
CAMPUS-PULSE/
├── index.html                   # Semantic HTML5 application shell & landmarks
├── package.json                 # Project dependencies & scripts
├── package-lock.json            # Deterministic dependency tree
├── vite.config.js               # Vite build & development proxy configuration
├── netlify.toml                 # Netlify build, redirects, and headers
├── .gitignore                   # Excludes node_modules, dist, credentials
├── .env.example                 # Documented environment variables
├── README.md                    # Engineering documentation
├── database/
│   └── schema-notes.md          # Firestore collections & indexes architecture
├── src/
│   ├── main.js                  # Application entry point & orchestration
│   ├── css/
│   │   └── styles.css           # Design tokens, accessibility, responsive UI
│   ├── js/
│   │   ├── config.js            # Design tokens, categories, priority metadata
│   │   ├── utils.js             # Date validation, priority model, sanitization
│   │   ├── filters.js           # Multi-criteria filtering & sorting engine
│   │   ├── api.js               # Resilient Netlify Functions client
│   │   ├── ai.js                # Gemini extraction & summary orchestration
│   │   ├── events.js            # Reactive event store & deep-link sync
│   │   ├── calendar.js          # Calendar matrix generator & .ics export
│   │   └── dashboard.js         # Navigation controller & header metrics
│   └── components/
│       ├── announcement-form.js # Notice input & AI extraction trigger
│       ├── event-card.js        # Accessible event card with priority badge
│       ├── event-modal.js       # Focus-trapped dialog & review form
│       └── toast.js             # Live region polite toast notifications
├── netlify/
│   └── functions/
│       └── campus-ai.mjs        # Serverless backend for Gemini & Firestore
└── tests/
    ├── utils.test.js            # Date & priority classification unit tests
    └── filters.test.js          # Search, category, and sorting unit tests
```

---

## ⚡ Priority Classification Model

CampusPulse implements an unambiguous, deterministic date-based priority model:

1. **`expired`**: Event date/time has passed (`eventDate < now`).
2. **`urgent`**: Event takes place on the **same calendar day** as today (immediate deadline/event).
3. **`upcoming`**: Event is scheduled for tomorrow or a future date within the **next 24 hours** from the reference moment.
4. **`this-week`**: Event is scheduled within the **next 7 calendar days**.
5. **`scheduled`**: Event is scheduled further than 7 days out.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in credentials:
```bash
cp .env.example .env
```
*(Required for live AI extraction and Firestore persistence; the app runs with informative configuration warnings when variables are absent).*

### 3. Run Automated Tests
```bash
npm test
```

### 4. Start Development Server
```bash
npm run dev
```

### 5. Production Build
```bash
npm run build
```

---

## 🛡️ Security & Google Services Usage
- **Zero Client Credential Exposure:** Neither `GEMINI_API_KEY` nor Firebase service account keys are bundled into frontend assets. All calls are routed through Netlify serverless functions.
- **Request Validation & Error Shielding:** Raw inputs are validated and sanitized server-side. Internal error stack traces are never sent to the client.
- **Cold-Start Resilience:** Serverless handlers verify configuration gracefully and return HTTP 503 with user-friendly notices when environment variables are pending.

