/**
 * Parse and serialize outline.csv while preserving duplicate columns
 * (e.g. five Position columns) and original field order.
 */

export const RID_COL = "RID";
export const PART_TYPE_COL = "part type";
export const LABEL_COL = "label";
export const TITLES_COL = "titles";
export const WORK_COL = "work";
export const IMG_START = "img start";
export const IMG_END = "img end";
export const VOL_START = "vol start";
export const VOL_END = "vol end";

const REQUIRED_COLUMNS = [RID_COL, PART_TYPE_COL, IMG_START, IMG_END];

/**
 * Strip BOM and surrounding quotes from a CSV header name.
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function cleanFieldName(name) {
  if (name == null) {
    return "";
  }
  let cleaned = String(name).replace(/^\ufeff/, "").trim();
  if (cleaned.length >= 2 && cleaned[0] === '"' && cleaned[cleaned.length - 1] === '"') {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned;
}

/**
 * Map first occurrence of each column name to its index.
 * @param {string[]} header
 * @returns {Record<string, number>}
 */
export function columnIndexMap(header) {
  /** @type {Record<string, number>} */
  const mapping = {};
  header.forEach((name, index) => {
    if (!(name in mapping)) {
      mapping[name] = index;
    }
  });
  return mapping;
}

/**
 * @param {string[]} cells
 * @param {Record<string, number>} col
 * @param {string} name
 * @returns {string}
 */
export function cell(cells, col, name) {
  const index = col[name];
  if (index == null || index >= cells.length) {
    return "";
  }
  return (cells[index] || "").trim();
}

/**
 * Parse a CSV string into header + data rows (RFC 4180-ish, quoted fields).
 * @param {string} text
 * @returns {{header: string[], rows: string[][]}}
 */
export function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) {
    throw new Error("CSV is empty.");
  }
  const header = rows[0].map(cleanFieldName);
  const dataRows = rows.slice(1).map((row) => {
    const cells = [...row];
    while (cells.length < header.length) {
      cells.push("");
    }
    return cells;
  });
  return { header, rows: dataRows };
}

/**
 * Validate that required outline columns exist.
 * @param {string[]} header
 */
export function validateOutlineHeader(header) {
  const col = columnIndexMap(header);
  const missing = REQUIRED_COLUMNS.filter((name) => !(name in col));
  if (missing.length) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  }
}

/**
 * Convert a raw CSV table into outline row objects for the UI.
 * @param {string[]} header
 * @param {string[][]} rows
 * @param {Set<string>} issueRids RIDs with bdr: prefix that appear in issues
 * @returns {Array<object>}
 */
export function rowsToOutline(header, rows, issueRids) {
  const col = columnIndexMap(header);
  return rows.map((cells) => {
    const rid = cell(cells, col, RID_COL);
    return {
      rid,
      part_type: cell(cells, col, PART_TYPE_COL) || null,
      label: cell(cells, col, LABEL_COL) || null,
      titles: cell(cells, col, TITLES_COL) || null,
      work: cell(cells, col, WORK_COL) || null,
      img_start: cell(cells, col, IMG_START) || null,
      img_end: cell(cells, col, IMG_END) || null,
      vol_start: cell(cells, col, VOL_START) || null,
      vol_end: cell(cells, col, VOL_END) || null,
      is_issue: issueRids.has(rid),
      cells: [...cells],
    };
  });
}

/**
 * Apply one segment's edited values onto its cells array.
 * @param {string[]} cells
 * @param {Record<string, number>} col
 * @param {{img_start: number|null, img_end: number|null, vol_start: number|null, vol_end: number|null, part_type: string|null}} values
 */
export function applySpanToCells(cells, col, values) {
  setIntCell(cells, col, IMG_START, values.img_start);
  setIntCell(cells, col, IMG_END, values.img_end);
  setIntCell(cells, col, VOL_START, values.vol_start);
  setIntCell(cells, col, VOL_END, values.vol_end);
  setTextCell(cells, col, PART_TYPE_COL, values.part_type);
}

/**
 * Serialize header + rows to a CSV string.
 * @param {string[]} header
 * @param {string[][]} rows
 * @returns {string}
 */
export function serializeCsv(header, rows) {
  const lines = [header, ...rows].map((row) =>
    row.map(escapeCsvField).join(",")
  );
  return `${lines.join("\n")}\n`;
}

/**
 * Trigger a browser download of a CSV string.
 * @param {string} filename
 * @param {string} csvText
 */
export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param {string|null|undefined} segmentId
 * @returns {string}
 */
export function segmentToRid(segmentId) {
  const stripped = String(segmentId || "").trim();
  if (!stripped) {
    return "";
  }
  return stripped.startsWith("bdr:") ? stripped : `bdr:${stripped}`;
}

/**
 * @param {string|null|undefined} rid
 * @returns {string}
 */
export function stripBdr(rid) {
  return String(rid || "").replace(/^bdr:/, "");
}

/**
 * @param {string[]} cells
 * @param {Record<string, number>} col
 * @param {string} name
 * @param {number|null} value
 */
function setIntCell(cells, col, name, value) {
  if (value == null) {
    const index = col[name];
    if (index != null) {
      while (cells.length <= index) {
        cells.push("");
      }
      cells[index] = "";
    }
    return;
  }
  const index = col[name];
  if (index == null) {
    return;
  }
  while (cells.length <= index) {
    cells.push("");
  }
  cells[index] = String(value);
}

/**
 * @param {string[]} cells
 * @param {Record<string, number>} col
 * @param {string} name
 * @param {string|null} value
 */
function setTextCell(cells, col, name, value) {
  if (value == null) {
    const index = col[name];
    if (index != null) {
      while (cells.length <= index) {
        cells.push("");
      }
      cells[index] = "";
    }
    return;
  }
  const index = col[name];
  if (index == null) {
    return;
  }
  while (cells.length <= index) {
    cells.push("");
  }
  cells[index] = value;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeCsvField(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/**
 * Low-level CSV row parser supporting quoted fields and newlines in quotes.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsvRows(text) {
  const input = text.replace(/^\ufeff/, "");
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Trailing field / row (if file does not end with newline)
  if (field.length || row.length || inQuotes) {
    row.push(field);
    rows.push(row);
  }

  // Drop a trailing empty row produced by a final newline
  if (
    rows.length &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ""
  ) {
    rows.pop();
  }

  return rows;
}
