/**
 * Simple TF-IDF based embedding service
 * Provides semantic embeddings without external API dependencies
 */

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1)
    .filter(word => !STOP_WORDS.has(word));
}

/**
 * Calculate term frequency
 */
function termFrequency(term: string, tokens: string[]): number {
  const count = tokens.filter(t => t === term).length;
  return count / Math.max(tokens.length, 1);
}

/**
 * Calculate inverse document frequency
 */
function inverseDocumentFrequency(term: string, allTokens: string[][]): number {
  const docsWithTerm = allTokens.filter(tokens => tokens.includes(term)).length;
  return Math.log((allTokens.length + 1) / (docsWithTerm + 1)) + 1;
}

/**
 * Generate TF-IDF vector for a document
 */
export function generateEmbedding(
  content: string,
  existingContents: string[] = []
): number[] {
  const tokens = tokenize(content);
  
  if (tokens.length === 0) {
    return new Array(VECTOR_DIM).fill(0);
  }
  
  // Build vocabulary from all documents
  const allDocs = existingContents.concat([content]);
  const allTokens = allDocs.map(tokenize);
  const vocabulary = new Map<string, number>();
  
  let vocabIndex = 0;
  for (const docTokens of allTokens) {
    for (const token of docTokens) {
      if (!vocabulary.has(token) && vocabIndex < VECTOR_DIM) {
        vocabulary.set(token, vocabIndex++);
      }
    }
  }
  
  // Create TF-IDF vector
  const vector = new Array(VECTOR_DIM).fill(0);
  
  for (const [token, index] of vocabulary.entries()) {
    const tf = termFrequency(token, tokens);
    const idf = inverseDocumentFrequency(token, allTokens);
    vector[index] = tf * idf;
  }
  
  // Normalize vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= magnitude;
    }
  }
  
  return vector;
}

/**
 * Generate embedding for a query (same process)
 */
export function generateQueryEmbedding(query: string): number[] {
  return generateEmbedding(query, []);
}

/**
 * Vector dimension for embeddings
 */
export const VECTOR_DIM = 128;

/**
 * English stop words
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'i', 'me', 'my', 'myself', 'we', 'our',
  'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it',
  'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'having', 'do', 'does', 'did', 'doing', 'would', 'should', 'could',
  'ought', 'can', 'cannot', 'could', 'may', 'might', 'must', 'need',
  'shall', 'should', 'will', 'would', 'but', 'if', 'or', 'because', 'as',
  'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'now', 'also', 'get', 'got', 'getting'
]);
