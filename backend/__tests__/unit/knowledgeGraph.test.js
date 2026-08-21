// ============================================================
// FILE: backend/__tests__/unit/knowledgeGraph.test.js
// PURPOSE: Entity/relation extraction for GraphRAG.
//
//   The risk here is a graph that looks richer than the source. An edge
//   pointing at an entity that was never declared, a self-loop, or a relation
//   the model inferred rather than read all produce confident nonsense at
//   query time — traversal will happily walk a fabricated edge and return the
//   chunk behind it as evidence.
// ============================================================

const dispatcher = require('../../services/ai/dispatcher.service');
const graph = require('../../services/knowledgeGraph.service');

const ENV_SNAPSHOT = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ENV_SNAPSHOT };
  process.env.MISTRAL_SUMMARY_API_KEY = 'test-mistral';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
});

afterEach(() => { process.env = { ...ENV_SNAPSHOT }; });

const reply = (obj, tokensUsed = 150) => ({
  text: typeof obj === 'string' ? obj : JSON.stringify(obj),
  tokensUsed,
});

const VALID = {
  entities: [
    { name: 'Decision shape', type: 'concept', description: 'A diamond node' },
    { name: 'mxgraph.flowchart.decision', type: 'code', description: 'Style string' },
  ],
  relations: [
    { source: 'Decision shape', target: 'mxgraph.flowchart.decision', relation: 'has style' },
  ],
};

describe('normalizeName', () => {
  it('collapses case and whitespace', () => {
    expect(graph.normalizeName('  Decision   Shape ')).toBe('decision shape');
    expect(graph.normalizeName('DECISION SHAPE')).toBe('decision shape');
  });

  it('keeps identifiers intact', () => {
    // Dots and underscores carry meaning in a style string or error code;
    // stripping them would merge distinct entities.
    expect(graph.normalizeName('mxgraph.flowchart.decision')).toBe('mxgraph.flowchart.decision');
    expect(graph.normalizeName('ERR_STREAM_7742')).toBe('err_stream_7742');
  });

  it('trims surrounding punctuation only', () => {
    expect(graph.normalizeName('"Decision shape".')).toBe('decision shape');
  });

  it('handles empty input', () => {
    expect(graph.normalizeName(null)).toBe('');
    expect(graph.normalizeName('')).toBe('');
  });
});

describe('parseExtraction', () => {
  it('parses clean JSON', () => {
    expect(graph.parseExtraction(JSON.stringify(VALID)).entities).toHaveLength(2);
  });

  it('recovers JSON from a code fence', () => {
    const fenced = '```json\n' + JSON.stringify(VALID) + '\n```';
    expect(graph.parseExtraction(fenced).relations).toHaveLength(1);
  });

  it('recovers JSON wrapped in prose', () => {
    const wrapped = 'Here is the extraction:\n' + JSON.stringify(VALID) + '\nHope that helps!';
    expect(graph.parseExtraction(wrapped).entities).toHaveLength(2);
  });

  it('returns null on unparseable output', () => {
    expect(graph.parseExtraction('I could not find any entities.')).toBeNull();
    expect(graph.parseExtraction('')).toBeNull();
  });

  it('tolerates missing arrays', () => {
    const parsed = graph.parseExtraction('{"entities":[{"name":"A"}]}');
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.relations).toEqual([]);
  });
});

describe('extractFromChunk', () => {
  it('returns the entities and relations the passage states', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply(VALID));

    const res = await graph.extractFromChunk('some passage', { documentTitle: 'Doc.md' });

    expect(res.entities).toHaveLength(2);
    expect(res.relations).toHaveLength(1);
    expect(res.tokensUsed).toBe(150);
  });

  it('drops a relation whose endpoint was never declared as an entity', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply({
      entities: [{ name: 'Decision shape' }],
      relations: [{ source: 'Decision shape', target: 'Swimlane', relation: 'appears in' }],
    }));

    const res = await graph.extractFromChunk('passage');

    // Traversal would otherwise walk an edge to a node that does not exist.
    expect(res.relations).toEqual([]);
  });

  it('drops self-referential relations', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply({
      entities: [{ name: 'Decision shape' }],
      relations: [{ source: 'Decision shape', target: 'decision  SHAPE', relation: 'is' }],
    }));

    // A self-loop adds no reachability and inflates the chunk's graph score.
    expect((await graph.extractFromChunk('passage')).relations).toEqual([]);
  });

  it('caps how much it will accept from one chunk', async () => {
    process.env.GRAPHRAG_MAX_ENTITIES = '3';
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Entity ${i}` }));
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply({ entities: many, relations: [] }));

    expect((await graph.extractFromChunk('passage')).entities).toHaveLength(3);
  });

  it('never offers the chat tool schema', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply(VALID));
    await graph.extractFromChunk('passage');
    expect(dispatch.mock.calls[0][3]).toEqual({ disableTools: true });
  });

  it('falls through to the paid model when the free one fails', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI')
      .mockRejectedValueOnce(new Error('mistral down'))
      .mockResolvedValueOnce(reply(VALID));

    const res = await graph.extractFromChunk('passage');

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(res.entities).toHaveLength(2);
  });

  it('tries the next model when one returns unparseable JSON', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI')
      .mockResolvedValueOnce(reply('sorry, no JSON here'))
      .mockResolvedValueOnce(reply(VALID));

    const res = await graph.extractFromChunk('passage');

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(res.entities).toHaveLength(2);
  });

  it('reports failure rather than a partial graph when every model fails', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(new Error('all down'));

    const res = await graph.extractFromChunk('passage');

    expect(res.failed).toBe(true);
    expect(res.entities).toEqual([]);
  });

  it('propagates cancellation', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    await expect(graph.extractFromChunk('passage')).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('entity types', () => {
  it('accepts the closed vocabulary', () => {
    for (const t of graph.ENTITY_TYPES) expect(graph.coerceType(t)).toBe(t);
  });

  it('coerces an invented type to "other" rather than storing it', () => {
    // Left open, the model produced 30 distinct types across 90 entities in a
    // real run, which makes the column useless for filtering.
    expect(graph.coerceType('ShapeType')).toBe('other');
    expect(graph.coerceType('AWS resource or group')).toBe('other');
    expect(graph.coerceType(null)).toBe('other');
  });

  it('normalises case and separators before matching', () => {
    expect(graph.coerceType('TECHNOLOGY')).toBe('technology');
    expect(graph.coerceType(' Person ')).toBe('person');
  });

  it('names the allowed types in the prompt', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply(VALID));
    await graph.extractFromChunk('passage');
    const prompt = dispatch.mock.calls[0][1][0].content;
    for (const t of graph.ENTITY_TYPES) expect(prompt).toContain(t);
  });
});

describe('configuration', () => {
  it('leads with the free-quota model', () => {
    expect(graph.extractionChain()[0].provider).toBe('mistral');
  });

  it('reads env per call', () => {
    process.env.GRAPHRAG_MAX_ENTITIES = '11';
    expect(graph.cfg().maxEntitiesPerChunk).toBe(11);
  });

  it('can be disabled', () => {
    process.env.GRAPHRAG_ENABLED = 'false';
    expect(graph.isEnabled()).toBe(false);
  });
});
