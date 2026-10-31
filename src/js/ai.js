/**
 * CampusPulse AI Client Controller
 * Manages unstructured announcement ingestion and weekly summaries via Gemini.
 * Strictly avoids fake data generation and accurately reflects backend configuration states.
 */

import { api } from './api.js';

/**
 * Validates and submits raw campus announcement text for structured extraction.
 *
 * @param {string} rawText
 * @returns {Promise<{
 *   success: boolean,
 *   data?: {
 *     title: string,
 *     startDate: string,
 *     endDate?: string,
 *     startTime?: string,
 *     endTime?: string,
 *     venue: string,
 *     category: string,
 *     description: string,
 *     tags?: string[],
 *     urgencyNote?: string
 *   },
 *   error?: string,
 *   isConfigMissing?: boolean
 * }>}
 */
export async function extractEventFromAnnouncement(rawText) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return {
      success: false,
      error: 'Please enter or paste an announcement text before extracting.'
    };
  }

  if (rawText.trim().length < 15) {
    return {
      success: false,
      error: 'Announcement text is too short. Please provide meaningful event details.'
    };
  }

  const response = await api.extractAnnouncement(rawText);

  if (!response.success) {
    if (response.isConfigMissing) {
      return {
        success: false,
        isConfigMissing: true,
        error: 'Backend Gemini API is not configured yet. Set GEMINI_API_KEY in your environment to enable AI extraction.'
      };
    }

    return {
      success: false,
      error: response.error || 'Failed to extract structured event from announcement.'
    };
  }

  // Ensure rawSource is explicitly carried through with the extracted event payload
  const extractedData = {
    ...response.data,
    rawSource: response.data?.rawSource || rawText.trim()
  };

  return {
    success: true,
    data: extractedData
  };
}

/**
 * Requests an AI-generated weekly executive summary of upcoming campus activities.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   data?: {
 *     title: string,
 *     summaryText: string,
 *     highlights: string[],
 *     generatedAt: string
 *   },
 *   error?: string,
 *   isConfigMissing?: boolean
 * }>}
 */
export async function generateWeeklySummary() {
  const response = await api.getWeeklySummary();

  if (!response.success) {
    if (response.isConfigMissing) {
      return {
        success: false,
        isConfigMissing: true,
        error: 'Backend Gemini API is not configured yet. Set GEMINI_API_KEY in your environment to enable weekly summaries.'
      };
    }

    return {
      success: false,
      error: response.error || 'Failed to generate weekly summary.'
    };
  }

  return {
    success: true,
    data: response.data
  };
}

