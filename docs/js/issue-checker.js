/**
 * Re-evaluate recorded outline issues against current outline values.
 *
 * Port of src/outline_fixer_ui/core/issue_checker.py
 */

import { segmentToRid, stripBdr } from "./csv.js";

const RANGE_DETAIL_RE =
  /^(?<a>\S+)\.start_page\s*\((?<a_start>\d+)\)\s*<\s*(?<b>\S+)\.end_page\s*\((?<b_end>\d+)\)\s*$/;
const MISSING_END_DETAIL_RE = /^segment\(s\)\s+(?<ids>.+)$/;

const SKIP_RANGE = "range";
const SKIP_MISSING_END = "missing_end_page";

const CHECK_RESOLVED = "resolved";
const CHECK_UNRESOLVED = "unresolved";
const CHECK_UNKNOWN = "unknown";

const CONTAINER_PART_TYPES = new Set(["S", "V"]);

/**
 * @typedef {object} SegmentState
 * @property {string} rid
 * @property {number|null} img_start
 * @property {number|null} img_end
 * @property {number|null} vol_start
 * @property {number|null} vol_end
 * @property {string|null} part_type
 */

/**
 * Re-check every issue against current segment states.
 * @param {object[]} issues
 * @param {Map<string, SegmentState>} states keyed by RID with bdr: prefix
 * @returns {{total: number, resolved_count: number, all_resolved: boolean, results: object[]}}
 */
export function checkWork(issues, states) {
  const results = issues.map((issue, index) => checkIssue(index, issue, states));
  const resolvedCount = results.filter((r) => r.resolved).length;
  return {
    total: results.length,
    resolved_count: resolvedCount,
    all_resolved: results.length > 0 && resolvedCount === results.length,
    results,
  };
}

/**
 * Build segment states from outline rows, then apply editor overrides.
 * @param {Array<{rid: string, img_start?: string|null, img_end?: string|null, vol_start?: string|null, vol_end?: string|null, part_type?: string|null}>} outlineRows
 * @param {Array<{rid: string, img_start: number|null, img_end: number|null, vol_start: number|null, vol_end: number|null, part_type: string|null}>} [overrides]
 * @returns {Map<string, SegmentState>}
 */
export function buildSegmentStates(outlineRows, overrides = []) {
  /** @type {Map<string, SegmentState>} */
  const states = new Map();
  outlineRows.forEach((row) => {
    const rid = segmentToRid(row.rid);
    states.set(rid, {
      rid,
      img_start: toInt(row.img_start),
      img_end: toInt(row.img_end),
      vol_start: toInt(row.vol_start),
      vol_end: toInt(row.vol_end),
      part_type: row.part_type || null,
    });
  });
  overrides.forEach((override) => {
    const rid = segmentToRid(override.rid);
    if (!states.has(rid)) {
      return;
    }
    states.set(rid, {
      rid,
      img_start: override.img_start,
      img_end: override.img_end,
      vol_start: override.vol_start,
      vol_end: override.vol_end,
      part_type: override.part_type,
    });
  });
  return states;
}

/**
 * @param {number} index
 * @param {object} issue
 * @param {Map<string, SegmentState>} states
 * @returns {object}
 */
function checkIssue(index, issue, states) {
  let status;
  let detail;
  if (issue.skip_reason === SKIP_RANGE) {
    [status, detail] = checkRange(issue, states);
  } else if (issue.skip_reason === SKIP_MISSING_END) {
    [status, detail] = checkMissingEnd(issue, states);
  } else {
    status = CHECK_UNKNOWN;
    detail = `No re-check rule for skip_reason=${JSON.stringify(issue.skip_reason)}`;
  }
  return {
    index,
    issue_id: issue.issue?.id || "",
    error_type: issue.error_type,
    status,
    resolved: status === CHECK_RESOLVED,
    detail,
  };
}

/**
 * @param {object} issue
 * @param {Map<string, SegmentState>} states
 * @returns {[string, string]}
 */
function checkRange(issue, states) {
  const [aId, bId] = rangeIds(issue);
  if (!aId || !bId) {
    return [CHECK_UNKNOWN, "Cannot identify the two segments to compare"];
  }
  const a = states.get(segmentToRid(aId));
  const b = states.get(segmentToRid(bId));
  if (!a || !b) {
    const missing = a ? bId : aId;
    return [CHECK_UNKNOWN, `${missing} not found in outline.csv`];
  }

  const container = containerNote(a, b);
  if (container) {
    return [CHECK_RESOLVED, container];
  }

  const aVol = volumeOf(a);
  const bVol = volumeOf(b);
  if (aVol != null && bVol != null && aVol !== bVol) {
    return [
      CHECK_RESOLVED,
      `${aId} (vol ${aVol}) and ${bId} (vol ${bVol}) are in different volumes`,
    ];
  }
  if (a.img_start == null) {
    return [CHECK_UNKNOWN, `${aId} has no img start`];
  }
  if (b.img_end == null) {
    return [CHECK_UNKNOWN, `${bId} has no img end`];
  }
  if (a.img_start < b.img_end) {
    return [
      CHECK_UNRESOLVED,
      `${aId}.start_page (${a.img_start}) < ${bId}.end_page (${b.img_end})`,
    ];
  }
  return [
    CHECK_RESOLVED,
    `${aId}.start_page (${a.img_start}) >= ${bId}.end_page (${b.img_end})`,
  ];
}

/**
 * @param {object} issue
 * @param {Map<string, SegmentState>} states
 * @returns {[string, string]}
 */
function checkMissingEnd(issue, states) {
  const ids = missingEndIds(issue);
  /** @type {string[]} */
  const stillMissing = [];
  /** @type {string[]} */
  const inverted = [];
  for (const segId of ids) {
    const state = states.get(segmentToRid(segId));
    if (!state) {
      return [CHECK_UNKNOWN, `${segId} not found in outline.csv`];
    }
    if (isContainer(state)) {
      continue;
    }
    if (state.img_end == null) {
      stillMissing.push(segId);
    } else if (state.img_start != null && state.img_end < state.img_start) {
      inverted.push(segId);
    }
  }
  if (stillMissing.length) {
    return [CHECK_UNRESOLVED, `Still missing img end: ${stillMissing.join(", ")}`];
  }
  if (inverted.length) {
    return [CHECK_UNRESOLVED, `img end < img start: ${inverted.join(", ")}`];
  }
  return [CHECK_RESOLVED, `End page set for ${ids.join(", ")}`];
}

/**
 * @param {object} issue
 * @returns {[string, string]}
 */
function rangeIds(issue) {
  const match = RANGE_DETAIL_RE.exec((issue.skip_detail || "").trim());
  if (match && match.groups) {
    return [match.groups.a, match.groups.b];
  }
  const leftId = issue.left?.id || "";
  return [issue.issue?.id || "", leftId];
}

/**
 * @param {object} issue
 * @returns {string[]}
 */
function missingEndIds(issue) {
  const match = MISSING_END_DETAIL_RE.exec((issue.skip_detail || "").trim());
  if (match && match.groups) {
    return match.groups.ids
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return issue.issue?.id ? [issue.issue.id] : [];
}

/**
 * @param {SegmentState} a
 * @param {SegmentState} b
 * @returns {string}
 */
function containerNote(a, b) {
  for (const state of [a, b]) {
    if (isContainer(state)) {
      return `${stripBdr(state.rid)} is now a container type (${state.part_type})`;
    }
  }
  return "";
}

/**
 * @param {SegmentState} state
 * @returns {boolean}
 */
function isContainer(state) {
  return CONTAINER_PART_TYPES.has((state.part_type || "").toUpperCase());
}

/**
 * @param {SegmentState} state
 * @returns {number|null}
 */
function volumeOf(state) {
  return state.vol_start != null ? state.vol_start : state.vol_end;
}

/**
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
function toInt(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}
