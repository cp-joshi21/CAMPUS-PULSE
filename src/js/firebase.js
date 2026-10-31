/**
 * CampusPulse Central Firebase Client Architecture
 * 
 * Provides unified, singleton initialization of Firebase App, Firebase Authentication,
 * and Cloud Firestore. Ensures zero duplicate initializations across modules.
 * Exports reusable Auth and Firestore instances, session persistence, and real-time listeners.
 */

import { CONFIG } from './config.js';

let appInstance = null;
let authInstance = null;
let firestoreInstance = null;
let googleProviderInstance = null;
let authStateUnsubscribe = null;

/**
 * Initializes and returns the centralized Firebase client services.
 * Implements singleton pattern to guarantee a single app instance.
 *
 * @returns {Promise<{ app: object, auth: object, db: object, googleProvider: object } | null>}
 */
export async function getFirebaseClient() {
  if (appInstance && authInstance && firestoreInstance) {
    return {
      app: appInstance,
      auth: authInstance,
      db: firestoreInstance,
      googleProvider: googleProviderInstance
    };
  }

  const clientConfig = CONFIG.FIREBASE_CLIENT;
  if (!clientConfig || !clientConfig.apiKey) {
    return null;
  }

  try {
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    const { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } = await import('firebase/auth');
    const { getFirestore } = await import('firebase/firestore');

    // 1. Singleton App initialization
    appInstance = getApps().length > 0 ? getApp() : initializeApp(clientConfig);

    // 2. Authentication with browserLocalPersistence
    authInstance = getAuth(appInstance);
    if (typeof window !== 'undefined' && browserLocalPersistence) {
      try {
        await setPersistence(authInstance, browserLocalPersistence);
      } catch (persistenceErr) {
        console.warn('Firebase session persistence fallback notice:', persistenceErr.message);
      }
    }

    // 3. Google OAuth Provider with account selector prompt
    googleProviderInstance = new GoogleAuthProvider();
    googleProviderInstance.setCustomParameters({ prompt: 'select_account' });

    // 4. Cloud Firestore client
    firestoreInstance = getFirestore(appInstance);

    return {
      app: appInstance,
      auth: authInstance,
      db: firestoreInstance,
      googleProvider: googleProviderInstance
    };
  } catch (err) {
    console.warn('Firebase client SDK initialization notice:', err.message);
    return null;
  }
}

/**
 * Returns the active FirebaseAuth instance or null if uninitialized.
 */
export async function getFirebaseAuth() {
  const client = await getFirebaseClient();
  return client ? client.auth : null;
}

/**
 * Returns the active Firestore instance or null if uninitialized.
 */
export async function getFirestoreDb() {
  const client = await getFirebaseClient();
  return client ? client.db : null;
}

/**
 * Translates Firebase Auth error codes into helpful, accessible messages.
 *
 * @param {Error|object} err
 * @returns {string}
 */
export function mapFirebaseAuthError(err) {
  if (!err) return 'An unexpected authentication error occurred.';
  const code = err.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Please verify your credentials.';
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists. Please sign in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact the campus administrator.';
    case 'auth/too-many-requests':
      return 'Too many failed login attempts. Access is temporarily disabled. Please try again later or reset your password.';
    case 'auth/network-request-failed':
      return 'Network connection error. Please verify your internet connection.';
    case 'auth/popup-closed-by-user':
      return 'Google Sign-In was cancelled.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please allow popups for this site.';
    case 'auth/operation-not-allowed':
      return 'This authentication method is currently not enabled in Firebase Console.';
    default:
      return err.message || 'Authentication operation failed.';
  }
}

/**
 * Signs in using Firebase Email and Password.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
export async function signInWithEmail(email, password) {
  if (!email || !password) {
    return { success: false, error: 'Email and password are required.' };
  }

  const client = await getFirebaseClient();
  if (!client || !client.auth) {
    return {
      success: false,
      error: 'Firebase Authentication is not available. Please verify network connectivity.'
    };
  }

  try {
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    const credential = await signInWithEmailAndPassword(client.auth, email.trim(), password);
    const user = credential.user;
    const token = await user.getIdToken();

    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email?.split('@')[0] || 'Campus Student',
        photoURL: user.photoURL || null,
        isDemo: false,
        token
      }
    };
  } catch (err) {
    return {
      success: false,
      error: mapFirebaseAuthError(err)
    };
  }
}

/**
 * Registers a new account using Firebase Email and Password, and updates user profile displayName.
 *
 * @param {string} email
 * @param {string} password
 * @param {string} [displayName]
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
export async function signUpWithEmail(email, password, displayName = '') {
  if (!email || !password) {
    return { success: false, error: 'Email and password are required.' };
  }
  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters.' };
  }

  const client = await getFirebaseClient();
  if (!client || !client.auth) {
    return {
      success: false,
      error: 'Firebase Authentication is not available. Please verify network connectivity.'
    };
  }

  try {
    const { createUserWithEmailAndPassword, updateProfile } = await import('firebase/auth');
    const credential = await createUserWithEmailAndPassword(client.auth, email.trim(), password);
    const user = credential.user;

    const cleanName = displayName?.trim() || email.split('@')[0] || 'Campus Student';
    try {
      await updateProfile(user, { displayName: cleanName });
    } catch (profileErr) {
      console.warn('Profile name update notice:', profileErr.message);
    }

    const token = await user.getIdToken();

    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: cleanName,
        photoURL: user.photoURL || null,
        isDemo: false,
        token
      }
    };
  } catch (err) {
    return {
      success: false,
      error: mapFirebaseAuthError(err)
    };
  }
}

/**
 * Sends a password reset email via Firebase Authentication.
 *
 * @param {string} email
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
export async function sendPasswordReset(email) {
  if (!email || !email.trim()) {
    return { success: false, error: 'Please enter your email address.' };
  }

  const client = await getFirebaseClient();
  if (!client || !client.auth) {
    return {
      success: false,
      error: 'Firebase Authentication is not available. Please verify network connectivity.'
    };
  }

  try {
    const { sendPasswordResetEmail } = await import('firebase/auth');
    await sendPasswordResetEmail(client.auth, email.trim());
    return {
      success: true,
      message: 'Password reset instructions have been sent to your email.'
    };
  } catch (err) {
    return {
      success: false,
      error: mapFirebaseAuthError(err)
    };
  }
}

/**
 * Executes Google Sign-In popup with session persistence.
 *
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
export async function signInWithGooglePopup() {
  const client = await getFirebaseClient();
  if (!client || !client.auth || !client.googleProvider) {
    return {
      success: false,
      error: 'Firebase Authentication is not available. Please verify network connectivity.'
    };
  }

  try {
    const { signInWithPopup } = await import('firebase/auth');
    const credential = await signInWithPopup(client.auth, client.googleProvider);
    const user = credential.user;
    const token = await user.getIdToken();

    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email?.split('@')[0] || 'Campus Student',
        photoURL: user.photoURL || null,
        isDemo: false,
        token
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Google Sign-In failed.'
    };
  }
}

/**
 * Signs the user out from Firebase Authentication.
 */
export async function signOutFirebaseUser() {
  const client = await getFirebaseClient();
  if (!client || !client.auth) return;

  try {
    const { signOut } = await import('firebase/auth');
    await signOut(client.auth);
  } catch (err) {
    console.warn('Firebase signOut error:', err.message);
  }
}

/**
 * Attaches a callback to Firebase onAuthStateChanged.
 * Returns an unsubscribe function.
 */
export async function subscribeAuthState(callback) {
  const client = await getFirebaseClient();
  if (!client || !client.auth) {
    callback(null);
    return () => {};
  }

  const { onAuthStateChanged } = await import('firebase/auth');
  return onAuthStateChanged(client.auth, callback);
}

/**
 * Subscribes to real-time updates for published events in Firestore.
 *
 * @param {(events: Array<object>) => void} onUpdate
 * @param {(error: Error) => void} onError
 * @returns {Promise<() => void>} Unsubscribe callback
 */
export async function subscribeEvents(onUpdate, onError) {
  const client = await getFirebaseClient();
  if (!client || !client.db) {
    return () => {};
  }

  const { collection, query, orderBy, onSnapshot } = await import('firebase/firestore');
  const eventsCol = collection(client.db, 'events');
  const q = query(eventsCol, orderBy('startDate', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const events = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'archived') {
          events.push({ id: doc.id, ...data });
        }
      });
      onUpdate(events);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    }
  );
}

/**
 * Subscribes to real-time updates for a specific student's tasks in Firestore.
 *
 * @param {string} userId
 * @param {(tasks: Array<object>) => void} onUpdate
 * @param {(error: Error) => void} onError
 * @returns {Promise<() => void>} Unsubscribe callback
 */
export async function subscribeUserTasks(userId, onUpdate, onError) {
  if (!userId) return () => {};

  const client = await getFirebaseClient();
  if (!client || !client.db) {
    return () => {};
  }

  const { collection, query, where, onSnapshot } = await import('firebase/firestore');
  const tasksCol = collection(client.db, 'user_tasks');
  const q = query(tasksCol, where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const tasks = [];
      snapshot.forEach((doc) => {
        tasks.push({ id: doc.id, ...doc.data() });
      });
      onUpdate(tasks);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    }
  );
}
