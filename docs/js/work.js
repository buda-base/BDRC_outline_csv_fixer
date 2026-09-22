/**
 * Page 2: three-panel issue workspace for one uploaded work.
 *
 * Left panel lists issue segments with live re-check badges.
 * Right panel lists every outline.csv segment (file order) with editable
 * span and part-type fields. Export downloads the updated CSV.
 */

import {
  RID_COL,
  applySpanToCells,
  columnIndexMap,
  downloadCsv,
  rowsToOutline,
  segmentToRid,
  serializeCsv,
  stripBdr,
} from "./csv.js";
import { buildSegmentStates, checkWork } from "./issue-checker.js";
import { clearSession, loadSession, saveSession } from "./session.js";

const session = loadSession();
if (!session) {
  window.location.href = "index.html";
} else {
  boot(session);
}

/**
 * @param {import("./session.js").OutlineSession} initial
 */
function boot(initial) {
  "use strict";

  let sessionData = initial;
  const wId = sessionData.wId;

  const workTitle = document.getElementById("work-title");
  const checkSignal = document.getElementById("check-signal");
  const issueList = document.getElementById("issue-list");
  const issueCount = document.getElementById("issue-count");
  const spanEditor = document.getElementById("span-editor");
  const spanCount = document.getElementById("span-count");
  const bdrcFrame = document.getElementById("bdrc-frame");
  const bdrcOpen = document.getElementById("bdrc-open");
  const exportBtn = document.getElementById("export-btn");
  const prevBtn = document.getElementById("prev-issue");
  const nextBtn = document.getElementById("next-issue");
  const backLink = document.getElementById("back-link");
  const errorEl = document.getElementById("workspace-error");
  const statusEl = document.getElementById("workspace-status");

  /** @type {Array<any>} */
  let issues = sessionData.issues || [];
  /** @type {Map<string, number>} */
  let issueIndexByRid = new Map();
  /** @type {Map<string, any>} segment id (no bdr:) -> outline row */
  let rowByRid = new Map();
  /** @type {Array<any>} */
  let outlineRows = [];
  /** @type {string[]} */
  let header = sessionData.header;
  /** @type {Record<string, number>} */
  let col = columnIndexMap(header);
  /** @type {number} */
  let selectedIndex = -1;
  /** @type {Set<string>} */
  const dirty = new Set();
  /** @type {any|null} */
  let lastCheck = null;
  /** @type {number} */
  let checkTimer = 0;

  const CHECK_DEBOUNCE_MS = 400;

  /** @type {Array<[string, string]>} */
  const CONTEXT_ROLES = [
    ["Left 2", "left_2"],
    ["Left", "left"],
    ["Issue", "issue"],
    ["Right", "right"],
    ["Right 2", "right_2"],
  ];

  const PART_TYPES = [
    { code: "T", label: "Text" },
    { code: "C", label: "Chapter" },
    { code: "E", label: "Editorial / TOC" },
    { code: "S", label: "Section" },
    { code: "V", label: "Volume" },
  ];

  const SPAN_FIELDS = ["img_start", "img_end", "vol_start", "vol_end"];

  workTitle.textContent = wId;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * @param {string} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  /**
   * @param {string} message
   */
  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }

  /**
   * @param {string} message
   */
  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.classList.remove("hidden");
    window.setTimeout(() => statusEl.classList.add("hidden"), 4000);
  }

  /**
   * @param {string} segmentId
   */
  function loadBdrcSegment(segmentId) {
    const url = `https://library.bdrc.io/show/bdr:${stripBdr(segmentId)}`;
    if (bdrcFrame.src !== url) {
      bdrcFrame.src = url;
    }
    bdrcOpen.href = url;
  }

  /**
   * @param {any} value
   * @returns {string}
   */
  function displayVal(value) {
    return value == null || value === "" ? "" : String(value);
  }

  /**
   * Rebuild outline row objects from the session table.
   */
  function rebuildOutlineFromSession() {
    const issueRids = new Set(
      issues
        .map((issue) => (issue.issue?.id ? segmentToRid(issue.issue.id) : ""))
        .filter(Boolean)
    );
    outlineRows = rowsToOutline(header, sessionData.rows, issueRids);
    rowByRid = new Map(outlineRows.map((row) => [stripBdr(row.rid), row]));
    col = columnIndexMap(header);
  }

  // ---------------------------------------------------------------------
  // Left panel
  // ---------------------------------------------------------------------

  function renderIssueList() {
    issueList.replaceChildren();
    issueCount.textContent = `${issues.length} issue(s)`;
    const frag = document.createDocumentFragment();
    issues.forEach((issue, index) => {
      const seg = issue.issue || {};
      const segId = stripBdr(seg.id);
      const card = document.createElement("div");
      card.className = "issue-card" + (index === selectedIndex ? " active" : "");
      card.dataset.index = String(index);
      card.dataset.segId = segId;

      const vol =
        issue.volume_number != null ? `Vol ${issue.volume_number}` : "";
      const result = checkResultFor(index);
      const detail = result ? result.detail : issue.skip_detail || "";

      card.innerHTML = `
        <div class="seg-id">${escapeHtml(segId)}</div>
        <div class="title">${escapeHtml(seg.title || "(no title)")}</div>
        <div class="meta">
          <span class="badge warn">${escapeHtml(issue.error_type || "unknown")}</span>
          ${vol ? `<span class="badge">${escapeHtml(vol)}</span>` : ""}
          ${checkBadgeHtml(result)}
        </div>
        ${detail ? `<div class="detail ${detailClass(result)}">${escapeHtml(detail)}</div>` : ""}
      `;
      card.addEventListener("click", () => selectIssue(index));
      frag.appendChild(card);
    });
    issueList.appendChild(frag);
  }

  /**
   * @param {number} index
   * @returns {any|null}
   */
  function checkResultFor(index) {
    if (!lastCheck) {
      return null;
    }
    return lastCheck.results.find((r) => r.index === index) || null;
  }

  /**
   * @param {any|null} result
   * @returns {string}
   */
  function checkBadgeHtml(result) {
    if (!result) {
      return '<span class="badge check-pending">Not checked</span>';
    }
    if (result.status === "resolved") {
      return '<span class="badge check-ok">✔ Resolved</span>';
    }
    if (result.status === "unresolved") {
      return '<span class="badge check-bad">✖ Still failing</span>';
    }
    return '<span class="badge check-unknown">? Unverifiable</span>';
  }

  /**
   * @param {any|null} result
   * @returns {string}
   */
  function detailClass(result) {
    if (!result) {
      return "";
    }
    return result.status === "resolved" ? "detail-ok" : "";
  }

  // ---------------------------------------------------------------------
  // Right panel (CSV order)
  // ---------------------------------------------------------------------

  /**
   * @returns {Array<{id: string, row: any}>}
   */
  function orderedSegments() {
    return outlineRows.map((row) => ({
      id: stripBdr(row.rid),
      row,
    }));
  }

  function renderRightPanel() {
    const segments = orderedSegments();
    spanCount.textContent = `${segments.length} segment(s)`;
    if (!segments.length) {
      spanEditor.innerHTML = '<p class="muted">No segment data.</p>';
      return;
    }
    spanEditor.innerHTML = segments.map(segmentCardHtml).join("");
    applyRoles();
  }

  /**
   * @param {{id: string, row: any}} seg
   * @returns {string}
   */
  function segmentCardHtml(seg) {
    const { id, row } = seg;
    const title = row.titles || row.label || "(no title)";
    const issueIdx = issueIndexByRid.get(id);
    const classes = ["context-card", "seg-card"];
    if (issueIdx !== undefined) {
      classes.push("issue");
    }
    const issueBadge =
      issueIdx !== undefined
        ? `<span class="badge warn">${escapeHtml(issues[issueIdx].error_type || "issue")}</span>`
        : "";

    return `
      <div class="${classes.join(" ")}" data-seg-id="${escapeHtml(id)}">
        <div class="card-head">
          <span class="role">Segment</span>
          <span class="dirty-marker hidden" title="Unexported changes">● modified</span>
        </div>
        <div class="seg-id">${escapeHtml(id)}</div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="meta">${issueBadge}</div>
        ${fieldGridHtml(row)}
        <div class="check-note hidden"></div>
      </div>
    `;
  }

  /**
   * @param {any} row
   * @returns {string}
   */
  function fieldGridHtml(row) {
    return `
      <div class="field-grid">
        <div class="field">
          <label>Img start</label>
          <input type="number" min="0" data-field="img_start" value="${escapeHtml(displayVal(row.img_start))}" />
        </div>
        <div class="field">
          <label>Img end</label>
          <input type="number" min="0" data-field="img_end" value="${escapeHtml(displayVal(row.img_end))}" />
        </div>
        <div class="field">
          <label>Vol start</label>
          <input type="number" min="0" data-field="vol_start" value="${escapeHtml(displayVal(row.vol_start))}" />
        </div>
        <div class="field">
          <label>Vol end</label>
          <input type="number" min="0" data-field="vol_end" value="${escapeHtml(displayVal(row.vol_end))}" />
        </div>
        ${typeSelectHtml(row.part_type || "")}
      </div>
    `;
  }

  /**
   * @param {string} currentCode
   * @returns {string}
   */
  function typeSelectHtml(currentCode) {
    const options = PART_TYPES.map(
      (pt) =>
        `<option value="${pt.code}"${pt.code === currentCode ? " selected" : ""}>${pt.code} — ${pt.label}</option>`
    ).join("");
    const blank = `<option value=""${currentCode ? "" : " selected"}>— unset —</option>`;
    return `
      <div class="field type-field">
        <label>Part type</label>
        <select data-field="part_type">${blank}${options}</select>
      </div>
    `;
  }

  function applyRoles() {
    /** @type {Map<string, string>} */
    const roleById = new Map();
    const issue = selectedIndex >= 0 ? issues[selectedIndex] : null;
    if (issue) {
      CONTEXT_ROLES.forEach(([label, key]) => {
        const seg = issue[key];
        if (seg?.id) {
          roleById.set(stripBdr(seg.id), label);
        }
      });
    }
    spanEditor.querySelectorAll(".seg-card").forEach((card) => {
      const segId = card.getAttribute("data-seg-id") || "";
      const role = roleById.get(segId);
      const roleEl = card.querySelector(".role");
      if (roleEl) {
        roleEl.textContent = role || "Segment";
      }
      card.classList.toggle("context", Boolean(role) && role !== "Issue");
      card.classList.toggle("active-context", role === "Issue");
    });
    updateCheckNotes();
  }

  function updateCheckNotes() {
    spanEditor.querySelectorAll(".seg-card.issue").forEach((card) => {
      const segId = card.getAttribute("data-seg-id") || "";
      const idx = issueIndexByRid.get(segId);
      const note = card.querySelector(".check-note");
      if (!note || idx === undefined) {
        return;
      }
      const result = checkResultFor(idx);
      if (!result) {
        note.classList.add("hidden");
        return;
      }
      note.textContent = `${result.status === "resolved" ? "✔" : result.status === "unresolved" ? "✖" : "?"} ${result.detail}`;
      note.className = `check-note check-${result.status}`;
    });
  }

  /**
   * @param {string} segId
   */
  function scrollRightPanelTo(segId) {
    const card = cardFor(segId);
    if (card) {
      card.scrollIntoView({ block: "center" });
    }
  }

  /**
   * @param {string} segId
   * @returns {HTMLElement|null}
   */
  function cardFor(segId) {
    return spanEditor.querySelector(
      `.seg-card[data-seg-id="${CSS.escape(stripBdr(segId))}"]`
    );
  }

  // ---------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------

  /**
   * @param {number} index
   */
  function selectIssue(index) {
    if (index < 0 || index >= issues.length) {
      return;
    }
    selectedIndex = index;
    const segId = stripBdr(issues[index].issue?.id);
    issueList.querySelectorAll(".issue-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.index === String(index));
    });
    const active = issueList.querySelector(".issue-card.active");
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
    applyRoles();
    scrollRightPanelTo(segId);
    loadBdrcSegment(segId);
    updateNavButtons();
  }

  function updateNavButtons() {
    prevBtn.disabled = selectedIndex <= 0;
    nextBtn.disabled = selectedIndex < 0 || selectedIndex >= issues.length - 1;
  }

  /**
   * @param {HTMLElement} card
   */
  function onCardClick(card) {
    const segId = card.getAttribute("data-seg-id") || "";
    if (!segId) {
      return;
    }
    const idx = issueIndexByRid.get(segId);
    if (idx !== undefined && idx !== selectedIndex) {
      selectIssue(idx);
      return;
    }
    loadBdrcSegment(segId);
  }

  // ---------------------------------------------------------------------
  // Editing / dirty tracking
  // ---------------------------------------------------------------------

  /**
   * @param {HTMLElement} card
   * @returns {{rid: string, img_start: number|null, img_end: number|null, vol_start: number|null, vol_end: number|null, part_type: string|null}}
   */
  function readCard(card) {
    const rid = card.getAttribute("data-seg-id") || "";
    /** @type {any} */
    const out = { rid, part_type: null };
    SPAN_FIELDS.forEach((name) => {
      const input = /** @type {HTMLInputElement|null} */ (
        card.querySelector(`[data-field="${name}"]`)
      );
      const raw = input ? input.value.trim() : "";
      out[name] = raw === "" ? null : Number(raw);
    });
    const select = /** @type {HTMLSelectElement|null} */ (
      card.querySelector('[data-field="part_type"]')
    );
    out.part_type = select && select.value ? select.value : null;
    return out;
  }

  /**
   * @param {HTMLElement} card
   * @returns {boolean}
   */
  function cardIsDirty(card) {
    const segId = card.getAttribute("data-seg-id") || "";
    const row = rowByRid.get(segId);
    if (!row) {
      return false;
    }
    const values = readCard(card);
    const differs = SPAN_FIELDS.some(
      (name) => displayVal(values[name]) !== displayVal(row[name])
    );
    return differs || (values.part_type || "") !== (row.part_type || "");
  }

  /**
   * @param {HTMLElement} card
   */
  function refreshDirty(card) {
    const segId = card.getAttribute("data-seg-id") || "";
    const isDirty = cardIsDirty(card);
    if (isDirty) {
      dirty.add(segId);
    } else {
      dirty.delete(segId);
    }
    card.classList.toggle("dirty", isDirty);
    const marker = card.querySelector(".dirty-marker");
    if (marker) {
      marker.classList.toggle("hidden", !isDirty);
    }
  }

  /**
   * Collect current editor values for every card (dirty or not) as overrides
   * for the checker, so the check always reflects what is on screen.
   * @returns {Array<any>}
   */
  function collectCurrentOverrides() {
    /** @type {Array<any>} */
    const out = [];
    spanEditor.querySelectorAll(".seg-card").forEach((card) => {
      out.push(readCard(/** @type {HTMLElement} */ (card)));
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------

  /**
   * Apply all current card values to the in-memory table, download CSV,
   * and treat those values as the new baseline.
   */
  function exportCsv() {
    errorEl.classList.add("hidden");
    try {
      const nextRows = sessionData.rows.map((cells) => [...cells]);
      spanEditor.querySelectorAll(".seg-card").forEach((cardEl) => {
        const card = /** @type {HTMLElement} */ (cardEl);
        const values = readCard(card);
        const rid = segmentToRid(values.rid);
        const ridIndex = col[RID_COL];
        const rowIndex = nextRows.findIndex(
          (cells) =>
            ridIndex != null &&
            segmentToRid(cells[ridIndex] || "") === rid
        );
        if (rowIndex < 0) {
          return;
        }
        applySpanToCells(nextRows[rowIndex], col, values);
      });

      const csvText = serializeCsv(header, nextRows);
      const downloadName = `${wId}_outline.csv`;
      downloadCsv(downloadName, csvText);

      sessionData = {
        ...sessionData,
        rows: nextRows,
      };
      saveSession(sessionData);
      rebuildOutlineFromSession();
      dirty.clear();
      spanEditor.querySelectorAll(".seg-card").forEach((cardEl) => {
        const card = /** @type {HTMLElement} */ (cardEl);
        card.classList.remove("dirty");
        const marker = card.querySelector(".dirty-marker");
        if (marker) {
          marker.classList.add("hidden");
        }
      });
      showStatus(`Downloaded ${downloadName}`);
      runCheck();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  // ---------------------------------------------------------------------
  // Issue re-check (in-browser)
  // ---------------------------------------------------------------------

  function scheduleCheck() {
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(() => {
      runCheck();
    }, CHECK_DEBOUNCE_MS);
  }

  function runCheck() {
    if (!issues.length) {
      setSignal("check-idle", "No issues to check");
      return;
    }
    setSignal("check-running", "Checking…");
    try {
      // Merge baseline rows with live card values (overrides win).
      const states = buildSegmentStates(outlineRows, collectCurrentOverrides());
      const result = checkWork(issues, states);
      lastCheck = result;
      renderIssueList();
      updateCheckNotes();
      renderSignal(result);
    } catch (err) {
      setSignal(
        "check-bad",
        `Check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * @param {string} cls
   * @param {string} text
   */
  function setSignal(cls, text) {
    checkSignal.className = `check-signal ${cls}`;
    checkSignal.textContent = text;
  }

  /**
   * @param {any} result
   */
  function renderSignal(result) {
    const unknown = result.results.filter((r) => r.status === "unknown").length;
    if (result.all_resolved) {
      setSignal("check-ok", `✔ All ${result.total} issue(s) resolved`);
      return;
    }
    const extra = unknown ? `, ${unknown} unverifiable` : "";
    setSignal(
      "check-bad",
      `✖ ${result.resolved_count}/${result.total} resolved${extra}`
    );
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  spanEditor.addEventListener("input", (event) => {
    const card = /** @type {HTMLElement|null} */ (
      event.target instanceof Element ? event.target.closest(".seg-card") : null
    );
    if (!card) {
      return;
    }
    refreshDirty(card);
    scheduleCheck();
  });

  spanEditor.addEventListener("click", (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLOptionElement
    ) {
      return;
    }
    const card = /** @type {HTMLElement|null} */ (
      event.target instanceof Element ? event.target.closest(".seg-card") : null
    );
    if (card) {
      onCardClick(card);
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (dirty.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  prevBtn.addEventListener("click", () => selectIssue(selectedIndex - 1));
  nextBtn.addEventListener("click", () => selectIssue(selectedIndex + 1));
  exportBtn.addEventListener("click", exportCsv);

  backLink.addEventListener("click", (event) => {
    if (dirty.size) {
      const ok = window.confirm(
        "You have unexported changes. Leave and discard them?"
      );
      if (!ok) {
        event.preventDefault();
        return;
      }
    }
    clearSession();
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  try {
    issueIndexByRid = new Map(
      issues.map((issue, index) => [stripBdr(issue.issue?.id), index])
    );
    rebuildOutlineFromSession();
    renderIssueList();
    renderRightPanel();
    if (issues.length > 0) {
      selectIssue(0);
    } else {
      issueList.innerHTML = '<p class="muted">No issues recorded.</p>';
    }
    runCheck();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}
