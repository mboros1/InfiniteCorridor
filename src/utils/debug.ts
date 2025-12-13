function envFlag(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function isDebugEnabled(): boolean {
  return envFlag('IC_DEBUG') || envFlag('DEBUG');
}

export function debugLog(...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  console.log(...args);
}

