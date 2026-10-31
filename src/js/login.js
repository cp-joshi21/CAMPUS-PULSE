/**
 * CampusPulse Standalone Login Page Controller
 * Manages email/password authentication, Google OAuth sign-in,
 * input validation, loading states, error displays, and safe redirects.
 */

import { authStore } from './auth.js';
import { isSafeRedirectUrl } from './utils.js';

class LoginController {
  constructor() {
    this.form = document.getElementById('form-login');
    this.emailInput = document.getElementById('login-email');
    this.passwordInput = document.getElementById('login-password');
    this.togglePwdBtn = document.getElementById('btn-toggle-password');
    this.submitBtn = document.getElementById('btn-submit-login');
    this.googleBtn = document.getElementById('btn-google-login');
    this.alertEl = document.getElementById('login-alert');
    this.rememberMeCheckbox = document.getElementById('remember-me');
  }

  init() {
    // 1. Initialize session and watch auth state
    authStore.init();

    authStore.subscribe((store) => {
      // If already authenticated and not currently loading, redirect
      if (store.isAuthenticated && !store.isLoading) {
        this.redirectToApp();
      }
    });

    // 2. Bind DOM events
    this.bindFormEvents();
    this.bindPasswordToggle();
    this.bindForgotPassword();
    this.bindGoogleAuth();

    // 3. Pre-fill email if remembered
    try {
      const savedEmail = localStorage.getItem('campuspulse_remembered_email');
      if (savedEmail && this.emailInput) {
        this.emailInput.value = savedEmail;
        if (this.rememberMeCheckbox) this.rememberMeCheckbox.checked = true;
        if (this.passwordInput) this.passwordInput.focus();
      }
    } catch {
      // Storage unavailable
    }
  }

  bindForgotPassword() {
    const forgotBtn = document.getElementById('btn-forgot-password');
    if (!forgotBtn) return;

    forgotBtn.addEventListener('click', async () => {
      this.clearAlert();
      const email = this.emailInput?.value?.trim();
      if (!email) {
        this.showAlert('Please enter your university email above first, then click "Forgot password?".', 'error');
        this.emailInput?.focus();
        return;
      }

      forgotBtn.disabled = true;
      const originalText = forgotBtn.textContent;
      forgotBtn.textContent = 'Sending...';

      const res = await authStore.resetPassword(email);
      forgotBtn.disabled = false;
      forgotBtn.textContent = originalText;

      if (res.success) {
        this.showAlert(res.message || 'Password reset link sent to your email. Please check your inbox.', 'success');
      } else {
        this.showAlert(res.error || 'Unable to send password reset email.', 'error');
      }
    });
  }

  bindPasswordToggle() {
    if (!this.togglePwdBtn || !this.passwordInput) return;

    this.togglePwdBtn.addEventListener('click', () => {
      const isPassword = this.passwordInput.getAttribute('type') === 'password';
      this.passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
      this.togglePwdBtn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
      this.togglePwdBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      this.togglePwdBtn.innerHTML = isPassword
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    });
  }

  bindFormEvents() {
    if (!this.form) return;

    this.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.clearAlert();

      const email = this.emailInput?.value?.trim() || '';
      const password = this.passwordInput?.value || '';

      // Validation
      if (!email) {
        this.showAlert('Please enter your university email address.', 'error');
        this.emailInput?.focus();
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        this.showAlert('Please enter a valid email format (e.g. student@campus.edu).', 'error');
        this.emailInput?.focus();
        return;
      }

      if (!password) {
        this.showAlert('Please enter your account password.', 'error');
        this.passwordInput?.focus();
        return;
      }

      // Remember me handling
      try {
        if (this.rememberMeCheckbox?.checked) {
          localStorage.setItem('campuspulse_remembered_email', email);
        } else {
          localStorage.removeItem('campuspulse_remembered_email');
        }
      } catch {
        // Storage restricted
      }

      this.setSubmitting(true);

      const res = await authStore.signInWithEmail(email, password);

      if (res.success) {
        this.showAlert('Sign in successful. Redirecting to CampusPulse...', 'success');
        setTimeout(() => this.redirectToApp(), 600);
      } else {
        this.setSubmitting(false);
        this.showAlert(res.error || 'Authentication failed. Please check your credentials.', 'error');
      }
    });
  }

  bindGoogleAuth() {
    if (!this.googleBtn) return;

    this.googleBtn.addEventListener('click', async () => {
      this.clearAlert();
      this.googleBtn.disabled = true;
      const originalHtml = this.googleBtn.innerHTML;
      this.googleBtn.innerHTML = `
        <span class="spinner" aria-hidden="true"></span>
        <span>Connecting with Google...</span>
      `;

      const res = await authStore.signInWithGoogle();

      if (res.success) {
        this.showAlert('Google Sign-In successful. Redirecting...', 'success');
        setTimeout(() => this.redirectToApp(), 600);
      } else {
        this.googleBtn.disabled = false;
        this.googleBtn.innerHTML = originalHtml;
        this.showAlert(res.error || 'Google Sign-In was cancelled or failed.', 'error');
      }
    });
  }

  setSubmitting(isSubmitting) {
    if (!this.submitBtn) return;
    this.submitBtn.disabled = isSubmitting;
    if (this.googleBtn) this.googleBtn.disabled = isSubmitting;
    if (this.emailInput) this.emailInput.disabled = isSubmitting;
    if (this.passwordInput) this.passwordInput.disabled = isSubmitting;

    if (isSubmitting) {
      this.submitBtn.innerHTML = `
        <span class="spinner" aria-hidden="true"></span>
        <span>Signing in...</span>
      `;
    } else {
      this.submitBtn.innerHTML = `Sign In`;
    }
  }

  showAlert(message, type = 'error') {
    if (!this.alertEl) return;
    this.alertEl.className = `auth-alert auth-alert-${type}`;
    this.alertEl.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = type === 'error'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    this.alertEl.innerHTML = `${icon}<span>${message}</span>`;
    this.alertEl.classList.remove('is-hidden');
  }

  clearAlert() {
    if (!this.alertEl) return;
    this.alertEl.className = 'auth-alert is-hidden';
    this.alertEl.innerHTML = '';
  }

  redirectToApp() {
    try {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      window.location.href = isSafeRedirectUrl(redirect) ? redirect : 'index.html';
    } catch {
      window.location.href = 'index.html';
    }
  }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const controller = new LoginController();
  controller.init();
});