import { MemoryService } from '../services/memory.js';

export type { MemoryService } from '../services/memory.js';
export { exportUserData, deleteUserData, anonymizeUserData, getUserDataSummary, hasUserData, generateDataProcessingReport, type GDPRExport, type GDPRDeleteResult } from './gdpr.js';
export { getMultiAgentSharingService } from '../services/multi-agent-sharing.js';
export { encrypt, decrypt, encryptWithKey, decryptWithKeyId, generateEncryptionKey, deriveKeyFromPassword, type EncryptedData } from '../utils/encryption.js';

export function createMemoryService(): MemoryService {
  return new MemoryService();
}
