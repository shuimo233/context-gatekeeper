/**
 * Fixed-vocabulary TF-IDF embedding.
 * Unlike the original `generateEmbedding`, this uses a stable vocabulary
 * so embeddings remain comparable across documents and over time.
 */

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','has','he','in','is','it','its','of','on','that','the','to','was','will','with','i','me','my','myself','we','our','ours','ourselves','you','your','yours','yourself','yourselves','he','him','his','himself','she','her','hers','herself','it','its','itself','they','them','their','theirs','themselves','what','which','who','whom','this','that','these','those','am','is','are','was','were','be','been','being','have','has','had','having','do','does','did','doing','would','should','could','ought','can','cannot','could','may','might','must','need','shall','should','will','would','but','if','or','because','as','until','while','of','at','by','for','with','about','against','between','into','through','during','before','after','above','below','to','from','up','down','in','out','on','off','over','under','again','further','then','once','here','there','when','where','why','how','all','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','now','also','get','got','getting'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1)
    .filter(word => !STOP_WORDS.has(word));
}

function buildVocabulary(allDocs: string[]): Map<string, number> {
  const vocab = new Map<string, number>();
  let index = 0;

  for (const doc of allDocs) {
    for (const token of tokenize(doc)) {
      if (!vocab.has(token) && index < 4096) {
        vocab.set(token, index++);
      }
    }
  }

  return vocab;
}

function buildIdf(allDocs: string[]): Map<string, number> {
  const docCount = allDocs.length;
  const df = new Map<string, number>();

  for (const doc of allDocs) {
    const seen = new Set(tokenize(doc));
    for (const token of seen) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [token, docFreq] of df.entries()) {
    idf.set(token, Math.log((docCount + 1) / (docFreq + 1)) + 1);
  }

  return idf;
}

export function generateFixedEmbedding(content: string, corpus: string[] = []): number[] {
  const allDocs = [...corpus, content];
  const vocabulary = buildVocabulary(allDocs);
  const idf = buildIdf(allDocs);

  const tokens = tokenize(content);
  const vector = new Array(4096).fill(0);

  for (const token of tokens) {
    const index = vocabulary.get(token);
    if (typeof index !== 'number') continue;

    const tf = tokens.filter(t => t === token).length / tokens.length;
    const weight = idf.get(token) ?? 1;
    vector[index] = tf * weight;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= magnitude;
    }
  }

  return vector;
}

export function generateFixedQueryEmbedding(query: string): number[] {
  return generateFixedEmbedding(query);
}

export const FIXED_EMBEDDING_DIMENSION = 4096;
