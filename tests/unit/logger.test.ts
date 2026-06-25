/**
 * Logger Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, logger, createLogger } from '../../src/utils/logger.js';

describe('Logger', () => {
  let outputData: string[] = [];
  let originalEnv: NodeJS.ProcessEnv;

  const mockStdout = {
    write: vi.fn((data: string) => {
      outputData.push(data);
      return true;
    }),
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
    outputData = [];
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env },
      stdout: mockStdout as NodeJS.WriteStream & { write: (data: string) => boolean },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('log level filtering', () => {
    it('should filter logs below the minimum level', () => {
      process.env.CG_LOG_LEVEL = 'warn';

      const testLogger = new Logger();
      testLogger.info('This should not appear');
      testLogger.warn('This should appear');

      expect(outputData.length).toBe(1);
      expect(outputData[0]).toContain('"level":"warn"');
    });

    it('should log all levels at trace when set', () => {
      process.env.CG_LOG_LEVEL = 'trace';

      const testLogger = new Logger();
      testLogger.trace('trace message');
      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(outputData.length).toBe(5);
    });

    it('should default to info level', () => {
      delete process.env.CG_LOG_LEVEL;

      const testLogger = new Logger();
      testLogger.debug('debug should not appear');
      testLogger.info('info should appear');

      expect(outputData.length).toBe(1);
      expect(outputData[0]).toContain('"level":"info"');
    });

    it('should handle invalid log level gracefully', () => {
      process.env.CG_LOG_LEVEL = 'invalid_level';

      const testLogger = new Logger();
      testLogger.info('info should appear');

      expect(outputData.length).toBe(1);
    });
  });

  describe('JSON format correctness', () => {
    it('should output valid JSON', () => {
      const testLogger = new Logger();
      testLogger.info('test message');

      const output = outputData[0].trim();
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should include required fields', () => {
      const testLogger = new Logger();
      testLogger.info('test message');

      const output = JSON.parse(outputData[0].trim());
      expect(output).toHaveProperty('level', 'info');
      expect(output).toHaveProperty('timestamp');
      expect(output).toHaveProperty('message', 'test message');
    });

    it('should include ISO timestamp', () => {
      const testLogger = new Logger();
      testLogger.info('test');

      const output = JSON.parse(outputData[0].trim());
      expect(output.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it('should include optional data fields', () => {
      const testLogger = new Logger();
      testLogger.info('test', { tool: 'memory_store', latencyMs: 42 });

      const output = JSON.parse(outputData[0].trim());
      expect(output.data).toEqual({ tool: 'memory_store', latencyMs: 42 });
    });

    it('should handle tool field in data', () => {
      const testLogger = new Logger();
      testLogger.info('Tool completed', { tool: 'memory_store', success: true });

      const output = JSON.parse(outputData[0].trim());
      expect(output.data).toHaveProperty('tool', 'memory_store');
      expect(output.data).toHaveProperty('success', true);
    });
  });

  describe('error serialization', () => {
    it('should serialize Error objects correctly', () => {
      const testLogger = new Logger();
      const error = new Error('test error message');
      testLogger.error('Operation failed', error);

      const output = JSON.parse(outputData[0].trim());
      expect(output.data).toHaveProperty('name', 'Error');
      expect(output.data).toHaveProperty('message', 'test error message');
      expect(output.data).toHaveProperty('stack');
    });

    it('should serialize custom error properties', () => {
      const testLogger = new Logger();
      const error = new Error('db error');
      (error as unknown as Record<string, unknown>).code = 'DB_ERROR';
      (error as unknown as Record<string, unknown>).table = 'memories';
      testLogger.error('Database error', error);

      const output = JSON.parse(outputData[0].trim());
      expect(output.data).toHaveProperty('code', 'DB_ERROR');
      expect(output.data).toHaveProperty('table', 'memories');
    });

    it('should handle non-Error values in error field', () => {
      const testLogger = new Logger();
      testLogger.error('Something went wrong', 'string error' as unknown);

      const output = JSON.parse(outputData[0].trim());
      expect(output.data).toHaveProperty('error');
      expect(output.data.error).toHaveProperty('message', 'string error');
    });

    it('should handle plain objects as error data', () => {
      const testLogger = new Logger();
      const errorData = { code: 'ENOTFOUND', statusCode: 404 };
      testLogger.error('Request failed', errorData);

      const output = JSON.parse(outputData[0].trim());
      expect(output.data).toHaveProperty('code', 'ENOTFOUND');
      expect(output.data).toHaveProperty('statusCode', 404);
    });
  });

  describe('fallback to plain text on serialization failure', () => {
    it('should handle circular references gracefully', () => {
      const testLogger = new Logger();
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      testLogger.info('circular test', { obj: circular });

      const output = outputData[0].trim();
      expect(output).toBeDefined();
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('pretty printing', () => {
    it('should pretty print when CG_LOG_PRETTY is set', () => {
      process.env.CG_LOG_PRETTY = 'true';

      const testLogger = new Logger();
      testLogger.info('pretty', { key: 'value' });

      expect(outputData[0]).toContain('\n');
      expect(outputData[0]).toContain('  "key"');
    });

    it('should not pretty print when CG_LOG_PRETTY is not set', () => {
      delete process.env.CG_LOG_PRETTY;

      const testLogger = new Logger();
      testLogger.info('compact', { key: 'value' });

      const output = outputData[0].trim();
      expect(output).not.toContain('\n');
      expect(output).toContain('{"level":"info"');
    });
  });

  describe('component loggers', () => {
    it('should add component to data when created with component name', () => {
      const testLogger = createLogger('memory-service');
      testLogger.info('test');

      const output = JSON.parse(outputData[0].trim());
      expect(output.data).toHaveProperty('component', 'memory-service');
    });

    it('should not add component field when not specified', () => {
      const testLogger = new Logger();
      testLogger.info('test');

      const output = JSON.parse(outputData[0].trim());
      expect(output.data).toBeUndefined();
    });
  });

  describe('default logger export', () => {
    it('should export a usable default logger', () => {
      expect(logger).toBeInstanceOf(Logger);
      expect(() => logger.info('test')).not.toThrow();
      expect(outputData.length).toBe(1);
    });
  });

  describe('file-based logging', () => {
    it('should not write to file when CG_LOG_TO_FILE is not set', async () => {
      delete process.env.CG_LOG_TO_FILE;

      const testLogger = new Logger();
      testLogger.info('stdout only');

      expect(outputData.length).toBe(1);
    });

    it('should output compact JSON by default', () => {
      delete process.env.CG_LOG_PRETTY;

      const testLogger = new Logger();
      testLogger.info('default format', { a: 1, b: 2 });

      const output = outputData[0].trim();
      const parsed = JSON.parse(output);
      expect(parsed.data).toEqual({ a: 1, b: 2 });
    });
  });
});
