const DEFAULT_PLUGIN_NAME = 'vite-plugin-sri4'

/**
 * Logger class to handle different log levels without hijacking global console
 */
export class Logger {
  logLevel: string
  pluginName: string
  levels: Record<string, number>
  currentLevel: number

  // `logLevel` is deliberately `string` rather than `SriLogLevel`: the published
  // type narrows it, but a plain JS `vite.config.js` gets no checking at all,
  // and the fallback below is the only thing between a typo and output going to
  // the wrong level. Same reasoning as `validateOptions` in index.ts.
  constructor(logLevel: string = 'warn', pluginName: string = DEFAULT_PLUGIN_NAME) {
    this.logLevel = logLevel
    this.pluginName = pluginName
    this.levels = {
      silent: 0,
      error: 1,
      warn: 2,
      info: 3,
      debug: 4
    }
    // `??`, not `||` - levels.silent is 0, which `||` treats as absent and
    // silently downgrades to 'warn', the one level that must suppress output.
    this.currentLevel = this.levels[logLevel] ?? this.levels.warn
  }

  /**
   * Format message with plugin name prefix
   */
  formatMessage(message: unknown, ...args: unknown[]): unknown[] {
    const prefix = `[${this.pluginName}]`
    if (typeof message === 'string') {
      return [prefix + ' ' + message, ...args]
    }
    return [prefix, message, ...args]
  }

  /**
   * Log error messages
   */
  error(message: unknown, ...args: unknown[]): void {
    if (this.currentLevel >= this.levels.error) {
      console.error(...this.formatMessage(message, ...args))
    }
  }

  /**
   * Log warning messages
   */
  warn(message: unknown, ...args: unknown[]): void {
    if (this.currentLevel >= this.levels.warn) {
      console.warn(...this.formatMessage(message, ...args))
    }
  }

  /**
   * Log info messages
   */
  info(message: unknown, ...args: unknown[]): void {
    if (this.currentLevel >= this.levels.info) {
      console.info(...this.formatMessage(message, ...args))
    }
  }

  /**
   * Log debug messages
   */
  debug(message: unknown, ...args: unknown[]): void {
    if (this.currentLevel >= this.levels.debug) {
      console.debug(...this.formatMessage(message, ...args))
    }
  }
}
