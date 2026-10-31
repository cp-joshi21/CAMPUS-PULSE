/**
 * CampusPulse User Authentication & Identity Management
 * Modular Firebase Authentication with Google Sign-In, persistent session recovery,
 * reactive state subscriptions, and strict token security.
 */

import {
  signInWithGooglePopup,
  signInWithEmail,
  signUpWithEmail,
  sendPasswordReset,
  signOutFirebaseUser,
  subscribeAuthState,
  getFirebaseAuth
} from './firebase.js';

export class AuthStore {
  constructor() {
    this.currentUser = null;
    this.isLoading = true;
    this.error = null;
    this.listeners = new Set();
    this.STORAGE_KEY = 'campuspulse_auth_user';
    this.unsubscribeAuthListener = null;
  }

  /**
   * Subscribes a listener callback to authentication state changes.
   *
   * @param {(store: AuthStore) => void} listener
   * @returns {() => void} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    // Immediately emit current state to new subscriber
    try {
      listener(this);
    } catch (e) {
      console.error('Error invoking auth listener:', e);
    }
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (err) {
        console.error('Auth store listener error:', err);
      }
    }
  }

  /**
   * Initializes authentication state, restoring previous session from localStorage
   * and connecting to live Firebase onAuthStateChanged.
   */
  async init() {
    this.isLoading = true;

    // 1. Restore cached session immediately for instant UX on page refresh
    try {
      const cached = localStorage.getItem(this.STORAGE_KEY);
      if (cached) {
        this.currentUser = JSON.parse(cached);
      }
    } catch {
      localStorage.removeItem(this.STORAGE_KEY);
    }

    this.notify();

    // 2. Connect to live Firebase Auth client state listener
    try {
      this.unsubscribeAuthListener = await subscribeAuthState(async (user) => {
        if (user) {
          try {
            const token = await user.getIdToken();
            this.currentUser = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || user.email?.split('@')[0] || 'Campus Student',
              photoURL: user.photoURL || null,
              isDemo: false,
              token
            };
            this.saveToStorage(this.currentUser);
          } catch (tokenErr) {
            console.warn('Failed to retrieve fresh Firebase ID token:', tokenErr.message);
          }
        } else {
          // Firebase reports signed out
          this.currentUser = null;
          this.clearStorage();
        }
        this.isLoading = false;
        this.notify();
      });
    } catch (err) {
      console.warn('Firebase auth listener connection deferred:', err.message);
      this.isLoading = false;
      this.notify();
    }
  }

  /**
   * Signs in using Google Sign-In popup via Firebase Auth.
   *
   * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
   */
  async signInWithGoogle() {
    this.isLoading = true;
    this.error = null;
    this.notify();

    const res = await signInWithGooglePopup();

    if (res.success && res.user) {
      this.currentUser = res.user;
      this.saveToStorage(this.currentUser);
      this.isLoading = false;
      this.notify();
      return { success: true, user: this.currentUser };
    }

    this.isLoading = false;
    this.error = res.error || 'Google Sign-In failed.';
    this.notify();
    return {
      success: false,
      error: this.error
    };
  }

  /**
   * Signs in using Firebase Email and Password.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
   */
  async signInWithEmail(email, password) {
    this.isLoading = true;
    this.error = null;
    this.notify();

    const res = await signInWithEmail(email, password);

    if (res.success && res.user) {
      this.currentUser = res.user;
      this.saveToStorage(this.currentUser);
      this.isLoading = false;
      this.notify();
      return { success: true, user: this.currentUser };
    }

    this.isLoading = false;
    this.error = res.error || 'Authentication failed.';
    this.notify();
    return {
      success: false,
      error: this.error
    };
  }

  /**
   * Registers a new account with Firebase Email, Password, and Display Name.
   *
   * @param {string} email
   * @param {string} password
   * @param {string} [displayName]
   * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
   */
  async signUpWithEmail(email, password, displayName = '') {
    this.isLoading = true;
    this.error = null;
    this.notify();

    const res = await signUpWithEmail(email, password, displayName);

    if (res.success && res.user) {
      this.currentUser = res.user;
      this.saveToStorage(this.currentUser);
      this.isLoading = false;
      this.notify();
      return { success: true, user: this.currentUser };
    }

    this.isLoading = false;
    this.error = res.error || 'Account creation failed.';
    this.notify();
    return {
      success: false,
      error: this.error
    };
  }

  /**
   * Sends password reset instructions.
   *
   * @param {string} email
   * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
   */
  async resetPassword(email) {
    return sendPasswordReset(email);
  }

  /**
   * Cleanly signs the user out, clearing memory, local storage, and Firebase session.
   */
  async signOut() {
    this.isLoading = true;
    this.notify();

    await signOutFirebaseUser();

    this.currentUser = null;
    this.clearStorage();
    this.isLoading = false;
    this.error = null;
    this.notify();
  }

  /**
   * Returns valid Bearer ID token or null.
   * Fetches fresh token from Firebase Auth if currentUser is active.
   *
   * @returns {Promise<string|null>}
   */
  async getAuthToken() {
    if (!this.currentUser) return null;

    try {
      const fbAuth = await getFirebaseAuth();
      if (fbAuth?.currentUser) {
        const freshToken = await fbAuth.currentUser.getIdToken();
        this.currentUser.token = freshToken;
        this.saveToStorage(this.currentUser);
        return freshToken;
      }
    } catch {
      // Fallback to cached token
    }

    return this.currentUser.token || null;
  }

  /**
   * Alias for getAuthToken().
   */
  async getToken() {
    return this.getAuthToken();
  }

  get isAuthenticated() {
    return Boolean(this.currentUser);
  }

  isLoggedIn() {
    return Boolean(this.currentUser);
  }

  saveToStorage(user) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    } catch (e) {
      console.warn('Failed to cache auth user:', e);
    }
  }

  clearStorage() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear cached auth:', e);
    }
  }
}

export const authStore = new AuthStore();
