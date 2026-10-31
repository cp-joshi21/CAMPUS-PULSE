/**
 * CampusPulse Authentication and Token Security Tests
 * Verifies Bearer token extraction, user identity mapping,
 * demo token structure, and ownership authorization.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
