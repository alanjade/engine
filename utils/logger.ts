const ts = (): string => new Date().toISOString();

export const log = (...a: unknown[]): void => console.log(`[${ts()}] [INFO]`, ...a);
export const warn = (...a: unknown[]): void => console.warn(`[${ts()}] [WARN]`, ...a);
export const err = (...a: unknown[]): void => console.error(`[${ts()}] [ERR] `, ...a);