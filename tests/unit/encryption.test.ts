import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  createMemory
} from '../../src/schema/memory.js';
import {
  generateEncryptionKey,
  getEncryptionKey,
  deriveKeyFromPassword,
  encrypt,
  decrypt,
  encryptWithKey,
  decryptWithKeyId,
  hashData,
  verifyIntegrity,
  generateSecureToken,
  type EncryptionKey,
  type EncryptedData
} from '../../src/utils/encryption.js';

describe('Encryption Utilities', () => {
  describe('generateEncryptionKey', () => {
    it('should generate a valid key', () => {
      const key = generateEncryptionKey();
      
      expect(key).toBeDefined();
      expect(key.key).toBeInstanceOf(Buffer);
      expect(key.key.length).toBe(32);
      expect(key.keyId).toBeDefined();
      expect(key.createdAt).toBeInstanceOf(Date);
    });

    it('should generate unique keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      
      expect(key1.key).not.toEqual(key2.key);
      expect(key1.keyId).not.toBe(key2.keyId);
    });

    it('should generate key with custom keyId', () => {
      const key = generateEncryptionKey('my-custom-key-id');
      expect(key.keyId).toBe('my-custom-key-id');
    });

    it('should store key for later retrieval', () => {
      const key = generateEncryptionKey('stored-key');
      const retrieved = getEncryptionKey('stored-key');
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.key).toEqual(key.key);
    });

    it('should return null for non-existent key', () => {
      const result = getEncryptionKey('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('deriveKeyFromPassword', () => {
    it('should derive a key from password', () => {
      const { key, salt } = deriveKeyFromPassword('test-password');
      
      expect(key).toBeInstanceOf(Buffer);
      expect(salt).toBeInstanceOf(Buffer);
      expect(key.length).toBeGreaterThan(0);
    });

    it('should derive same key for same password and salt', () => {
      const salt = Buffer.from('test-salt-fixed');
      const { key: key1 } = deriveKeyFromPassword('password', salt);
      const { key: key2 } = deriveKeyFromPassword('password', salt);
      
      expect(key1).toEqual(key2);
    });

    it('should derive different keys for different passwords', () => {
      const salt = Buffer.from('same-salt');
      const { key: key1 } = deriveKeyFromPassword('password1', salt);
      const { key: key2 } = deriveKeyFromPassword('password2', salt);
      
      expect(key1).not.toEqual(key2);
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const plaintext = 'Hello, World! This is a secret message.';
      const key = generateEncryptionKey();
      
      const encrypted = encrypt(plaintext, key.key);
      expect(encrypted).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.tag).toBeDefined();
      
      const decrypted = decrypt(encrypted, key.key);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt Unicode text', () => {
      const plaintext = '你好世界！ مرحبا 世界';
      const key = generateEncryptionKey();
      
      const encrypted = encrypt(plaintext, key.key);
      const decrypted = decrypt(encrypted, key.key);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt empty string', () => {
      const plaintext = '';
      const key = generateEncryptionKey();
      
      const encrypted = encrypt(plaintext, key.key);
      const decrypted = decrypt(encrypted, key.key);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt JSON data', () => {
      const data = {
        name: 'Test User',
        age: 30,
        preferences: ['coding', 'testing']
      };
      const plaintext = JSON.stringify(data);
      const key = generateEncryptionKey();
      
      const encrypted = encrypt(plaintext, key.key);
      const decrypted = decrypt(encrypted, key.key);
      
      expect(JSON.parse(decrypted)).toEqual(data);
    });

    it('should generate unique IVs for each encryption', () => {
      const plaintext = 'Same message';
      const key = generateEncryptionKey();
      
      const encrypted1 = encrypt(plaintext, key.key);
      const encrypted2 = encrypt(plaintext, key.key);
      
      expect(encrypted1.iv).not.toEqual(encrypted2.iv);
    });

    it('should fail to decrypt with wrong key', async () => {
      const plaintext = 'Secret message';
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      
      const encrypted = encrypt(plaintext, key1.key);
      
      expect(() => decrypt(encrypted, key2.key)).toThrow();
    });

    it('should fail to decrypt tampered data', async () => {
      const plaintext = 'Original message';
      const key = generateEncryptionKey();
      
      const encrypted = encrypt(plaintext, key.key);
      // Tamper with the ciphertext
      const tampered = Buffer.from(encrypted.ciphertext, 'base64');
      tampered[0] = tampered[0] ^ 0xFF;
      encrypted.ciphertext = tampered.toString('base64');
      
      expect(() => decrypt(encrypted, key.key)).toThrow();
    });
  });

  describe('encryptWithKey and decryptWithKeyId', () => {
    it('should encrypt with key and set keyId', () => {
      const key = generateEncryptionKey('my-key');
      const plaintext = 'Test message';
      
      const encrypted = encryptWithKey(plaintext, key);
      expect(encrypted.keyId).toBe('my-key');
    });

    it('should decrypt with keyId lookup', () => {
      const key = generateEncryptionKey('lookup-key');
      const plaintext = 'Lookup test';
      
      const encrypted = encryptWithKey(plaintext, key);
      const decrypted = decryptWithKeyId(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should return null for empty keyId', () => {
      const key = generateEncryptionKey();
      const plaintext = 'Test';
      
      const encrypted = encrypt(plaintext, key.key);
      encrypted.keyId = '';
      
      const result = decryptWithKeyId(encrypted);
      expect(result).toBeNull();
    });
  });

  describe('hashData and verifyIntegrity', () => {
    it('should hash data consistently', () => {
      const hash1 = hashData('test data');
      const hash2 = hashData('test data');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different data', () => {
      const hash1 = hashData('data1');
      const hash2 = hashData('data2');
      expect(hash1).not.toBe(hash2);
    });

    it('should verify integrity correctly', () => {
      const data = 'test data';
      const hash = hashData(data);
      
      expect(verifyIntegrity(data, hash)).toBe(true);
      expect(verifyIntegrity('tampered data', hash)).toBe(false);
    });
  });

  describe('generateSecureToken', () => {
    it('should generate token of specified length', () => {
      const token = generateSecureToken(32);
      expect(token).toHaveLength(32);
    });

    it('should generate unique tokens', () => {
      const token1 = generateSecureToken(64);
      const token2 = generateSecureToken(64);
      expect(token1).not.toBe(token2);
    });

    it('should generate default length token', () => {
      const token = generateSecureToken();
      expect(token).toHaveLength(32);
    });
  });
});
