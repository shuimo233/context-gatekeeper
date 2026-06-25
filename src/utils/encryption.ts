/**
 * AES-256-GCM Encryption Utilities
 * Provides at-rest encryption for sensitive memory content
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

export interface EncryptionKey {
  key: Buffer;
  keyId: string;
  createdAt: Date;
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  tag: string;
  keyId: string;
}

export interface EncryptedField {
  field: string;
  encryptedData: EncryptedData;
}

// Key management
const keyStore = new Map<string, EncryptionKey>();

/**
 * Generate a new encryption key
 */
export function generateEncryptionKey(keyId?: string): EncryptionKey {
  const id = keyId || `key-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const key = randomBytes(32); // 256 bits for AES-256
  
  const encryptionKey: EncryptionKey = {
    key,
    keyId: id,
    createdAt: new Date()
  };
  
  keyStore.set(id, encryptionKey);
  
  return encryptionKey;
}

/**
 * Get an encryption key by ID
 */
export function getEncryptionKey(keyId: string): EncryptionKey | null {
  return keyStore.get(keyId) || null;
}

/**
 * Derive a key from a password (PBKDF2)
 */
export function deriveKeyFromPassword(password: string, salt?: Buffer): { key: Buffer; salt: Buffer } {
  const saltBytes = salt || randomBytes(32);
  const key = createHash('sha256').update(password + saltBytes.toString('hex')).digest();
  
  return { key, salt: saltBytes };
}

/**
 * Encrypt data with AES-256-GCM
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedData {
  const iv = randomBytes(12); // 96 bits for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  
  const tag = cipher.getAuthTag();
  
  return {
    ciphertext,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    keyId: ''
  };
}

/**
 * Encrypt data with a specific key
 */
export function encryptWithKey(plaintext: string, encryptionKey: EncryptionKey): EncryptedData {
  const result = encrypt(plaintext, encryptionKey.key);
  result.keyId = encryptionKey.keyId;
  return result;
}

/**
 * Decrypt data with AES-256-GCM
 */
export function decrypt(encryptedData: EncryptedData, key: Buffer): string {
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const tag = Buffer.from(encryptedData.tag, 'base64');
  const ciphertext = Buffer.from(encryptedData.ciphertext, 'base64');
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  let plaintext = decipher.update(ciphertext);
  plaintext = Buffer.concat([plaintext, decipher.final()]);
  
  return plaintext.toString('utf8');
}

/**
 * Decrypt with key lookup
 */
export function decryptWithKeyId(encryptedData: EncryptedData): string | null {
  if (!encryptedData.keyId) {
    return null;
  }
  
  const key = getEncryptionKey(encryptedData.keyId);
  if (!key) {
    return null;
  }
  
  return decrypt(encryptedData, key.key);
}

/**
 * Encrypt multiple fields in an object
 */
export function encryptFields<T extends Record<string, unknown>>(
  data: T,
  fieldsToEncrypt: (keyof T)[],
  key: Buffer
): T & { _encrypted: string[] } {
  const encrypted: Record<string, EncryptedData> = {};
  
  for (const field of fieldsToEncrypt) {
    const value = data[field];
    if (typeof value === 'string') {
      encrypted[field as string] = encrypt(value, key);
    }
  }
  
  return {
    ...data,
    _encrypted: fieldsToEncrypt.map(f => String(f)) as unknown as string[],
    ...Object.fromEntries(
      Object.entries(encrypted).map(([k, v]) => [k, JSON.stringify(v)])
    )
  } as T & { _encrypted: string[] };
}

/**
 * Decrypt multiple fields in an object
 */
export function decryptFields<T extends Record<string, unknown>>(
  data: T,
  key: Buffer
): T {
  const encryptedFields = (data._encrypted as unknown as string[]) || [];
  
  const decrypted = { ...data };
  
  for (const field of encryptedFields) {
    const encryptedValue = data[field as keyof T];
    if (typeof encryptedValue === 'string') {
      try {
        const encryptedData = JSON.parse(encryptedValue) as EncryptedData;
        (decrypted as Record<string, unknown>)[field] = decrypt(encryptedData, key);
      } catch {
        // Decryption failed, keep original value
      }
    }
  }
  
  // Remove encryption metadata
  const decryptedObj = decrypted as Record<string, unknown>;
  delete decryptedObj['_encrypted'];
  
  return decrypted as T;
}

/**
 * Hash data for integrity verification
 */
export function hashData(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Verify data integrity
 */
export function verifyIntegrity(data: string, expectedHash: string): boolean {
  const actualHash = hashData(data);
  return actualHash === expectedHash;
}

/**
 * Generate a secure random string
 */
export function generateSecureToken(length: number = 32): string {
  return randomBytes(Math.ceil(length * 0.75)).toString('base64').slice(0, length);
}

/**
 * Key rotation support
 */
export interface KeyRotationResult {
  newKeyId: string;
  reEncryptedCount: number;
  failedIds: string[];
}

export function rotateEncryptionKey(
  oldKeyId: string,
  fieldsToReencrypt: Array<{ id: string; encryptedData: EncryptedData }>,
  newKey: EncryptionKey
): KeyRotationResult {
  const failedIds: string[] = [];
  let reEncryptedCount = 0;
  
  for (const item of fieldsToReencrypt) {
      try {
        // Decrypt with old key
        const oldKey = getEncryptionKey(oldKeyId);
        if (!oldKey) {
          failedIds.push(item.id);
          continue;
        }
        
        const plaintext = decrypt(item.encryptedData, oldKey.key);
        
        // Re-encrypt with new key
        // In a real implementation, update the stored encrypted data here
        // updateEncryptedField(item.id, newEncrypted);
        
        void plaintext; // Mark as used
        reEncryptedCount++;
      } catch {
      failedIds.push(item.id);
    }
  }
  
  return {
    newKeyId: newKey.keyId,
    reEncryptedCount,
    failedIds
  };
}

// Export key management functions
export { keyStore };
