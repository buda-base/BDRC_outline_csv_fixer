/**
 * sessionStorage handoff between the upload page and the workspace.
 */

export const SESSION_KEY = "bdrcOutlineFixerSession";

/**
 * @typedef {object} OutlineSession
 * @property {string} wId
 * @property {string} fileName
 * @property {string[]} header
 * @property {string[][]} rows
 * @property {object[]} issues
 * @property {string[]} [errorTypes]
 */

/**
 * Persist a parsed upload session.
 * @param {OutlineSession} session
 */
export function saveSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Load the current session, or null if missing/invalid.
 * @returns {OutlineSession|null}
 */
export function loadSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const data = JSON.parse(raw);
    if (
      !data ||
      typeof data.wId !== "string" ||
      !Array.isArray(data.header) ||
      !Array.isArray(data.rows) ||
      !Array.isArray(data.issues)
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Clear the upload session (e.g. when starting over).
 */
export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
