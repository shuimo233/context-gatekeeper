/**
 * Structured JSON Logger
 *
 * Features:
 * - JSON output to stdout with configurable log levels
 * - CG_LOG_LEVEL env var controls minimum level (trace, debug, info, warn, error)
 * - CG_LOG_PRETTY env var enables pretty-printed output
 * - CG_LOG_TO_FILE env var enables file-based logging
 * - CG_LOG_FILE_PATH env var for custom file path
 * - Graceful degradation on serialization failure
 */

import { appendFileSync } from 'fs';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const DEFAULT_LEVEL: LogLevel = 'info';

function parseLogLevel(envValue: string | undefined): LogLevel {
  if (!envValue) return DEFAULT_LEVEL;
  const level = envValue.toLowerCase() as LogLevel;
  return LOG_LEVELS[level] !== undefined ? level : DEFAULT_LEVEL;
}

function getMinLevel(): LogLevel {
  return parseLogLevel(process.env.CG_LOG_LEVEL);
}

function isPrettyPrint(): boolean {
  return process.env.CG_LOG_PRETTY === 'true' || process.env.CG_LOG_PRETTY === '1';
}

function getLogFilePath(): string | null {
  if (process.env.CG_LOG_TO_FILE !== 'true' && process.env.CG_LOG_TO_FILE !== '1') {
    return null;
  }
  return process.env.CG_LOG_FILE_PATH || 'context-gatekeeper.log';
}

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  tool?: string;
  memoryId?: string;
  latencyMs?: number;
  data?: Record<string, unknown>;
  error?: SerializedError;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: 'Error',
    message: String(error),
  };
}

function serializeErrorForData(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...Object.getOwnPropertyNames(error).reduce((acc, key) => {
        try {
          (acc as Record<string, unknown>)[key] = (error as unknown as Record<string, unknown>)[key];
        } catch {
          // Skip non-serializable properties
        }
        return acc;
      }, {} as Record<string, unknown>),
    };
  }
  return { value: String(error) };
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getMinLevel()];
}

function formatJson(entry: LogEntry, pretty: boolean): string {
  try {
    if (pretty) {
      return JSON.stringify(entry, null, 2);
    }
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message: 'Failed to serialize log entry',
      data: { originalMessage: entry.message },
    });
  }
}

function output(line: string): void {
  const filePath = getLogFilePath();

  if (filePath) {
    try {
      appendFileSync(filePath, line + '\n');
    } catch {
      // Fallback to stdout on file write failure
      process.stdout.write(line + '\n');
    }
  } else {
    process.stdout.write(line + '\n');
  }
}

export class Logger {
  private component?: string;

  constructor(component?: string) {
    this.component = component;
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
    };

    if (this.component) {
      entry.data = { ...data, component: this.component };
    } else if (data) {
      entry.data = data;
    }

    const pretty = isPrettyPrint();
    output(formatJson(entry, pretty));
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.log('trace', message, data);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, dataOrError?: Record<string, unknown> | unknown): void {
    const data: Record<string, unknown> = {};
    let extra: Record<string, unknown> | undefined;

    if (dataOrError instanceof Error || (dataOrError && typeof dataOrError === 'object')) {
      if (dataOrError instanceof Error) {
        data.error = serializeError(dataOrError);
        extra = serializeErrorForData(dataOrError);
      } else {
        extra = dataOrError as Record<string, unknown>;
      }
    } else if (dataOrError) {
      data.error = serializeError(dataOrError);
    }

    const mergedData = extra ? { ...extra, ...data } : data;
    this.log('error', message, Object.keys(mergedData).length > 0 ? mergedData : undefined);
  }

  /** Log a tool invocation with timing */
  toolInvocation(
    toolName: string,
    latencyMs: number,
    success: boolean,
    error?: unknown
  ): void {
    const data: Record<string, unknown> = {
      tool: toolName,
      latencyMs,
      success,
    };

    if (error) {
      data.error = serializeErrorForData(error);
    }

    const level: LogLevel = success ? 'info' : 'error';
    this.log(level, `Tool invocation: ${toolName}`, data);
  }
}

// Default logger instance
export const logger = new Logger();

// Factory function for component-specific loggers
export function createLogger(component: string): Logger {
  return new Logger(component);
}
