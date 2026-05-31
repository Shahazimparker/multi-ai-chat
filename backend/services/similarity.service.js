// ============================================================
// FILE: backend/services/similarity.service.js
// PURPOSE: Determines if a new query is on the same topic as
//          the recent chat history using TF-IDF word overlap
// THRESHOLD: 0.25 = if 25%+ words overlap → same topic
// ============================================================

/**
 * tokenize — lowercase + split words, remove stop words
 */
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','to','of','in','on','at','for','with',
  'and','or','but','not','this','that','it','its','my','your',
  'our','their','we','i','you','he','she','they','what','how',
  'when','where','why','which',
]);

const tokenize = (text) =>
  text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

/**
 * jaccardSimilarity — overlap coefficient between two word sets
 * Returns 0.0 (no overlap) to 1.0 (identical)
 */
const jaccardSimilarity = (textA, textB) => {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));
  if (setA.size === 0 || setB.size === 0) return 0;

  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union        = new Set([...setA, ...setB]).size;
  return intersection / union;
};


module.exports = { jaccardSimilarity };
