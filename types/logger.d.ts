/**
 * Logger class to handle different log levels without hijacking global console
 */
export declare class Logger {
    logLevel: string;
    pluginName: string;
    levels: Record<string, number>;
    currentLevel: number;
    constructor(logLevel?: string, pluginName?: string);
    /**
     * Format message with plugin name prefix
     */
    formatMessage(message: unknown, ...args: unknown[]): unknown[];
    /**
     * Log error messages
     */
    error(message: unknown, ...args: unknown[]): void;
    /**
     * Log warning messages
     */
    warn(message: unknown, ...args: unknown[]): void;
    /**
     * Log info messages
     */
    info(message: unknown, ...args: unknown[]): void;
    /**
     * Log debug messages
     */
    debug(message: unknown, ...args: unknown[]): void;
}
