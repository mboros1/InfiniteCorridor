/**
 * Tests for the logging system
 */

import { expect, test, describe } from 'bun:test';
import { consoleLogger, nullLogger, createTestLogger, createPrefixedLogger } from '../logger.js';

describe('Logger System', () => {
  
  describe('consoleLogger', () => {
    
    test('should have all required logger methods', () => {
      expect(consoleLogger).toHaveProperty('error');
      expect(consoleLogger).toHaveProperty('warn');
      expect(consoleLogger).toHaveProperty('info');
      expect(consoleLogger).toHaveProperty('debug');
      
      expect(typeof consoleLogger.error).toBe('function');
      expect(typeof consoleLogger.warn).toBe('function');
      expect(typeof consoleLogger.info).toBe('function');
      expect(typeof consoleLogger.debug).toBe('function');
    });

    test('should not throw when calling methods', () => {
      expect(() => consoleLogger.error('test error')).not.toThrow();
      expect(() => consoleLogger.warn('test warn')).not.toThrow();
      expect(() => consoleLogger.info('test info')).not.toThrow();
      expect(() => consoleLogger.debug('test debug')).not.toThrow();
    });
  });

  describe('nullLogger', () => {
    
    test('should have all required logger methods', () => {
      expect(nullLogger).toHaveProperty('error');
      expect(nullLogger).toHaveProperty('warn');
      expect(nullLogger).toHaveProperty('info');
      expect(nullLogger).toHaveProperty('debug');
    });

    test('should be silent (no-op functions)', () => {
      // These should not throw and should not produce any output
      expect(() => nullLogger.error('test error')).not.toThrow();
      expect(() => nullLogger.warn('test warn')).not.toThrow();
      expect(() => nullLogger.info('test info')).not.toThrow();
      expect(() => nullLogger.debug('test debug')).not.toThrow();
    });
  });

  describe('createTestLogger', () => {
    
    test('should create logger with getLogs method', () => {
      const testLogger = createTestLogger();
      
      expect(testLogger).toHaveProperty('error');
      expect(testLogger).toHaveProperty('warn');
      expect(testLogger).toHaveProperty('info');
      expect(testLogger).toHaveProperty('debug');
      expect(testLogger).toHaveProperty('getLogs');
      expect(testLogger).toHaveProperty('clearLogs');
    });

    test('should capture log messages', () => {
      const testLogger = createTestLogger();
      
      testLogger.error('test error');
      testLogger.warn('test warn');
      testLogger.info('test info');
      testLogger.debug('test debug');
      
      const logs = testLogger.getLogs();
      
      expect(logs).toHaveLength(4);
      expect(logs[0].level).toBe('error');
      expect(logs[0].message).toBe('test error');
      expect(logs[1].level).toBe('warn');
      expect(logs[1].message).toBe('test warn');
      expect(logs[2].level).toBe('info');
      expect(logs[2].message).toBe('test info');
      expect(logs[3].level).toBe('debug');
      expect(logs[3].message).toBe('test debug');
    });

    test('should capture log messages with context', () => {
      const testLogger = createTestLogger();
      
      testLogger.error('test error', { detail: 'context' });
      testLogger.warn('test warn', { number: 42 });
      
      const logs = testLogger.getLogs();
      
      expect(logs[0].args).toEqual([{ detail: 'context' }]);
      expect(logs[1].args).toEqual([{ number: 42 }]);
    });

    test('should clear logs when clearLogs is called', () => {
      const testLogger = createTestLogger();
      
      testLogger.error('test error');
      testLogger.warn('test warn');
      
      let logs = testLogger.getLogs();
      expect(logs).toHaveLength(2);
      
      testLogger.clearLogs();
      
      logs = testLogger.getLogs();
      expect(logs).toHaveLength(0);
    });

    test('should return new array from getLogs to prevent mutation', () => {
      const testLogger = createTestLogger();
      
      testLogger.error('test error');
      
      const logs1 = testLogger.getLogs();
      const logs2 = testLogger.getLogs();
      
      expect(logs1).toEqual(logs2);
      expect(logs1).not.toBe(logs2); // Different array instances
      
      logs1.push({ level: 'fake', message: 'fake' } as any);
      
      const logs3 = testLogger.getLogs();
      expect(logs3).toHaveLength(1); // Original logs unchanged
    });
  });

  describe('createPrefixedLogger', () => {
    
    test('should create logger with prefix', () => {
      const prefixedLogger = createPrefixedLogger('TEST');
      
      expect(prefixedLogger).toHaveProperty('error');
      expect(prefixedLogger).toHaveProperty('warn');
      expect(prefixedLogger).toHaveProperty('info');
      expect(prefixedLogger).toHaveProperty('debug');
    });

    test('should add prefix to log messages', () => {
      const testLogger = createTestLogger();
      const prefixedLogger = createPrefixedLogger('TEST', testLogger);
      
      prefixedLogger.error('test error');
      prefixedLogger.warn('test warn');
      
      const logs = testLogger.getLogs();
      
      expect(logs[0].message).toBe('[TEST] test error');
      expect(logs[1].message).toBe('[TEST] test warn');
    });

    test('should use console logger by default', () => {
      const prefixedLogger = createPrefixedLogger('TEST');
      
      // Should not throw
      expect(() => prefixedLogger.error('test error')).not.toThrow();
      expect(() => prefixedLogger.warn('test warn')).not.toThrow();
    });

    test('should handle empty prefix', () => {
      const testLogger = createTestLogger();
      const prefixedLogger = createPrefixedLogger('', testLogger);
      
      prefixedLogger.error('test error');
      
      const logs = testLogger.getLogs();
      expect(logs[0].message).toBe('[] test error'); // Empty prefix results in []
    });
  });

  describe('Logger Interface Compliance', () => {
    
    test('all loggers should implement Logger interface', () => {
      const loggers = [consoleLogger, nullLogger, createTestLogger()];
      
      loggers.forEach(logger => {
        expect(logger).toHaveProperty('error');
        expect(logger).toHaveProperty('warn');
        expect(logger).toHaveProperty('info');
        expect(logger).toHaveProperty('debug');
        
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.debug).toBe('function');
      });
    });

    test('all logger methods should accept variable arguments', () => {
      const loggers = [consoleLogger, nullLogger, createTestLogger()];
      
      loggers.forEach(logger => {
        expect(() => logger.error('message')).not.toThrow();
        expect(() => logger.error('message', { context: 'test' })).not.toThrow();
        expect(() => logger.error('message', { context: 'test' }, 'extra')).not.toThrow();
        
        expect(() => logger.warn('message')).not.toThrow();
        expect(() => logger.info('message')).not.toThrow();
        expect(() => logger.debug('message')).not.toThrow();
      });
    });
  });
});