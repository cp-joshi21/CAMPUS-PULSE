/**
 * CampusPulse Standalone Signup Page Controller
 * Manages student registration with real Firebase Authentication,
 * profile display name creation, password strength validation, and confirmation matching.
 */

import { authStore } from './auth.js';
import { isSafeRedirectUrl } from './utils.js';

class SignupController {
  constructor() {
    this.form = document.getElementById('form-signup');
    this.nameInput = document.getElementById('signup-name');
    this.emailInput = document.getElementById('signup-email');
    this.passwordInput = document.getElementById('signup-password');
    this.confirmPwdInput = document.getElementById('signup-confirm-password');
    this.togglePwdBtn = document.getElementById('btn-toggle-signup-pwd');
    this.toggleConfirmPwdBtn = document.getElementById('btn-toggle-confirm-pwd');
    this.termsCheckbox = document.getElementById('signup-terms');
    this.submitBtn = document.getElementById('btn-submit-signup');
    this.googleBtn = document.getElementById('btn-google-signup');
    this.alertEl = document.getElementById('signup-alert');
  }

  init() {
    // 1. Initialize session and watch auth state
    authStore.init();

    authStore.subscribe((store) => {
      if (store.isAuthenticated && !store.isLoading) {
        this.redirectToApp();
      }
    });

    // 2. Bind DOM events
    this.bindFormEvents();
    this.bindPasswordToggles();
    this.bindGoogleAuth();
  }

  bindPasswordToggles() {
    // Password toggle
    if (this.togglePwdBtn && this.passwordInput) {
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

    // Confirm password toggle
    if (this.toggleConfirmPwdBtn && this.confirmPwdInput) {
      this.toggleConfirmPwdBtn.addEventListener('click', () => {
        const isPassword = this.confirmPwdInput.getAttribute('type') === 'password';
        this.confirmPwdInput.setAttribute('type', isPassword ? 'text' : 'password');
        this.toggleConfirmPwdBtn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
        this.toggleConfirmPwdBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        this.toggleConfirmPwdBtn.innerHTML = isPassword
          ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
          : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      });
    }
  }

  bindFormEvents() {
    if (!this.form) return;

    this.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.clearAlert();

      const name = this.nameInput?.value?.trim() || '';
      const email = this.emailInput?.value?.trim() || '';
      const password = this.passwordInput?.value || '';
      const confirmPassword = this.confirmPwdInput?.value || '';
      const agreedTerms = this.termsCheckbox ? this.termsCheckbox.checked : true;

      // Validation
      if (!name || name.length < 2) {
        this.showAlert('Please enter your full name (at least 2 characters).', 'error');
        this.nameInput?.focus();
        return;
      }

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

      if (!password || password.length < 6) {
        this.showAlert('Password must be at least 6 characters in length.', 'error');
        this.passwordInput?.focus();
        return;
      }

      if (password !== confirmPassword) {
        this.showAlert('Passwords do not match. Please verify both password entries.', 'error');
        this.confirmPwdInput?.focus();
        return;
      }

      if (!agreedTerms) {
        this.showAlert('Please agree to campus IT guidelines and data policy.', 'error');
        this.termsCheckbox?.focus();
        return;
      }

      this.setSubmitting(true);

      const res = await authStore.signUpWithEmail(email, password, name);

      if (res.success) {
        this.showAlert('Account created successfully! Redirecting to CampusPulse...', 'success');
        setTimeout(() => this.redirectToApp(), 700);
      } else {
        this.setSubmitting(false);
        this.showAlert(res.error || 'Account creation failed. Please try again.', 'error');
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
        this.showAlert('Account verified via Google! Redirecting...', 'success');
        setTimeout(() => this.redirectToApp(), 600);
      } else {
        this.googleBtn.disabled = false;
        this.googleBtn.innerHTML = originalHtml;
        this.showAlert(res.error || 'Google registration was cancelled or failed.', 'error');
      }
    });
  }

  setSubmitting(isSubmitting) {
    if (!this.submitBtn) return;
    this.submitBtn.disabled = isSubmitting;
    if (this.googleBtn) this.googleBtn.disabled = isSubmitting;
    if (this.nameInput) this.nameInput.disabled = isSubmitting;
    if (this.emailInput) this.emailInput.disabled = isSubmitting;
    if (this.passwordInput) this.passwordInput.disabled = isSubmitting;
    if (this.confirmPwdInput) this.confirmPwdInput.disabled = isSubmitting;

    if (isSubmitting) {
      this.submitBtn.innerHTML = `
        <span class="spinner" aria-hidden="true"></span>
        <span>Creating account...</span>
      `;
    } else {
      this.submitBtn.innerHTML = `Create Account`;
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
  const controller = new SignupController();
  controller.init();
});