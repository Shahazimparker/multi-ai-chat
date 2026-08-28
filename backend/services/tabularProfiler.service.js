// ============================================================
// FILE: backend/services/tabularProfiler.service.js
// PURPOSE: Turn tabular/log uploads (xlsx, csv, .log, docx tables) into a
//          numeric diagnostic profile the model can reason over.
//
// The existing digest in toolProcessor.service.js finds *error-shaped* lines by
// keyword. That misses the most common finding in a SQL trace: a row reading
// `SELECT ... | 4821 | 39201` contains no error word at all. Slowness and bad
// access patterns are numeric properties, so they need counting and sorting
// rather than regex matching — which is what this module adds.
// ============================================================

// Work caps. A trace export can carry hundreds of thousands of rows and this
// runs inside a request, so every pass is bounded.
const MAX_ROWS_SCANNED = 300000;
const MAX_PROFILE_CHARS = 14000;
const TOP_N = 10;
const SAMPLE_ROWS_FOR_SHAPE = 60;

const DELIMITERS = [',', '\t', ';', '|'];

const SQL_START = /^\s*\(?\s*(select|insert|update|delete|merge|with|upsert|call|exec|execute|create|alter|drop|truncate|fetch|open)\b/i;

// Header vocabulary. Trace exports are localised — an ST05 export from a German
// system says "Dauer", a Spanish one says "Duracion" — and a column missed here
// silently falls through to the numeric-spread guess below, which can pick the
// wrong column entirely. Accents are stripped before matching (see normalizeHeader),
// so the unaccented spelling is what appears in these patterns.
const HEADER_HINTS = {
  duration: new RegExp(
    '\\b(' + [
      // English
      'dur(ation)?', 'elapsed', 'latency', 'exec(ution)?[ _-]?time', 'runtime',
      'response[ _-]?time', 'wait', 'waittime', 'time[ _-]?(ms|sec|s)', 'ms', 'msec',
      'millis', 'seconds?', 'secs?', 'cost', 'total[ _-]?time', 'db[ _-]?time', 'cpu',
      // German (SAP exports are commonly German)
      'dauer', 'laufzeit', 'zeit', 'antwortzeit', 'wartezeit', 'ausfuhrungszeit',
      // Spanish / Portuguese
      'duracion', 'duracao', 'tiempo', 'tempo', 'latencia',
      // French
      'duree', 'temps',
      // Italian / Dutch
      'durata', 'duur', 'tijd',
    ].join('|') + ')\\b',
    'i'
  ),
  count: new RegExp(
    '\\b(' + [
      'count', 'calls', 'executions', 'execs', 'invocations', 'rows?', 'records?',
      'reads?', 'fetch(es)?', 'buffer[ _-]?gets', 'gets', 'hits',
      'anzahl', 'aufrufe', 'saetze', 'datensaetze', 'zeilen',
      'cantidad', 'llamadas', 'filas', 'registros',
      'nombre', 'appels', 'lignes',
    ].join('|') + ')\\b',
    'i'
  ),
  // Narrower than `count`: only these mean "this row stands for N executions".
  // "Rows"/"Records" mean rows *returned*, and multiplying calls by them would
  // report a single query returning 982,331 rows as 982,331 calls.
  executions: new RegExp(
    '\\b(' + [
      'count', 'calls', 'executions', 'execs', 'invocations', 'occurrences', 'freq(uency)?',
      'anzahl', 'aufrufe', 'ausfuhrungen',
      'cantidad', 'llamadas', 'ejecuciones',
      'appels', 'executions',
    ].join('|') + ')\\b',
    'i'
  ),
  statement: new RegExp(
    '\\b(' + [
      'sql', 'statement', 'stmt', 'query', 'command', 'operation',
      'anweisung', 'befehl', 'abfrage',
      'sentencia', 'consulta', 'comando', 'instrucao',
      'requete', 'commande',
    ].join('|') + ')\\b',
    'i'
  ),
  timestamp: new RegExp(
    '\\b(' + [
      'time(stamp)?', 'date', 'datetime', 'when', 'logged[ _-]?at', 'created[ _-]?at',
      'start(ed)?', 'end(ed)?',
      'zeitstempel', 'datum', 'uhrzeit', 'beginn', 'ende',
      'fecha', 'hora', 'data', 'horario',
      'heure',
    ].join('|') + ')\\b',
    'i'
  ),
  status: new RegExp(
    '\\b(' + [
      'status', 'state', 'severity', 'level', 'result', 'outcome', 'rc',
      'return[ _-]?code', 'err(or)?[ _-]?code', 'type',
      'zustand', 'schweregrad', 'ergebnis', 'meldungstyp', 'typ',
      'estado', 'resultado', 'nivel', 'gravedad',
      'etat', 'resultat', 'niveau',
    ].join('|') + ')\\b',
    'i'
  ),
};

/**
 * Strip diacritics and collapse punctuation so "Ausführungszeit (ms)" and
 * "Duração" match the unaccented patterns above. Latin-script only — a
 * CJK-headed export will not match, and is reported as an assumption instead.
 */
const normalizeHeader = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s()[\]./-]/g, ' ')
    .trim();

// Whether the header states a unit at all. When it does not, detectUnit falls
// back to milliseconds — a default that is right often enough to be useful and
// wrong often enough that the profile has to declare it.
const UNIT_IN_HEADER = /\b(ms|msec|millis|micro|us|usec|ns|nanos?|s|sec|secs|second|seconds|min|mins|minutes?)\b/i;

// A duration column is meaningless without its unit. Read it off the header
// when stated, so 4.2 (s) is not reported as faster than 900 (ms).
const detectUnit = (header) => {
  const h = String(header || '').toLowerCase();
  if (/\b(micro|us|usec)\b/.test(h)) return { label: 'us', toMs: 0.001 };
  if (/\b(ns|nanos?)\b/.test(h)) return { label: 'ns', toMs: 0.000001 };
  if (/\b(s|sec|secs|second|seconds)\b/.test(h) && !/\bms\b/.test(h)) return { label: 's', toMs: 1000 };
  if (/\b(min|mins|minutes?)\b/.test(h)) return { label: 'min', toMs: 60000 };
  return { label: 'ms', toMs: 1 };
};

/**
 * Split one delimited line, honouring the double-quote convention that
 * SpreadsheetLoader's toCsvCell writes ("" for an embedded quote). A naive
 * String.split would shred any SQL statement containing a comma — which is
 * every SQL statement selecting more than one column.
 */
const splitDelimited = (line, delim) => {
  const out = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
};

/** Parse a cell as a number, tolerating thousands separators and unit suffixes. */
const toNumber = (raw) => {
  if (raw === null || raw === undefined) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;
  // Strip grouping separators and a trailing unit ("4,821 ms" -> 4821).
  const cleaned = s
    .replace(/[, _](?=\d)/g, '')
    .replace(/\s*(ms|msec|s|sec|secs|us|ns|min)\.?$/i, '');
  if (!/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
};

const isNumericCell = (raw) => Number.isFinite(toNumber(raw));

/**
 * Pick the delimiter yielding the most consistent column count across a sample.
 * Consistency matters more than raw frequency: a log file full of prose commas
 * scores high on ',' but its column count is all over the place.
 */
const detectDelimiter = (lines) => {
  let best = null;

  for (const delim of DELIMITERS) {
    const counts = lines.map((l) => splitDelimited(l, delim).length);
    const modeMap = new Map();
    for (const c of counts) modeMap.set(c, (modeMap.get(c) || 0) + 1);

    let mode = 1;
    let modeFreq = 0;
    for (const [cols, freq] of modeMap) {
      if (cols > 1 && freq > modeFreq) {
        mode = cols;
        modeFreq = freq;
      }
    }

    const consistency = counts.length ? modeFreq / counts.length : 0;
    // Needs at least 2 columns and agreement across most sampled lines.
    if (mode > 1 && consistency >= 0.7) {
      const score = consistency * Math.min(mode, 12);
      if (!best || score > best.score) best = { delim, columns: mode, score };
    }
  }

  return best;
};

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const fmt = (n) => {
  if (!Number.isFinite(n)) return 'n/a';
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-US');
};

const truncate = (s, max = 160) => {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

/**
 * Collapse a statement to its shape so repeated executions with different bind
 * values group together. Without this, 39,000 executions of one lookup look
 * like 39,000 unrelated one-off queries.
 */
const fingerprintSql = (sql) => {
  let out = String(sql || '');

  // 1. Strip comments (both forms).
  out = out.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

  // 2. Literals collapse to '?', except that a leading '%' survives: whether a
  //    LIKE pattern starts with a wildcard decides whether an index can be used
  //    at all, so those two shapes must stay distinguishable.
  out = out.replace(/'(?:[^']|'')*'/g, (literal) => (literal.startsWith("'%") ? "'%?'" : '?'));
  out = out.replace(/"(?:[^"]|"")*"/g, (literal) => (literal.startsWith('"%') ? '"%?"' : '?'));

  // 3. Hex literals and NULL count as literals too (pt-fingerprint treats NULL
  //    as a value, so `col = NULL` and `col = 5` are one shape).
  out = out.replace(/\b0x[0-9a-fA-F]+\b/g, '?');
  out = out.replace(/\bNULL\b/gi, '?');

  // 4. Numbers. A plain \b\d+\b cannot reach digits inside an identifier
  //    (underscore is a word character), so partitioned tables need their own
  //    rule — without it orders_2025_01 and orders_2025_02 are unrelated
  //    statements whose cost never adds up to anything.
  //
  //    That rule is deliberately narrower than pt-fingerprint's: only an
  //    underscore-separated run of TWO OR MORE digits collapses. Folding a
  //    single trailing digit as well would merge `t1` and `t2` — genuinely
  //    different tables — into one shape, which is a worse error than failing
  //    to merge two monthly partitions.
  out = out.replace(/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, '?');
  out = out.replace(/_\d{2,}(?=_|\b)/g, '_?');

  out = out.replace(/\s+/g, ' ').trim().toUpperCase();

  // 5. Collapse list cardinality: an IN list of 5 values is the same statement
  //    as one of 4. Same for VALUES tuples, and for multi-row INSERT, which is
  //    shortened to a single tuple.
  out = out.replace(/\bIN\s*\(\s*\?(?:\s*,\s*\?)*\s*\)/g, 'IN (?)');
  out = out.replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, '(?)');
  out = out.replace(/\bVALUES\s*\(\?\)(?:\s*,\s*\(\?\))+/g, 'VALUES (?)');

  // 6. Repeated identical UNION branches collapse to one.
  out = out.replace(/(\bUNION(?:\s+ALL)?\s+)(.+?)(?=$|\s+UNION\b)/g, (match, keyword, branch, offset, whole) => {
    const previous = whole.slice(0, offset);
    return previous.includes(branch.trim()) ? '' : match;
  });

  // 7. USE statements group together regardless of database.
  out = out.replace(/^USE\s+\S+/, 'USE ?');

  return out.replace(/\s+/g, ' ').trim();
};

// Patterns that make a query slow by construction rather than by data volume.
// Each `test` runs against the uppercased fingerprint.
const ANTI_PATTERNS = [
  {
    id: 'select-star',
    confidence: 'high',
    label: 'SELECT * — reads every column, defeats covering indexes',
    test: (fp) => /\bSELECT\s+\*/.test(fp),
  },
  {
    id: 'no-where',
    confidence: 'high',
    label: 'No WHERE clause — full table scan',
    test: (fp) => /^SELECT\b/.test(fp) && /\bFROM\b/.test(fp) && !/\bWHERE\b/.test(fp) && !/\bCOUNT\s*\(/.test(fp),
  },
  {
    id: 'leading-wildcard',
    confidence: 'high',
    label: 'Leading-wildcard LIKE — index cannot be used',
    test: (fp) => /\bLIKE\s+'?%/.test(fp) || /\bLIKE\s+\?\s*\|\|/.test(fp),
  },
  {
    id: 'function-on-column',
    confidence: 'high',
    label: 'Function applied to a filtered column — index cannot be used',
    test: (fp) => /\bWHERE\b[^;]*\b(UPPER|LOWER|SUBSTR|SUBSTRING|TRIM|CAST|CONVERT|TO_CHAR)\s*\(\s*[A-Z0-9_."]+\s*\)\s*(=|<|>|LIKE)/.test(fp),
  },
  {
    id: 'not-in',
    confidence: 'low',
    label: 'NOT IN / NOT EXISTS subquery — frequently forces a scan',
    test: (fp) => /\bNOT\s+(IN|EXISTS)\b/.test(fp),
  },
  {
    id: 'or-filter',
    confidence: 'low',
    label: 'OR inside WHERE — often prevents a single index seek',
    test: (fp) => /\bWHERE\b[^;]*\bOR\b/.test(fp),
  },
  {
    id: 'cartesian',
    confidence: 'high',
    label: 'Multiple tables in FROM with no join predicate — possible Cartesian product',
    test: (fp) => /\bFROM\s+[A-Z0-9_."]+\s*,\s*[A-Z0-9_."]+/.test(fp) && !/\bWHERE\b/.test(fp),
  },
  {
    id: 'order-by-unbounded',
    confidence: 'high',
    label: 'ORDER BY with no row limit — sorts the whole result set',
    test: (fp) => /\bORDER\s+BY\b/.test(fp) && !/\b(LIMIT|TOP|FETCH FIRST|ROWNUM|UP TO)\b/.test(fp),
  },
  {
    id: 'sap-fae',
    confidence: 'high',
    label: 'SAP FOR ALL ENTRIES — degenerates badly when the driver table is large',
    test: (fp) => /\bFOR ALL ENTRIES\b/.test(fp),
  },
  {
    id: 'select-single',
    confidence: 'low',
    label: 'SELECT SINGLE / scalar lookup — check whether it runs inside a loop',
    test: (fp) => /^SELECT SINGLE\b/.test(fp),
  },
];

/**
 * Classify one column from its header and a sample of its values. Header text
 * alone is unreliable (exports label things "Col3"), and values alone cannot
 * separate a duration from a row count, so both are used.
 */
const classifyColumns = (header, rows) => {
  const columnCount = header.length;
  const classes = [];

  for (let c = 0; c < columnCount; c++) {
    const name = header[c] || `Column ${c + 1}`;
    const normalized = normalizeHeader(name);
    const sample = [];
    for (let r = 0; r < rows.length && sample.length < 80; r++) {
      const v = rows[r][c];
      if (v !== undefined && String(v).trim() !== '') sample.push(String(v));
    }

    const numericCount = sample.filter(isNumericCell).length;
    const numericRatio = sample.length ? numericCount / sample.length : 0;
    const sqlCount = sample.filter((v) => SQL_START.test(v)).length;
    const sqlRatio = sample.length ? sqlCount / sample.length : 0;
    const avgLength = sample.length
      ? sample.reduce((a, v) => a + v.length, 0) / sample.length
      : 0;

    // `basis` records WHY a column was classified, so the profile can state its
    // assumptions instead of presenting a guess as a measurement.
    let type = 'text';
    let basis = 'no match';
    if (sqlRatio >= 0.4) {
      type = 'statement';
      basis = `${Math.round(sqlRatio * 100)}% of sampled values start with a SQL keyword`;
    } else if (HEADER_HINTS.statement.test(normalized) && avgLength > 20 && numericRatio < 0.3) {
      type = 'statement';
      basis = 'header name';
    } else if (numericRatio >= 0.8 && HEADER_HINTS.duration.test(normalized)) {
      type = 'duration';
      basis = 'header name + numeric values';
    } else if (numericRatio >= 0.8 && HEADER_HINTS.count.test(normalized)) {
      type = 'count';
      basis = 'header name + numeric values';
    } else if (numericRatio >= 0.8) {
      type = 'numeric';
      basis = 'numeric values, header not recognised';
    } else if (HEADER_HINTS.timestamp.test(normalized)) {
      type = 'timestamp';
      basis = 'header name';
    } else if (HEADER_HINTS.status.test(normalized)) {
      type = 'status';
      basis = 'header name';
    }

    classes.push({
      index: c,
      name,
      normalized,
      type,
      basis,
      numericRatio,
      unit: detectUnit(normalized),
      unitStated: UNIT_IN_HEADER.test(normalized),
      isExecutionCount: type === 'count' && HEADER_HINTS.executions.test(normalized),
    });
  }

  // No header hint matched, but a trace still has a duration somewhere: fall
  // back to the numeric column with the widest spread, which is what a timing
  // column looks like next to counts and ids.
  if (!classes.some((c) => c.type === 'duration')) {
    let best = null;
    for (const col of classes) {
      if (col.type !== 'numeric') continue;
      const values = [];
      for (let r = 0; r < rows.length && values.length < 500; r++) {
        const n = toNumber(rows[r][col.index]);
        if (Number.isFinite(n) && n >= 0) values.push(n);
      }
      if (values.length < 10) continue;

      const max = Math.max(...values);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      if (max <= 0 || mean <= 0) continue;

      // Rule out columns that are shaped like something else. A guess that
      // survives these is still a guess, but these three checks remove the
      // cases that would otherwise be reported with full confidence:
      //
      //   - an id or sequence climbs monotonically; a duration does not
      //   - a near-unique integer column is a key, not a measurement
      //   - a duration is dominated by small values with a long tail, so its
      //     median sits well below its mean; an amount or quantity does not
      const increasing = values.every((v, i) => i === 0 || v >= values[i - 1]);
      if (increasing) continue;

      const distinctRatio = new Set(values).size / values.length;
      const allIntegers = values.every((v) => Number.isInteger(v));
      if (allIntegers && distinctRatio > 0.95) continue;

      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median <= 0 || mean / median < 1.2) continue;

      const spread = max / mean;
      if (spread > 10 && (!best || spread > best.spread)) best = { col, spread };
    }
    if (best) {
      best.col.type = 'duration';
      // This one is a guess, and the profile says so: the column was picked for
      // having the widest numeric spread, not because anything named it.
      best.col.basis = `GUESSED — no recognised duration header; picked for widest numeric spread (max is ${Math.round(best.spread)}x the mean)`;
      best.col.guessed = true;
    }
  }

  return classes;
};

/** Numeric summary of one column. */
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    total,
    avg: total / values.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
};

/**
 * Profile one delimited block (a sheet, or a whole CSV).
 * Returns null when the block has no usable table shape.
 */
const profileBlock = (lines, blockName) => {
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length < 5) return null;

  const shape = detectDelimiter(nonEmpty.slice(0, SAMPLE_ROWS_FOR_SHAPE));
  if (!shape) return null;

  const { delim, columns } = shape;
  const parsed = [];
  for (const line of nonEmpty) {
    if (parsed.length >= MAX_ROWS_SCANNED) break;
    const cells = splitDelimited(line, delim);
    // Keep only rows matching the detected width; trace exports interleave
    // section banners and separators that would otherwise skew every statistic.
    if (cells.length === columns) parsed.push(cells);
  }
  if (parsed.length < 5) return null;

  // Header row: mostly non-numeric.
  const first = parsed[0];
  const firstNumeric = first.filter(isNumericCell).length;
  const hasHeader = firstNumeric <= Math.floor(columns / 4);
  const header = hasHeader ? first : first.map((_, i) => `Column ${i + 1}`);
  const rows = hasHeader ? parsed.slice(1) : parsed;
  if (rows.length < 4) return null;

  const classes = classifyColumns(header, rows);
  const durationCol = classes.find((c) => c.type === 'duration');
  const statementCol = classes.find((c) => c.type === 'statement');
  const statusCol = classes.find((c) => c.type === 'status');
  const execCountCol = classes.find((c) => c.isExecutionCount);
  const timestampCol = classes.find((c) => c.type === 'timestamp');

  // Nothing numeric and nothing SQL-shaped: this is a plain data table, and a
  // performance profile of it would be noise.
  if (!durationCol && !statementCol) return null;

  const out = [];
  const colSummary = classes
    .map((c) => (c.type === 'text' ? c.name : `${c.name} <${c.type}>`))
    .join(' | ');
  out.push(`${blockName}: ${fmt(rows.length)} data rows x ${columns} columns${hasHeader ? '' : ' (no header row detected)'}`);
  out.push(`Columns: ${colSummary}`);

  // -- Assumptions ----------------------------------------------------------
  // Every figure below rests on the column classification above, and that
  // classification is inference. Stating it makes a wrong reading visible
  // instead of leaving a confident table built on the wrong column.
  const assumptions = [];
  if (!hasHeader) {
    assumptions.push('No header row was found, so columns are identified by position and content only.');
  }
  if (durationCol) {
    assumptions.push(`Timings read from column ${durationCol.index + 1} "${durationCol.name}" (${durationCol.basis}).`);
    if (!durationCol.unitStated) {
      assumptions.push(`That column's header states no unit; values are ASSUMED to be milliseconds. If the export is in seconds, every duration below is 1000x too small.`);
    }
  } else {
    assumptions.push('No duration column identified — no timing figures are reported, and "slowest" cannot be answered from this file.');
  }
  if (statementCol) {
    assumptions.push(`Statements read from column ${statementCol.index + 1} "${statementCol.name}" (${statementCol.basis}).`);
  } else {
    assumptions.push('No statement column identified — rows could not be grouped by query shape.');
  }
  if (!execCountCol) {
    assumptions.push('No execution-count column found; each row is counted as one execution. If this export is pre-aggregated, call counts are undercounted.');
  } else {
    assumptions.push(`Call counts multiplied by column ${execCountCol.index + 1} "${execCountCol.name}".`);
  }
  const unmatched = classes.filter((c) => c.type === 'numeric');
  if (unmatched.length > 0) {
    assumptions.push(`Unclassified numeric column(s) ignored: ${unmatched.map((c) => `"${c.name}"`).join(', ')}.`);
  }

  out.push('');
  out.push('--- HOW THIS FILE WAS READ (assumptions — check these before trusting the numbers) ---');
  for (const line of assumptions) out.push(`- ${line}`);

  // -- Duration statistics -------------------------------------------------
  let durations = null;
  if (durationCol) {
    const values = [];
    for (const row of rows) {
      const n = toNumber(row[durationCol.index]);
      if (Number.isFinite(n) && n >= 0) values.push(n * durationCol.unit.toMs);
    }
    if (values.length >= 4) {
      durations = summarize(values);
      out.push('');
      out.push(
        durationCol.guessed
          ? `--- UNVERIFIED TIMING (column "${durationCol.name}" was GUESSED, not identified by name) ---`
          : `--- TIMING (column "${durationCol.name}", read as ${durationCol.unit.label}, reported in ms) ---`
      );
      if (durationCol.guessed) {
        out.push('Nothing named this column as a duration; it was chosen for its numeric shape.');
        out.push('Treat every figure in this section as unconfirmed, and say so when reporting it.');
        out.push('If this column is not a duration, these numbers describe something else entirely.');
      }
      out.push(
        `rows=${fmt(durations.n)}  total=${fmt(durations.total)} ms  avg=${fmt(durations.avg)}  ` +
        `p50=${fmt(durations.p50)}  p95=${fmt(durations.p95)}  p99=${fmt(durations.p99)}  max=${fmt(durations.max)}`
      );
      if (durations.p50 > 0 && durations.max > durations.p50 * 50) {
        out.push(`NOTE: max is ${fmt(durations.max / durations.p50)}x the median — the tail is the problem, not the average.`);
      }
    }
  }

  // -- Slowest individual rows ---------------------------------------------
  if (durationCol && durations) {
    const sortedRows = rows
      .map((row, i) => ({ row, i, ms: toNumber(row[durationCol.index]) * durationCol.unit.toMs }))
      .filter((r) => Number.isFinite(r.ms))
      .sort((a, b) => b.ms - a.ms);

    // Only rows that are actually outliers. Padding the list to ten with rows
    // sitting at the median reads as "these are the slow ones" when they are
    // simply the first of many identical rows.
    const outlierFloor = durations.p50 * 2;
    const outliers = sortedRows.filter((r) => r.ms > outlierFloor);
    // Fall back to the plain ranking only when nothing stands out at all —
    // a flat file where every row costs the same.
    const ranked = (outliers.length > 0 ? outliers : sortedRows).slice(0, TOP_N);

    out.push('');
    out.push(`--- TOP ${ranked.length} SLOWEST INDIVIDUAL ROWS ---`);
    ranked.forEach((r, rank) => {
      const label = statementCol
        ? truncate(r.row[statementCol.index], 150)
        : truncate(r.row.filter((_, ci) => ci !== durationCol.index).join(' | '), 150);
      const lineNo = r.i + (hasHeader ? 2 : 1);
      out.push(`${String(rank + 1).padStart(2)}. ${fmt(r.ms)} ms  [row ${fmt(lineNo)}]  ${label}`);
    });
  }

  // -- Statement aggregation ------------------------------------------------
  const flagged = new Map();
  const noteFlag = (pattern, group) => {
    const bucket = flagged.get(pattern.id)
      || { label: pattern.label, confidence: pattern.confidence, statements: 0, calls: 0, totalMs: 0, sample: group.sample };
    bucket.statements++;
    bucket.calls += group.calls;
    bucket.totalMs += group.totalMs;
    flagged.set(pattern.id, bucket);
  };

  if (statementCol) {
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i][statementCol.index];
      if (!raw || String(raw).trim() === '') continue;
      const fp = fingerprintSql(raw);
      if (!fp) continue;

      let g = groups.get(fp);
      if (!g) {
        g = { fp, sample: String(raw), calls: 0, totalMs: 0, maxMs: 0, timed: 0 };
        groups.set(fp, g);
      }
      // A trace row can itself represent many executions; honour an explicit
      // execution-count column so an already-aggregated export is not
      // undercounted as a single call.
      const execs = execCountCol ? Math.max(1, toNumber(rows[i][execCountCol.index]) || 1) : 1;
      g.calls += execs;

      if (durationCol) {
        const ms = toNumber(rows[i][durationCol.index]) * durationCol.unit.toMs;
        if (Number.isFinite(ms)) {
          g.totalMs += ms;
          g.timed++;
          if (ms > g.maxMs) g.maxMs = ms;
        }
      }
    }

    // Flag patterns across every distinct shape, not just the printed top N.
    for (const g of groups.values()) {
      for (const pattern of ANTI_PATTERNS) {
        if (pattern.test(g.fp)) noteFlag(pattern, g);
      }
    }

    // Rank by time only when the duration column was actually identified.
    // Ranking by a guessed column would present an ordering that looks
    // authoritative and could be entirely arbitrary; call count is derived from
    // the rows themselves and holds regardless.
    const rankByTime = Boolean(durationCol) && !durationCol.guessed;
    const byTotal = [...groups.values()].sort((a, b) =>
      rankByTime ? b.totalMs - a.totalMs : b.calls - a.calls
    );

    if (byTotal.length > 0) {
      out.push('');
      out.push(
        `--- TOP STATEMENTS BY ${rankByTime ? 'TOTAL TIME' : 'CALL COUNT'} ` +
        `(${fmt(groups.size)} distinct shapes across ${fmt(rows.length)} rows) ---`
      );
      if (durationCol && !rankByTime) {
        out.push('Ranked by call count, not time: the duration column was only guessed, so a');
        out.push('time-based ranking here would not be trustworthy.');
      }
      byTotal.slice(0, TOP_N).forEach((g, rank) => {
        const timing = durationCol
          ? `total=${fmt(g.totalMs)} ms  avg=${fmt(g.timed ? g.totalMs / g.timed : 0)}  max=${fmt(g.maxMs)}  `
          : '';
        out.push(`${String(rank + 1).padStart(2)}. ${timing}calls=${fmt(g.calls)}`);
        out.push(`    ${truncate(g.sample, 200)}`);

        if (g.calls >= 100 && durationCol && g.timed && g.totalMs / g.timed < 50) {
          out.push(`    ! repeated ${fmt(g.calls)}x at ${fmt(g.totalMs / g.timed)} ms each — the cost is the call count, not the query (probable N+1 / loop-driven access)`);
        }
        for (const pattern of ANTI_PATTERNS) {
          if (pattern.test(g.fp)) out.push(`    ! ${pattern.label}`);
        }
      });
    }

    if (flagged.size > 0) {
      out.push('');
      out.push('--- QUERY SHAPE WARNINGS (static pattern match, NOT a root cause) ---');
      out.push('These describe how a statement is written, not why the system is slow.');
      out.push('There is no execution plan, no index list and no table statistics here — a flagged');
      out.push('query may be fine, and an unflagged one may be the real problem.');
      out.push('Rank by the measured time above, not by this list.');

      const all = [...flagged.values()].sort((a, b) => b.totalMs - a.totalMs);
      const high = all.filter((b) => b.confidence !== 'low');
      const low = all.filter((b) => b.confidence === 'low');

      for (const bucket of high) {
        const cost = durationCol ? `, ${fmt(bucket.totalMs)} ms total` : '';
        out.push(`- ${bucket.label} (${fmt(bucket.statements)} statement shape(s), ${fmt(bucket.calls)} call(s)${cost})`);
        out.push(`    e.g. ${truncate(bucket.sample, 150)}`);
      }
      if (high.length === 0) out.push('- None of the high-confidence patterns matched.');

      // Kept separate rather than dropped. OR-filters, NOT IN and SELECT SINGLE
      // occur in a large share of perfectly healthy queries, so listing them
      // beside the others buries the findings that are worth acting on under
      // ones that usually are not.
      if (low.length > 0) {
        out.push('');
        out.push('Weak signals — these appear in many healthy queries and are listed only for completeness:');
        for (const bucket of low) {
          out.push(`- ${bucket.label} (${fmt(bucket.statements)} statement shape(s))`);
        }
      }
    }
  }

  // -- Status / severity breakdown ------------------------------------------
  if (statusCol) {
    const tally = new Map();
    for (const row of rows) {
      const v = String(row[statusCol.index] || '').trim();
      if (!v) continue;
      tally.set(v, (tally.get(v) || 0) + 1);
    }
    if (tally.size > 0 && tally.size <= 60) {
      const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      out.push('');
      out.push(`--- "${statusCol.name}" BREAKDOWN ---`);
      out.push(ranked.map(([v, n]) => `${v}: ${fmt(n)}`).join('  |  '));
    }
  }

  // -- Time window ----------------------------------------------------------
  // Nothing here correlates two uploads automatically, but printing the window
  // each file covers lets the reader line up an app log against a DB trace by
  // hand — which is otherwise impossible from sampled excerpts alone.
  if (timestampCol) {
    let earliest = null;
    let latest = null;
    let counted = 0;
    for (const row of rows) {
      const raw = String(row[timestampCol.index] || '').trim();
      if (!raw) continue;
      const t = Date.parse(raw);
      if (!Number.isFinite(t)) continue;
      counted++;
      if (!earliest || t < earliest.t) earliest = { t, raw };
      if (!latest || t > latest.t) latest = { t, raw };
      if (counted >= MAX_ROWS_SCANNED) break;
    }
    if (counted >= 2 && earliest && latest) {
      const spanMs = latest.t - earliest.t;
      out.push('');
      out.push(`--- TIME WINDOW COVERED (column "${timestampCol.name}") ---`);
      // The file's own strings, verbatim. Re-serialising through Date would
      // reinterpret a timestamp carrying no zone in the SERVER's timezone and
      // silently shift the window — the opposite of useful when the whole point
      // is lining this file up against another one.
      out.push(`${earliest.raw}  to  ${latest.raw}  (span ${fmt(spanMs / 1000)} s over ${fmt(counted)} timestamped rows, shown exactly as the file writes them)`);
      out.push('Use this window to line this file up against other uploads by hand; nothing correlates files automatically.');
      if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(earliest.raw)) {
        out.push('These timestamps carry no timezone, so they cannot be compared to another file without knowing both zones.');
      }
    }
  }

  return out.join('\n');
};

// Inline timings in unstructured logs: "took 4821 ms", "duration=4.2s", "(1203ms)".
const INLINE_DURATION = /(?:\b(?:took|duration|elapsed|latency|time|exec(?:ution)?[ _-]?time|runtime|cost)\b\s*[:=]?\s*)?(\d+(?:[.,]\d+)?)\s*(ms|msec|millis(?:econds)?|s|sec|secs|seconds?)\b/i;

const UNIT_TO_MS = {
  ms: 1, msec: 1, millis: 1, millisecond: 1, milliseconds: 1,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
};

const TIMING_WORD = /\b(took|duration|elapsed|latency|exec|runtime|cost|time)\b/i;

// A log line that begins with a timestamp or a level is a new event, not the
// continuation of a pretty-printed statement.
const LOG_LINE_START = /^\s*(\[|\d{4}-\d{2}-\d{2}|\d{2}[:/]\d{2}|(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE)\b)/i;
const SQL_CONTINUATION = /^\s*(FROM|WHERE|AND|OR|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|ON|SET|VALUES|INTO|WITH|SELECT|CASE|WHEN|THEN|ELSE|END|FETCH|RETURNING|[(),])/i;
const MAX_STATEMENT_LINES = 40;

/**
 * Pull a complete SQL statement out of a log around line `idx`.
 *
 * ORMs and trace formatters print a statement over many lines and attach the
 * timing to the first or the last of them, so a single-line read captures a
 * fragment like "SELECT" and fingerprints it as its own distinct query —
 * scattering one slow statement across dozens of meaningless groups.
 */
const reassembleStatement = (lines, idx) => {
  const startsSql = (s) => SQL_START.test(s.replace(/^.*?(?=\b(SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\b)/i, ''));

  // The statement can sit on the matched line, above it (timing logged after the
  // query was printed), or below it (timing logged first, then the SQL) —
  // frameworks do all three, so all three are searched.
  const hasSqlKeyword = (line) => /\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.test(line);

  // Order matters. Searching upward first would walk straight past this event
  // into the tail of the PREVIOUS statement — whose continuation lines are
  // indented and so never trip the "new log event" guard — and attribute that
  // query's text to this timing.
  let start = -1;

  if (hasSqlKeyword(lines[idx] || '')) {
    start = idx;
  }

  if (start === -1) {
    for (let i = idx + 1; i < lines.length && i <= idx + MAX_STATEMENT_LINES; i++) {
      const line = lines[i];
      if (line === undefined) break;
      if (line.trim() === '') break;
      if (hasSqlKeyword(line)) { start = i; break; }
      // A new log event below means this event had no statement of its own;
      // taking the next event's SQL would attribute its text to this timing.
      if (LOG_LINE_START.test(line)) break;
    }
  }

  if (start === -1) {
    for (let i = idx - 1; i >= Math.max(0, idx - MAX_STATEMENT_LINES); i--) {
      const line = lines[i];
      if (line === undefined) break;
      if (line.trim() === '') break;
      if (hasSqlKeyword(line)) { start = i; break; }
      if (LOG_LINE_START.test(line)) break;
    }
  }

  if (start === -1) return null;

  const head = lines[start];
  const sqlOffset = head.search(/\b(SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\b/i);
  if (sqlOffset === -1) return null;

  const parts = [head.slice(sqlOffset)];

  // Extend downward while the following lines look like clause continuations
  // rather than the next log event.
  for (let i = start + 1; i < lines.length && parts.length < MAX_STATEMENT_LINES; i++) {
    const next = lines[i];
    if (next === undefined) break;
    if (next.trim() === '') break;
    if (LOG_LINE_START.test(next)) break;
    // A clause keyword, or simply an indented line — pretty-printed select
    // lists ("o.id, o.total, c.name") match no keyword but are still part of
    // the statement, and the guards above already bound how far this runs.
    if (!SQL_CONTINUATION.test(next) && !/^\s+\S/.test(next)) break;
    parts.push(next.trim());
    if (/;\s*$/.test(next)) break;
  }

  const statement = parts.join(' ').replace(/\s+/g, ' ').trim();
  return startsSql(statement) || /^(SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\b/i.test(statement)
    ? statement
    : null;
};

/**
 * Fallback for line-oriented logs with no table shape. Finds the slowest
 * operations by reading timings out of the log text itself, and groups any SQL
 * on those lines the same way the tabular path does.
 */
const profileLogTimings = (lines) => {
  const timed = [];

  for (let i = 0; i < lines.length && i < MAX_ROWS_SCANNED; i++) {
    const line = lines[i];
    if (line.length > 4000) continue;
    const m = INLINE_DURATION.exec(line);
    if (!m) continue;
    const value = Number(String(m[1]).replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    const factor = UNIT_TO_MS[m[2].toLowerCase()] ?? 1;
    // A bare "5s" inside prose is noise; a second-scale figure needs an explicit
    // timing word before it counts, while "ms" is already unambiguous.
    if (factor !== 1 && !TIMING_WORD.test(line)) continue;
    // Frameworks pretty-print SQL across many lines and put the timing on the
    // first or last of them. Reading only the matched line would capture
    // "SELECT" and nothing else, so the statement is reassembled around it.
    timed.push({ i, ms: value * factor, line, statement: reassembleStatement(lines, i) });
  }

  if (timed.length < 5) return null;

  const stats = summarize(timed.map((t) => t.ms));

  const out = [];
  out.push(`--- INLINE TIMINGS FOUND IN LOG TEXT (${fmt(timed.length)} timed events) ---`);
  out.push(
    `total=${fmt(stats.total)} ms  avg=${fmt(stats.avg)}  p50=${fmt(stats.p50)}  ` +
    `p95=${fmt(stats.p95)}  p99=${fmt(stats.p99)}  max=${fmt(stats.max)}`
  );

  const slowest = [...timed].sort((a, b) => b.ms - a.ms).slice(0, TOP_N);
  out.push('');
  out.push(`--- TOP ${slowest.length} SLOWEST LOGGED OPERATIONS ---`);
  slowest.forEach((t, rank) => {
    out.push(`${String(rank + 1).padStart(2)}. ${fmt(t.ms)} ms  [line ${fmt(t.i + 1)}]  ${truncate(t.line, 170)}`);
  });

  // Group any SQL on timed lines, so a fast-but-repeated statement surfaces too.
  const groups = new Map();
  let multiLineCount = 0;
  for (const t of timed) {
    const statement = t.statement
      || (t.line.match(/\b(select|insert|update|delete|merge|with)\b[\s\S]{0,600}/i) || [])[0];
    if (!statement) continue;
    if (t.statement && t.statement.length > t.line.length) multiLineCount++;
    const fp = fingerprintSql(statement);
    if (!fp || fp.length < 12) continue;
    let g = groups.get(fp);
    if (!g) {
      g = { fp, sample: statement, calls: 0, totalMs: 0, maxMs: 0 };
      groups.set(fp, g);
    }
    g.calls++;
    g.totalMs += t.ms;
    if (t.ms > g.maxMs) g.maxMs = t.ms;
  }

  if (groups.size > 0) {
    const byTotal = [...groups.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, TOP_N);
    out.push('');
    out.push(`--- TOP SQL STATEMENTS ON TIMED LINES (${fmt(groups.size)} distinct shapes) ---`);
    if (multiLineCount > 0) {
      out.push(`${fmt(multiLineCount)} statement(s) were reassembled from multiple log lines; the text shown is the joined statement, not one raw line.`);
    }
    byTotal.forEach((g, rank) => {
      out.push(`${String(rank + 1).padStart(2)}. total=${fmt(g.totalMs)} ms  calls=${fmt(g.calls)}  avg=${fmt(g.totalMs / g.calls)}  max=${fmt(g.maxMs)}`);
      out.push(`    ${truncate(g.sample, 200)}`);
      if (g.calls >= 100 && g.totalMs / g.calls < 50) {
        out.push(`    ! repeated ${fmt(g.calls)}x at ${fmt(g.totalMs / g.calls)} ms each — probable N+1 / loop-driven access`);
      }
      for (const pattern of ANTI_PATTERNS) {
        if (pattern.test(g.fp)) out.push(`    ! ${pattern.label}`);
      }
    });
  }

  return out.join('\n');
};

/**
 * Build a numeric diagnostic profile for tabular or timed-log content.
 *
 * @param {string} text     extracted file text (SpreadsheetLoader output, raw
 *                          log text, or DocumentLoader table rows)
 * @param {string} fileName for the profile heading
 * @returns {string|null}   profile block, or null when the content has no
 *                          tabular shape and no timings worth reporting
 */
const profileTabularContent = (text, fileName = 'file') => {
  if (!text || typeof text !== 'string' || text.length < 200) return null;

  try {
    const lines = text.split('\n');

    // SpreadsheetLoader emits one "[Sheet: name]" banner per worksheet, so each
    // sheet is profiled on its own — their columns are unrelated.
    const blocks = [];
    let current = { name: null, lines: [] };
    for (const line of lines) {
      const sheetMatch = line.match(/^\[Sheet:\s*(.+?)\]\s*$/);
      if (sheetMatch) {
        if (current.lines.length > 0) blocks.push(current);
        current = { name: `Sheet "${sheetMatch[1]}"`, lines: [] };
      } else {
        current.lines.push(line);
      }
    }
    if (current.lines.length > 0) blocks.push(current);

    const sections = [];
    for (const block of blocks) {
      if (sections.join('\n').length > MAX_PROFILE_CHARS) break;
      const profile = profileBlock(block.lines, block.name || 'Table');
      if (profile) sections.push(profile);
    }

    // No table shape anywhere — try reading timings out of the log text.
    if (sections.length === 0) {
      const logProfile = profileLogTimings(lines);
      if (logProfile) sections.push(logProfile);
    }

    if (sections.length === 0) return null;

    let body = sections.join('\n\n');
    if (body.length > MAX_PROFILE_CHARS) {
      body = `${body.slice(0, MAX_PROFILE_CHARS)}\n... (profile truncated)`;
    }

    return (
      `[NUMERIC DIAGNOSTIC PROFILE: ${fileName}]\n` +
      'Computed over the whole file. Counts, totals and percentiles below are exact\n' +
      'measurements, not samples — prefer them over eyeballing the excerpts that follow.\n' +
      'Two things are NOT measurements and must not be reported as findings on their own:\n' +
      '  1. the "assumptions" section — how the columns were identified, which can be wrong;\n' +
      '  2. the "query shape warnings" — static pattern matches, not diagnosed causes.\n' +
      'When answering, separate what was measured from what you inferred, cite the row\n' +
      'numbers given, and say plainly when the file does not contain enough to be sure.\n\n' +
      `${body}\n` +
      '[END NUMERIC DIAGNOSTIC PROFILE]'
    );
  } catch (err) {
    // A profile is an enhancement; never let it break an upload or a file read.
    console.warn(`[TabularProfiler] Profiling failed for "${fileName}":`, err.message);
    return null;
  }
};

// ============================================================
// COLUMN CENSUS + ON-DEMAND COMPUTATION
//
// Everything above infers what a column MEANS from its header, using a fixed
// vocabulary. That vocabulary is a dictionary, not comprehension: it misses
// Japanese headers, cryptic ones (Z1, F3, COL_A), domain names nobody
// anticipated, and every file that is not a trace at all — a sales export whose
// owner still wants to know what is anomalous in it.
//
// The division of labour was backwards. Working out that `処理時間` or
// `ELAPSED_CS` is a duration is exactly what a language model does well, in any
// language and any domain. What it does badly is sum 200,000 rows without
// drifting. So: the census below states raw facts and claims NO meaning, the
// model reads it and decides which columns matter, and analyzeTable then does
// the arithmetic exactly. Semantics from the model, numbers from code.
//
// The header vocabulary survives only as a fast path that saves a round trip
// when it happens to match — never as the only route to an answer.
// ============================================================

/**
 * Split loader output into per-sheet blocks. Shared by census and profile.
 *
 * Each block records `startLine`, the 1-based line number of its first line in
 * the ORIGINAL text. Every row position reported downstream is resolved back to
 * a real file line through it, so a coordinate printed by one tool can be
 * handed straight to READ_ROWS. Counting data rows instead would drift by one
 * per sheet banner and per blank line.
 */
const splitIntoBlocks = (text) => {
  const blocks = [];
  const allLines = String(text).split('\n');
  let current = { name: null, lines: [], startLine: 1 };

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    const sheetMatch = line.match(/^\[Sheet:\s*(.+?)\]\s*$/);
    if (sheetMatch) {
      if (current.lines.length > 0) blocks.push(current);
      current = { name: `Sheet "${sheetMatch[1]}"`, lines: [], startLine: i + 2 };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) blocks.push(current);
  return blocks;
};

/**
 * Parse one block into { header, rows }, or null when it has no table shape.
 * Extracted so the census and analyzeTable read a file the same way the
 * profile does — a census describing different columns than the ones
 * analyzeTable indexes would be worse than no census at all.
 */
const parseBlock = (lines, startLine = 1) => {
  // Offsets are tracked alongside the text so every kept row remembers which
  // physical line it came from, blank lines and skipped banners included.
  const nonEmpty = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') nonEmpty.push({ text: lines[i], line: startLine + i });
  }
  if (nonEmpty.length < 3) return null;

  const shape = detectDelimiter(nonEmpty.slice(0, SAMPLE_ROWS_FOR_SHAPE).map((e) => e.text));
  if (!shape) return null;

  const { delim, columns } = shape;
  const parsed = [];
  for (const entry of nonEmpty) {
    if (parsed.length >= MAX_ROWS_SCANNED) break;
    const cells = splitDelimited(entry.text, delim);
    if (cells.length === columns) parsed.push({ cells, line: entry.line });
  }
  if (parsed.length < 2) return null;

  const first = parsed[0].cells;
  const firstNumeric = first.filter(isNumericCell).length;
  const hasHeader = firstNumeric <= Math.floor(columns / 4);
  const header = hasHeader ? first : first.map((_, i) => `Column ${i + 1}`);
  const kept = hasHeader ? parsed.slice(1) : parsed;
  if (kept.length < 1) return null;

  const rows = kept.map((e) => e.cells);
  const rowLines = kept.map((e) => e.line);

  return { header, rows, rowLines, hasHeader, columns };
};

// Date.parse alone is far too lenient — it accepts "SKU-0" and would type a
// product-code column as datetime. Require a date-shaped string first.
const DATE_SHAPE = /^\s*(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?/;
const TIME_SHAPE = /^\s*\d{1,2}:\d{2}(?::\d{2})?/;

const looksLikeDate = (v) => {
  const s = String(v);
  if (!DATE_SHAPE.test(s) && !TIME_SHAPE.test(s)) return false;
  return Number.isFinite(Date.parse(s));
};

/** Raw, meaning-free facts about one column. */
const censusColumn = (header, rows, index) => {
  const values = [];
  for (let r = 0; r < rows.length; r++) {
    const v = rows[r][index];
    if (v !== undefined && String(v).trim() !== '') values.push(String(v));
  }

  const distinct = new Set(values);
  const numbers = values.map(toNumber).filter(Number.isFinite);
  const numericRatio = values.length ? numbers.length / values.length : 0;

  const facts = {
    index,
    name: header[index] || `Column ${index + 1}`,
    nonEmpty: values.length,
    distinct: distinct.size,
    samples: values.slice(0, 3),
  };

  if (numericRatio >= 0.8 && numbers.length > 0) {
    const sorted = [...numbers].sort((a, b) => a - b);
    facts.kind = 'number';
    facts.min = sorted[0];
    facts.median = sorted[Math.floor(sorted.length / 2)];
    facts.max = sorted[sorted.length - 1];
    facts.sum = numbers.reduce((a, b) => a + b, 0);
  } else if (values.length > 0 && values.slice(0, 20).filter(looksLikeDate).length >= Math.min(5, values.length)) {
    facts.kind = 'datetime';
  } else {
    facts.kind = 'text';
    facts.avgLength = values.length
      ? Math.round(values.reduce((a, v) => a + v.length, 0) / values.length)
      : 0;
    // A small value set is worth listing outright — it is often the status,
    // category or level column, and the model can see that without guessing.
    if (distinct.size > 0 && distinct.size <= 12) {
      const tally = new Map();
      for (const v of values) tally.set(v, (tally.get(v) || 0) + 1);
      facts.valueCounts = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    }
  }

  return facts;
};

const renderCensusColumn = (c) => {
  const head = ` col ${String(c.index + 1).padStart(2)} | ${truncate(c.name, 40).padEnd(40)} | ${c.kind.padEnd(8)}`;
  const common = `| ${fmt(c.nonEmpty)} non-empty, ${fmt(c.distinct)} distinct`;

  if (c.kind === 'number') {
    return `${head} ${common} | min ${fmt(c.min)}, median ${fmt(c.median)}, max ${fmt(c.max)}, sum ${fmt(c.sum)}`;
  }
  if (c.kind === 'text' && c.valueCounts) {
    return `${head} ${common} | values: ${c.valueCounts.map(([v, n]) => `${truncate(v, 24)} (${fmt(n)})`).join(', ')}`;
  }
  const sample = c.samples.length ? ` | e.g. ${c.samples.map((s) => truncate(s, 40)).join(' / ')}` : '';
  return `${head} ${common}${c.kind === 'text' ? ` | avg ${c.avgLength} chars` : ''}${sample}`;
};

/**
 * Describe every table in a file WITHOUT interpreting it.
 *
 * Emitted for any tabular upload, including ones the diagnostic profile
 * declines — a sales or sensor export has no duration column and no SQL, so it
 * produces no profile, but the model can still answer questions about it from
 * this census plus analyzeTable.
 *
 * @returns {string|null} census block, or null when nothing tabular was found
 */
const describeTable = (text, fileName = 'file') => {
  if (!text || typeof text !== 'string' || text.length < 100) return null;

  try {
    const sections = [];

    for (const block of splitIntoBlocks(text)) {
      const parsed = parseBlock(block.lines, block.startLine);
      if (!parsed) continue;

      const { header, rows, hasHeader, columns } = parsed;
      const lines = [];
      lines.push(
        `${block.name || 'Table'}: ${fmt(rows.length)} data rows x ${columns} columns` +
        `${hasHeader ? '' : ' (no header row found; names are positional)'}`
      );
      for (let c = 0; c < columns; c++) {
        lines.push(renderCensusColumn(censusColumn(header, rows, c)));
      }
      sections.push(lines.join('\n'));
      if (sections.join('\n').length > MAX_PROFILE_CHARS) break;
    }

    if (sections.length === 0) return null;

    return (
      `[TABLE SCHEMA: ${fileName}]\n` +
      'Raw facts only — NO meaning is assumed for any column here. Column names may be\n' +
      'in any language, abbreviated, or absent; read the names, types and sample values\n' +
      'and decide for yourself which columns answer the question.\n' +
      'Then compute over the WHOLE file with:\n' +
      `  [ANALYZE_TABLE:file=<file_id> value=<col#> group=<col#>]\n` +
      '  value = the numeric column to total and rank (optional)\n' +
      '  group = the column to group rows by (optional)\n' +
      'Do not add up the sample values yourself; ask for the computation.\n\n' +
      `${sections.join('\n\n')}\n` +
      '[END TABLE SCHEMA]'
    );
  } catch (err) {
    console.warn(`[TabularProfiler] Census failed for "${fileName}":`, err.message);
    return null;
  }
};

/**
 * Compute exact statistics over columns the CALLER chose, with no assumptions
 * about what those columns mean. This is the arithmetic half of the split: the
 * model decides `value` and `group`, and this counts every row.
 *
 * @param {string} text            extracted file text
 * @param {object} opts            { valueCol, groupCol, topN } — 1-based column numbers
 * @returns {string}               result block (always a string; explains failure)
 */
const analyzeTable = (
  text,
  { valueCol = null, groupCol = null, topN = TOP_N, where = null, min = null, max = null } = {}
) => {
  if (!text) return 'No file content available to analyse.';

  const blocks = splitIntoBlocks(text);
  const parsedBlocks = blocks
    .map((b) => ({ name: b.name || 'Table', parsed: parseBlock(b.lines, b.startLine) }))
    .filter((b) => b.parsed);

  if (parsedBlocks.length === 0) return 'No table structure could be parsed from this file.';

  // where=<col>:<value> — an equality filter on any column, matched
  // case-insensitively on the trimmed cell. Substring rather than exact so a
  // status cell of "TIMEOUT (30s)" still matches where=5:TIMEOUT.
  let whereIdx = null;
  let whereValue = null;
  if (where) {
    const m = String(where).match(/^\s*(\d+)\s*[:=]\s*(.+?)\s*$/);
    if (!m) return `Could not read where="${where}". Use where=<column number>:<value>, e.g. where=5:TIMEOUT`;
    whereIdx = Number(m[1]) - 1;
    whereValue = m[2].toLowerCase();
  }

  const out = [];
  for (const { name, parsed } of parsedBlocks) {
    const { header, rows: allRows, rowLines, columns } = parsed;
    const vIdx = valueCol ? Number(valueCol) - 1 : null;
    const gIdx = groupCol ? Number(groupCol) - 1 : null;

    const bad = [];
    if (vIdx !== null && (!Number.isInteger(vIdx) || vIdx < 0 || vIdx >= columns)) bad.push(`value=${valueCol}`);
    if (gIdx !== null && (!Number.isInteger(gIdx) || gIdx < 0 || gIdx >= columns)) bad.push(`group=${groupCol}`);
    if (whereIdx !== null && (!Number.isInteger(whereIdx) || whereIdx < 0 || whereIdx >= columns)) bad.push(`where=${where}`);
    if (bad.length > 0) {
      out.push(`${name}: column out of range (${bad.join(', ')}); this table has ${columns} columns.`);
      continue;
    }

    // Row index is carried through the filter so reported positions stay
    // relative to the FILE, not to the filtered subset — otherwise READ_ROWS
    // would be sent to the wrong line.
    // Attach the physical file line so filtering cannot shift a coordinate.
    let rows = allRows.map((r, i) => { r._srcLine = rowLines[i]; return r; });
    const filters = [];

    if (whereIdx !== null) {
      rows = rows.filter((r) => String(r[whereIdx] ?? '').toLowerCase().includes(whereValue));
      filters.push(`${header[whereIdx]} contains "${whereValue}"`);
    }
    // min/max apply to the value column, which is the only one guaranteed numeric.
    if (vIdx !== null && min !== null && min !== undefined && String(min) !== '') {
      const n = Number(min);
      if (Number.isFinite(n)) {
        rows = rows.filter((r) => { const v = toNumber(r[vIdx]); return Number.isFinite(v) && v >= n; });
        filters.push(`${header[vIdx]} >= ${fmt(n)}`);
      }
    }
    if (vIdx !== null && max !== null && max !== undefined && String(max) !== '') {
      const n = Number(max);
      if (Number.isFinite(n)) {
        rows = rows.filter((r) => { const v = toNumber(r[vIdx]); return Number.isFinite(v) && v <= n; });
        filters.push(`${header[vIdx]} <= ${fmt(n)}`);
      }
    }
    if ((min !== null && min !== undefined && String(min) !== '') && vIdx === null) {
      filters.push('min/max ignored — they need value=<col#> to apply to');
    }

    if (filters.length > 0) {
      out.push(`${name}: ${fmt(rows.length)} of ${fmt(allRows.length)} rows match [${filters.join('; ')}]`);
      if (rows.length === 0) {
        out.push('  No rows matched, so nothing was computed. Check the filter value against the census.');
        continue;
      }
    } else {
      out.push(`${name}: ${fmt(rows.length)} data rows`);
    }

    if (vIdx !== null) {
      const values = rows.map((r) => toNumber(r[vIdx])).filter(Number.isFinite);
      if (values.length === 0) {
        out.push(`  column ${valueCol} "${header[vIdx]}" holds no numeric values.`);
      } else {
        const s = summarize(values);
        out.push(
          `  column ${valueCol} "${header[vIdx]}": n=${fmt(s.n)} sum=${fmt(s.total)} avg=${fmt(s.avg)} ` +
          `p50=${fmt(s.p50)} p95=${fmt(s.p95)} p99=${fmt(s.p99)} max=${fmt(s.max)}`
        );

        // _srcIndex, not the position within the filtered array: a row that is
        // 3rd among the timeouts may be row 8,412 of the file, and that is the
        // number the reader (or a follow-up READ_ROWS) needs.
        const ranked = rows
          .map((r) => ({ line: r._srcLine, v: toNumber(r[vIdx]), row: r }))
          .filter((r) => Number.isFinite(r.v))
          .sort((a, b) => b.v - a.v)
          .slice(0, topN);
        out.push(`  highest ${ranked.length} rows by that column:`);
        for (const r of ranked) {
          const context = gIdx !== null ? r.row[gIdx] : r.row.filter((_, ci) => ci !== vIdx).join(' | ');
          out.push(`    ${fmt(r.v)}  [line ${fmt(r.line)}]  ${truncate(context, 130)}`);
        }
      }
    }

    if (gIdx !== null) {
      const groups = new Map();
      for (const r of rows) {
        const raw = String(r[gIdx] ?? '').trim();
        if (!raw) continue;
        // Group SQL by shape, anything else by exact value. Without this a
        // grouped statement column produces one group per bind value.
        const key = SQL_START.test(raw) ? fingerprintSql(raw) : raw;
        let g = groups.get(key);
        if (!g) { g = { sample: raw, count: 0, sum: 0 }; groups.set(key, g); }
        g.count++;
        if (vIdx !== null) {
          const n = toNumber(r[vIdx]);
          if (Number.isFinite(n)) g.sum += n;
        }
      }

      const ordered = [...groups.values()].sort((a, b) => (vIdx !== null ? b.sum - a.sum : b.count - a.count));
      out.push(`  grouped by column ${groupCol} "${header[gIdx]}": ${fmt(groups.size)} distinct groups`);
      out.push(`  top ${Math.min(topN, ordered.length)} by ${vIdx !== null ? 'total' : 'count'}:`);
      for (const g of ordered.slice(0, topN)) {
        const total = vIdx !== null ? `total=${fmt(g.sum)} avg=${fmt(g.sum / g.count)} ` : '';
        out.push(`    ${total}count=${fmt(g.count)}  ${truncate(g.sample, 130)}`);
      }
    }

    if (vIdx === null && gIdx === null) {
      out.push('  no value or group column given — pass value=<col#> and/or group=<col#>.');
    }
  }

  return out.join('\n');
};

module.exports = {
  profileTabularContent,
  describeTable,
  analyzeTable,
  // exported for unit tests
  fingerprintSql,
  detectDelimiter,
  splitDelimited,
  parseBlock,
  ANTI_PATTERNS,
};
