/**
 * CampusPulse Authentication & Account Modal Controller
 * Handles Google Sign-In dialog, user account profile menu,
 * and responsive state toggling.
 */

import { authStore } from '../js/auth.js';
import { taskStore } from '../js/tasks.js';
import { sanitizeText } from '../js/utils.js';
import { toast } from './toast.js';

export class AuthModalController {
  /**
   * @param {import('./event-modal.js').ModalController} modalController
   */
  constructor(modalController) {
    this.modal = modalController;
    this.headerAuthBtn = document.getElementById('btn-header-auth');
    this.headerUserName = document.getElementById('header-user-name');
    this.headerUserAvatar = document.getElementById('header-user-avatar');
  }

  init() {
    this.bindHeaderButton();

    // Subscribe to auth state updates to reflect user in header
    authStore.subscribe(() => {
      this.updateHeaderUi();
    });
  }

  bindHeaderButton() {
    if (this.headerAuthBtn) {
      this.headerAuthBtn.addEventListener('click', () => {
        if (authStore.isAuthenticated) {
          this.showAccountDialog();
        } else {
          this.showLoginDialog();
        }
      });
    }
  }

  updateHeaderUi() {
    if (!this.headerUserName || !this.headerUserAvatar) return;

    if (authStore.isAuthenticated && authStore.currentUser) {
      const user = authStore.currentUser;
      const initials = (user.displayName || user.email || 'U')
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

      this.headerUserName.textContent = user.displayName || 'Campus User';
      this.headerUserAvatar.innerHTML = sanitizeText(initials);
      this.headerUserAvatar.classList.add('has-initials');
      if (this.headerAuthBtn) {
        this.headerAuthBtn.classList.add('is-logged-in');
      }
    } else {
      this.headerUserName.textContent = 'Sign In';
      this.headerUserAvatar.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      `;
      this.headerUserAvatar.classList.remove('has-initials');
      if (this.headerAuthBtn) {
        this.headerAuthBtn.classList.remove('is-logged-in');
      }
    }
  }

  showLoginDialog() {
    const html = `
      <div class="modal-header">
        <div class="modal-badges">
          <span class="badge badge-this-week">
            <span class="badge-dot" aria-hidden="true"></span>
            Campus Authentication
          </span>
        </div>
        <button type="button" class="modal-close" aria-label="Close dialog">&times;</button>
      </div>

      <div class="modal-body auth-modal-body">
        <div class="auth-dialog-header">
          <div class="auth-logo-badge" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <h2 id="modal-title" class="modal-title">Sign in to CampusPulse</h2>
          <p class="modal-subtitle">
            Connect with your university account to manage your academic deadlines, track personal reminders, and submit notices.
          </p>
        </div>

        <div class="auth-actions-group">
          <button type="button" id="btn-google-signin" class="btn btn-google">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Sign in with Google</span>
          </button>
        </div>

        <p class="auth-footer-note">
          Public campus circulars and announcements remain accessible without signing in.
        </p>
      </div>

      <div class="modal-footer" style="justify-content: center;">
        <button type="button" class="btn btn-ghost modal-close">Continue as Guest</button>
      </div>
    `;

    this.modal.open(html);

    // Bind Google button
    const googleBtn = document.getElementById('btn-google-signin');
    if (googleBtn) {
      googleBtn.addEventListener('click', async () => {
        googleBtn.disabled = true;
        googleBtn.innerHTML = `
          <span class="spinner" aria-hidden="true"></span>
          <span>Connecting with Google...</span>
        `;
        const res = await authStore.signInWithGoogle();
        if (res.success) {
          toast.success(`Welcome to CampusPulse, ${res.user.displayName}!`);
          this.modal.close();
        } else {
          toast.error(res.error || 'Authentication failed.');
          googleBtn.disabled = false;
          googleBtn.innerHTML = `<span>Sign in with Google</span>`;
        }
      });
    }

    // Bind close
    document.querySelectorAll('.modal-close').forEach(b => {
      b.addEventListener('click', () => this.modal.close());
    });
  }

  showAccountDialog() {
    const user = authStore.currentUser;
    if (!user) return;

    const pendingTasks = taskStore.getPendingCount();

    const html = `
      <div class="modal-header">
        <div class="modal-badges">
          <span class="badge badge-category">Active Session</span>
          <span class="badge badge-ai">Google Verified</span>
        </div>
        <button type="button" class="modal-close" aria-label="Close dialog">&times;</button>
      </div>

      <div class="modal-body auth-modal-body">
        <div class="account-profile-header">
          <div class="account-big-avatar" aria-hidden="true">
            ${sanitizeText((user.displayName || 'U').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase())}
          </div>
          <div>
            <h2 id="modal-title" class="account-name">${sanitizeText(user.displayName || 'Campus User')}</h2>
            <div class="account-email">${sanitizeText(user.email || 'No email associated')}</div>
            <div class="account-uid">UID: <code>${sanitizeText(user.uid)}</code></div>
          </div>
        </div>

        <div class="modal-meta-grid" style="margin-top: 1rem;">
          <div class="meta-card">
            <span class="meta-label">Pending Tasks</span>
            <span class="meta-value">${pendingTasks}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Role</span>
            <span class="meta-value">Registered Student</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Access Level</span>
            <span class="meta-value">Authorized</span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-close">Close</button>
        <button type="button" id="btn-account-signout" class="btn btn-primary" style="background-color: var(--color-urgent);">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Sign Out
        </button>
      </div>
    `;

    this.modal.open(html);

    const signoutBtn = document.getElementById('btn-account-signout');
    if (signoutBtn) {
      signoutBtn.addEventListener('click', async () => {
        await authStore.signOut();
        toast.info('You have been signed out.');
        this.modal.close();
      });
    }

    document.querySelectorAll('.modal-close').forEach(b => {
      b.addEventListener('click', () => this.modal.close());
    });
  }
}

