/**
 * CampusPulse Announcement Input Form Component
 * Manages raw notice input, clipboard paste, clearing, and AI extraction triggers.
 */

import { extractEventFromAnnouncement } from '../js/ai.js';
import { toast } from './toast.js';

export class AnnouncementFormController {
  /**
   * @param {import('./event-modal.js').ModalController} modalController
   */
  constructor(modalController) {
    this.modalController = modalController;
    this.textarea = document.getElementById('announcement-raw-text');
    this.pasteBtn = document.getElementById('btn-paste-announcement');
    this.clearBtn = document.getElementById('btn-clear-announcement');
    this.extractBtn = document.getElementById('btn-extract-ai');
    this.statusContainer = document.getElementById('ai-extraction-status');
  }

  init() {
    this.bindEvents();
  }

  bindEvents() {
    // Paste from clipboard
    if (this.pasteBtn && this.textarea) {
      this.pasteBtn.addEventListener('click', async () => {
        try {
          if (!navigator.clipboard?.readText) {
            toast.info('Clipboard access is restricted. Please paste using Ctrl+V / Cmd+V.');
            this.textarea.focus();
            return;
          }
          const text = await navigator.clipboard.readText();
          if (text) {
            this.textarea.value = text;
            toast.info('Text pasted from clipboard.');
            this.textarea.focus();
          } else {
            toast.warning('Clipboard appears to be empty.');
          }
        } catch {
          toast.info('Please paste announcement directly using Ctrl+V / Cmd+V.');
          this.textarea.focus();
        }
      });
    }

    // Clear textarea
    if (this.clearBtn && this.textarea) {
      this.clearBtn.addEventListener('click', () => {
        this.textarea.value = '';
        this.textarea.focus();
        if (this.statusContainer) this.statusContainer.innerHTML = '';
      });
    }

    // AI extraction trigger
    if (this.extractBtn && this.textarea) {
      this.extractBtn.addEventListener('click', async () => {
        await this.handleExtract();
      });
    }
  }

  async handleExtract() {
    const rawText = this.textarea ? this.textarea.value.trim() : '';

    if (!rawText) {
      toast.warning('Please enter or paste an announcement first.');
      if (this.textarea) this.textarea.focus();
      return;
    }

    this.setLoadingState(true);

    try {
      const result = await extractEventFromAnnouncement(rawText);

      this.setLoadingState(false);

      if (!result.success) {
        if (result.isConfigMissing) {
          toast.warning(result.error, 8000);
          if (this.statusContainer) {
            this.statusContainer.innerHTML = `
              <div class="alert alert-warning" role="alert">
                <strong>Backend Configuration Notice:</strong>
                ${result.error}
              </div>
            `;
          }
        } else {
          toast.error(result.error);
        }
        return;
      }

      // Successful extraction: display the review modal
      toast.success('Event details successfully extracted by AI! Please review and confirm.');
      this.modalController.showExtractionReview(result.data, rawText);
    } catch (err) {
      this.setLoadingState(false);
      toast.error(err.message || 'An unexpected error occurred during AI extraction.');
    }
  }

  setLoadingState(isLoading) {
    if (!this.extractBtn) return;

    this.extractBtn.disabled = isLoading;
    if (this.pasteBtn) this.pasteBtn.disabled = isLoading;
    if (this.clearBtn) this.clearBtn.disabled = isLoading;

    if (isLoading) {
      this.extractBtn.innerHTML = `
        <span class="spinner" aria-hidden="true"></span>
        <span>Extracting with Gemini AI...</span>
      `;
      if (this.statusContainer) {
        this.statusContainer.innerHTML = `
          <div class="loading-indicator" role="status" aria-live="polite">
            <span class="spinner" aria-hidden="true"></span>
            <span>Parsing campus announcement through Google Gemini AI...</span>
          </div>
        `;
      }
    } else {
      this.extractBtn.innerHTML = `
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
        </svg>
        <span>Extract with AI</span>
      `;
      if (this.statusContainer) {
        this.statusContainer.innerHTML = '';
      }
    }
  }
}

