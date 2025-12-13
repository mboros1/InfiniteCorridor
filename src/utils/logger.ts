/**
 * Functional logging abstraction layer.
 * Provides a clean interface for logging that can be injected as a dependency,
 * making functions more pure and testable.
 */

/**
 * Logger interface for dependency injection.
 * Allows functions to be pure by accepting logging as a parameter.
 */
export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * Default console logger implementation.
 * Uses console methods for logging.
 */
export const consoleLogger: Logger = {
  error: (message, ...args) => console.error(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  debug: (message, ...args) => console.debug(message, ...args),
};

/**
 * Null logger for testing or silent operation.
 * Swallows all log messages - useful for testing pure functions.
 */
export const nullLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

/**
 * Test logger that captures log messages for assertion testing.
 * Useful for verifying that appropriate logging occurs during tests.
 */
export function createTestLogger() {
  const logs: Array<{ level: string; message: string; args: unknown[] }> = [];

  const logger: Logger = {
    error: (message, ...args) => logs.push({ level: 'error', message, args }),
    warn: (message, ...args) => logs.push({ level: 'warn', message, args }),
    info: (message, ...args) => logs.push({ level: 'info', message, args }),
    debug: (message, ...args) => logs.push({ level: 'debug', message, args }),
  };

  return {
    ...logger,
    getLogs: () => [...logs],
    clearLogs: () => { logs.length = 0; },
  };
}

export type TestLogger = ReturnType<typeof createTestLogger>;

/**
 * Create a logger with a prefix for contextual logging.
 * Useful for adding module/component context to logs.
 */
export function createPrefixedLogger(prefix: string, baseLogger: Logger = consoleLogger): Logger {
  return {
    error: (message, ...args) => baseLogger.error(`[${prefix}] ${message}`, ...args),
    warn: (message, ...args) => baseLogger.warn(`[${prefix}] ${message}`, ...args),
    info: (message, ...args) => baseLogger.info(`[${prefix}] ${message}`, ...args),
    debug: (message, ...args) => baseLogger.debug(`[${prefix}] ${message}`, ...args),
  };
}