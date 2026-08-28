// Column census + on-demand computation.
//
// The diagnostic profile infers what a column MEANS from a header vocabulary.
// That vocabulary is a dictionary, so it misses any header it was not taught —
// another language, an abbreviation, a domain nobody anticipated. These tests
// cover the path that does not depend on it: the census states raw facts and
// claims no meaning, the model decides which columns matter, and analyzeTable
// does the arithmetic over every row.

const { describeTable, analyzeTable } = require('../../services/tabularProfiler.service');

/** A Japanese sales export: nothing here matches the header vocabulary. */
const japaneseSales = () => {
  const rows = ['[Sheet: 売上]', '日付,商品コード,処理時間,数量,担当'];
  for (let i = 0; i < 200; i++) {
    rows.push(`2026-08-0${1 + (i % 9)},SKU-${i % 20},${2 + (i % 5)},${1 + (i % 7)},佐藤`);
  }
  rows.push('2026-08-09,SKU-99,98750,3,田中');
  return rows.join('\n');
};

/** Cryptic headers, no vocabulary match at all. */
const crypticTable = () => {
  const rows = ['F1,F2,F3'];
  for (let i = 0; i < 60; i++) rows.push(`row-${i},grp-${i % 4},${i === 0 ? 5000 : 3 + (i % 4)}`);
  return rows.join('\n');
};

describe('describeTable — states facts, not meaning', () => {
  const census = describeTable(japaneseSales(), '売上.xlsx');

  it('describes a file whose headers match no known vocabulary', () => {
    expect(census).toBeTruthy();
    expect(census).toContain('TABLE SCHEMA');
    expect(census).toContain('日付');
    expect(census).toContain('処理時間');
  });

  it('says explicitly that no meaning is assumed', () => {
    expect(census).toContain('NO meaning is assumed');
  });

  it('types numeric columns and reports their real range', () => {
    expect(census).toMatch(/処理時間.*number/);
    expect(census).toContain('max 98,750');
  });

  it('does not type an identifier column as a date', () => {
    // Date.parse("SKU-0") is lenient enough to succeed; the census must not
    // rely on it, or a product-code column is reported as datetime.
    expect(census).toMatch(/商品コード.*text/);
  });

  it('lists the values of a small-cardinality column outright', () => {
    expect(census).toContain('佐藤 (200)');
    expect(census).toContain('田中 (1)');
  });

  it('tells the model to compute rather than add up samples itself', () => {
    expect(census).toContain('ANALYZE_TABLE');
    expect(census).toContain('Do not add up the sample values yourself');
  });

  it('works with cryptic positional headers', () => {
    const c = describeTable(crypticTable(), 'x.csv');
    expect(c).toContain('F3');
    expect(c).toContain('number');
  });

  it('returns null when there is no table at all', () => {
    expect(describeTable('just a sentence, nothing tabular here at all', 'x.txt')).toBeNull();
  });
});

describe('analyzeTable — exact arithmetic over chosen columns', () => {
  const text = japaneseSales();

  it('summarises the column the caller chose, with no assumption about it', () => {
    const out = analyzeTable(text, { valueCol: 3 });
    expect(out).toContain('処理時間');
    expect(out).toContain('n=201');
    expect(out).toContain('max=98,750');
  });

  it('ranks the highest rows by that column', () => {
    const out = analyzeTable(text, { valueCol: 3, groupCol: 2, topN: 3 });
    expect(out).toContain('98,750');
    expect(out).toContain('SKU-99');
  });

  it('groups by the column the caller chose', () => {
    const out = analyzeTable(text, { valueCol: 3, groupCol: 5 });
    expect(out).toContain('grouped by column 5');
    // Column 5 holds two names, so grouping by it must yield two groups —
    // not the 21 that grouping by the product code would give.
    expect(out).toContain('2 distinct groups');
    expect(out).toContain('count=200');
  });

  it('groups SQL by shape so bind values do not split one statement', () => {
    const rows = ['Stmt,Ms'];
    for (let i = 0; i < 40; i++) rows.push(`SELECT a FROM t WHERE id = ${i},3`);
    rows.push('SELECT * FROM big ORDER BY x,9000');
    const out = analyzeTable(rows.join('\n'), { valueCol: 2, groupCol: 1 });
    expect(out).toContain('2 distinct groups');
    expect(out).toContain('count=40');
  });

  it('reports a column number that does not exist rather than guessing', () => {
    expect(analyzeTable(text, { valueCol: 99 })).toContain('out of range');
  });

  it('says so when the chosen column holds no numbers', () => {
    expect(analyzeTable(text, { valueCol: 5 })).toContain('no numeric values');
  });

  it('asks for arguments when given none', () => {
    expect(analyzeTable(text, {})).toContain('no value or group column given');
  });

  it('handles an unparseable file without throwing', () => {
    expect(analyzeTable('not a table', { valueCol: 1 })).toContain('No table structure');
    expect(analyzeTable('', { valueCol: 1 })).toContain('No file content');
  });
});
