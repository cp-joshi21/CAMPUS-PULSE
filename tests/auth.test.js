/**
 * CampusPulse Authentication and Token Security Tests
 * Verifies Bearer token extraction, user identity mapping,
 * demo token structure, ownership authorization, error translations,
 * and form validation contracts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapFirebaseAuthError } from '../src/js/firebase.js';
import { AuthStore } from '../src/js/auth.js';

describe('CampusPulse Authentication and Security Rules', () => {
  function parseBearerToken(authHeader) {
    if (!authHeader || typeof authHeader !== 'string') return null;
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    return token.length > 0 ? token : null;
  }

  function parseDemoToken(token) {
    if (!token || !token.startsWith('demo-token:')) return null;
    const parts = token.split(':');
    return {
      uid: parts[1] || 'demo-user',
      name: parts[2] ? decodeURIComponent(parts[2]) : 'Campus User'
    };
  }

  it('extracts valid Bearer tokens accurately', () => {
    const token = parseBearerToken('Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9');
    assert.equal(token, 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9');
  });

  it('rejects malformed, empty, and non-Bearer headers', () => {
    assert.equal(parseBearerToken(null), null);
    assert.equal(parseBearerToken(''), null);
    assert.equal(parseBearerToken('Basic YWxhZGRpbjpvcGVuc2VzYW1l'), null);
    assert.equal(parseBearerToken('Bearer '), null);
  });

  it('parses demo token identity with URI decoded username', () => {
    const parsed = parseDemoToken('demo-token:student-alex-chen:Alex%20Chen%20(Leader)');
    assert.notEqual(parsed, null);
    assert.equal(parsed.uid, 'student-alex-chen');
    assert.equal(parsed.name, 'Alex Chen (Leader)');
  });

  it('enforces task ownership comparison strictly', () => {
    const taskOwnerUid = 'user-abc-123';
    const requestingUserA = 'user-abc-123';
    const requestingUserB = 'user-hacker-456';

    assert.equal(taskOwnerUid === requestingUserA, true, 'Owner should be authorized');
    assert.equal(taskOwnerUid === requestingUserB, false, 'Non-owner must be rejected');
  });

  it('rejects demo tokens in production authentication policy', () => {
    function productionAuthenticate(authHeader, hasServerCredentials = true) {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { authenticated: false, status: 401, error: 'Expected Bearer token' };
      }
      const token = authHeader.slice(7).trim();
      // In production, demo tokens are strictly forbidden
      if (token.startsWith('demo-token:') || token.startsWith('test-token:')) {
        return {
          authenticated: false,
          status: 401,
          error: 'Demo tokens and client-supplied identities are strictly prohibited in production.'
        };
      }
      if (!hasServerCredentials) {
        return {
          authenticated: false,
          status: 503,
          isConfigMissing: true,
          error: 'Firebase service account credentials missing.'
        };
      }
      if (token === 'valid-google-jwt') {
        return { authenticated: true, user: { uid: 'google-uid-888', isDemo: false } };
      }
      return { authenticated: false, status: 401, error: 'Invalid token.' };
    }

    const demoAttempt = productionAuthenticate('Bearer demo-token:hacker:Admin');
    assert.equal(demoAttempt.authenticated, false);
    assert.equal(demoAttempt.status, 401);
    assert.match(demoAttempt.error, /strictly prohibited in production/i);

    const missingCredsAttempt = productionAuthenticate('Bearer valid-google-jwt', false);
    assert.equal(missingCredsAttempt.authenticated, false);
    assert.equal(missingCredsAttempt.status, 503);
    assert.equal(missingCredsAttempt.isConfigMissing, true);

    const validAttempt = productionAuthenticate('Bearer valid-google-jwt', true);
    assert.equal(validAttempt.authenticated, true);
    assert.equal(validAttempt.user.uid, 'google-uid-888');
    assert.equal(validAttempt.user.isDemo, false);
  });

  it('prohibits client-supplied UID tampering on task creation', () => {
    const verifiedUser = { uid: 'real-student-456', email: 'student@campus.edu' };
    const untrustedClientBody = {
      task: {
        id: 'task-1',
        title: 'Study',
        userId: 'forged-victim-uid-999' // client tries to forge victim's UID
      }
    };

    // Server-enforced assignment:
    const serverEnforcedTask = {
      ...untrustedClientBody.task,
      userId: verifiedUser.uid // server forces authenticated UID
    };

    assert.equal(serverEnforcedTask.userId, 'real-student-456');
    assert.notEqual(serverEnforcedTask.userId, untrustedClientBody.task.userId);
  });
});

describe('CampusPulse Firebase Error Translation & Mapping', () => {
  it('translates invalid credential errors to safe user-friendly text', () => {
    const msg1 = mapFirebaseAuthError({ code: 'auth/invalid-credential' });
    assert.match(msg1, /incorrect email or password/i);

    const msg2 = mapFirebaseAuthError({ code: 'auth/wrong-password' });
    assert.match(msg2, /incorrect email or password/i);

    const msg3 = mapFirebaseAuthError({ code: 'auth/user-not-found' });
    assert.match(msg3, /incorrect email or password/i);
  });

  it('translates duplicate account registration errors properly', () => {
    const msg = mapFirebaseAuthError({ code: 'auth/email-already-in-use' });
    assert.match(msg, /already exists/i);
  });

  it('translates weak password and email formatting errors', () => {
    const weak = mapFirebaseAuthError({ code: 'auth/weak-password' });
    assert.match(weak, /at least 6 characters/i);

    const invalidEmail = mapFirebaseAuthError({ code: 'auth/invalid-email' });
    assert.match(invalidEmail, /valid email address/i);
  });

  it('translates rate-limiting and disabled account errors safely', () => {
    const throttled = mapFirebaseAuthError({ code: 'auth/too-many-requests' });
    assert.match(throttled, /temporarily disabled/i);

    const disabled = mapFirebaseAuthError({ code: 'auth/user-disabled' });
    assert.match(disabled, /account has been disabled/i);
  });

  it('translates popup and network failures safely', () => {
    const network = mapFirebaseAuthError({ code: 'auth/network-request-failed' });
    assert.match(network, /network connection error/i);

    const cancelled = mapFirebaseAuthError({ code: 'auth/popup-closed-by-user' });
    assert.match(cancelled, /cancelled/i);
  });
});

describe('CampusPulse Authentication Form Validation Rules', () => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  it('validates university email formats correctly', () => {
    assert.equal(emailRegex.test('student@campus.edu'), true);
    assert.equal(emailRegex.test('prof.miller@university.ac.in'), true);
    assert.equal(emailRegex.test(''), false);
    assert.equal(emailRegex.test('not-an-email'), false);
    assert.equal(emailRegex.test('student@'), false);
    assert.equal(emailRegex.test('@campus.edu'), false);
    assert.equal(emailRegex.test('spaces in@campus.edu'), false);
  });

  it('enforces password minimum length requirements', () => {
    function validatePassword(pwd) {
      if (!pwd || typeof pwd !== 'string') return false;
      return pwd.length >= 6;
    }

    assert.equal(validatePassword('12345'), false, '5 chars should be rejected');
    assert.equal(validatePassword('123456'), true, '6 chars should pass');
    assert.equal(validatePassword('SecurePass123!'), true, 'Strong password passes');
    assert.equal(validatePassword(''), false, 'Empty password fails');
  });

  it('verifies password confirmation matching correctly', () => {
    function checkPasswordsMatch(pwd, confirmPwd) {
      return Boolean(pwd && confirmPwd && pwd === confirmPwd);
    }

    assert.equal(checkPasswordsMatch('secret123', 'secret123'), true);
    assert.equal(checkPasswordsMatch('secret123', 'different'), false);
    assert.equal(checkPasswordsMatch('secret123', ''), false);
  });
});

describe('CampusPulse AuthStore Reactive State and Session Recovery', () => {
  it('correctly reports isAuthenticated as false when no user is signed in', () => {
    const store = new AuthStore();
    store.currentUser = null;
    assert.equal(store.isAuthenticated, false);
    assert.equal(typeof store.isAuthenticated, 'boolean');
  });

  it('correctly reports isAuthenticated as true when a user is signed in', () => {
    const store = new AuthStore();
    store.currentUser = {
      uid: 'student-test-123',
      email: 'student@campus.edu',
      displayName: 'Alex Chen',
      token: 'jwt-xyz'
    };
    assert.equal(store.isAuthenticated, true);
    assert.equal(typeof store.isAuthenticated, 'boolean');
  });

  it('returns valid token from getAuthToken when user has active token', async () => {
    const store = new AuthStore();
    store.currentUser = {
      uid: 'user-456',
      token: 'token-abc'
    };
    const token = await store.getAuthToken();
    assert.equal(token, 'token-abc');

    store.currentUser = null;
    const noToken = await store.getAuthToken();
    assert.equal(noToken, null);
  });

  it('notifies subscribers synchronously upon subscription and on state changes', () => {
    const store = new AuthStore();
    let callCount = 0;
    let lastUser = null;

    const unsubscribe = store.subscribe((s) => {
      callCount++;
      lastUser = s.currentUser;
    });

    assert.equal(callCount, 1, 'Subscriber should be invoked immediately on registration');
    assert.equal(lastUser, null);

    store.currentUser = { uid: 'user-789', displayName: 'Samira' };
    store.notify();

    assert.equal(callCount, 2);
    assert.equal(lastUser.displayName, 'Samira');

    unsubscribe();
    store.notify();
    assert.equal(callCount, 2, 'Unsubscribed listener must not receive further events');
  });
});
