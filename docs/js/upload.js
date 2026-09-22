/**
 * Landing page: upload outline.csv + issue.json, then open the workspace.
 */

import {
  parseCsv,
  validateOutlineHeader,
  rowsToOutline,
  segmentToRid,
} from "./csv.js";
import { saveSession, clearSession } from "./session.js";

const form = document.getElementById("upload-form");
const csvInput = /** @type {HTMLInputElement} */ (
  document.getElementById("csv-file")
);
const issueInput = /** @type {HTMLInputElement} */ (
  document.getElementById("issue-file")
);
const errorEl = document.getElementById("upload-error");
const submitBtn = /** @type {HTMLButtonElement} */ (
  document.getElementById("upload-submit")
);

/**
 * Keep the custom file picker label and filename in sync with the input.
 * @param {HTMLInputElement} input
 * @param {HTMLElement | null} nameEl
 */
function bindFilePicker(input, nameEl) {
  const picker = input.closest(".file-picker");
  const btnText = picker?.querySelector(".file-btn-text");

  function sync() {
    const file = input.files?.[0];
    if (file && nameEl) {
      nameEl.textContent = file.name;
      picker?.classList.add("has-file");
      if (btnText) {
        btnText.textContent = "Replace file";
      }
      return;
    }
    if (nameEl) {
      nameEl.textContent = "No file chosen";
    }
    picker?.classList.remove("has-file");
    if (btnText) {
      btnText.textContent = "Choose file";
    }
  }

  input.addEventListener("change", sync);
  picker?.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest(".file-btn") || target === input) {
      return;
    }
    input.click();
  });
  sync();
}

bindFilePicker(csvInput, document.getElementById("csv-file-name"));
bindFilePicker(issueInput, document.getElementById("issue-file-name"));

/**
 * @param {string} message
 */
function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideError() {
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
function readText(file) {
  return file.text();
}

/**
 * Collect RIDs that appear as the issue segment (with bdr: prefix).
 * @param {object[]} issues
 * @returns {Set<string>}
 */
function issueRidsFromIssues(issues) {
  /** @type {Set<string>} */
  const rids = new Set();
  issues.forEach((issue) => {
    const id = issue?.issue?.id;
    if (id) {
      rids.add(segmentToRid(id));
    }
  });
  return rids;
}

/**
 * @param {string} text
 * @returns {object}
 */
function parseIssueJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("issue.json is not valid JSON.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("issue.json must be a JSON object.");
  }
  if (typeof data.w_id !== "string" || !data.w_id.trim()) {
    throw new Error('issue.json is missing a non-empty "w_id" field.');
  }
  if (!Array.isArray(data.issues)) {
    throw new Error('issue.json is missing an "issues" array.');
  }
  for (let i = 0; i < data.issues.length; i += 1) {
    const issue = data.issues[i];
    if (!issue?.issue?.id) {
      throw new Error(`issues[${i}] is missing issue.id.`);
    }
  }
  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();

  const csvFile = csvInput.files?.[0];
  const issueFile = issueInput.files?.[0];
  if (!csvFile) {
    showError("Please choose an outline.csv file.");
    return;
  }
  if (!issueFile) {
    showError("Please choose an issue.json file.");
    return;
  }

  submitBtn.disabled = true;
  try {
    const [csvText, issueText] = await Promise.all([
      readText(csvFile),
      readText(issueFile),
    ]);
    const issueData = parseIssueJson(issueText);
    const { header, rows } = parseCsv(csvText);
    validateOutlineHeader(header);

    const issues = issueData.issues;
    const issueRids = issueRidsFromIssues(issues);
    // Validate that we can build outline rows (also used as a sanity check)
    rowsToOutline(header, rows, issueRids);

    clearSession();
    saveSession({
      wId: issueData.w_id.trim(),
      fileName: csvFile.name || "outline.csv",
      header,
      rows,
      issues,
      errorTypes: Array.isArray(issueData.error_types)
        ? issueData.error_types
        : [],
    });
    window.location.href = "work.html";
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    submitBtn.disabled = false;
  }
});
