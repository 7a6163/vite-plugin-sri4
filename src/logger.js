const DEFAULT_PLUGIN_NAME = 'vite-plugin-sri4'

/**
 * Logger class to handle different log levels without hijacking global console
 */
export class Logger {
  constructor(logLevel = 'warn', pluginName = DEFAULT_PLUGIN_NAME) {
    this.logLevel = logLevel
    this.pluginName = pluginName
    this.levels = {
      silent: 0,
      error: 1,
      warn: 2,
      info: 3,
      debug: 4
    }
    this.currentLevel = this.levels[logLevel] || this.levels.warn
  }

  /**
   * Format message with plugin name prefix
   */
  formatMessage(message, ...args) {
    const prefix = `[${this.pluginName}]`
    if (typeof message === 'string') {
      return [prefix + ' ' + message, ...args]
    }
    return [prefix, message, ...args]
  }

  /**
   * Log error messages
   */
  error(message, ...args) {
    if (this.currentLevel >= this.levels.error) {
      console.error(...this.formatMessage(message, ...args))
    }
  }

  /**
   * Log warning messages
   */
  warn(message, ...args) {
    if (this.currentLevel >= this.levels.warn) {
      console.warn(...this.formatMessage(message, ...args))
    }
  }

  /**
   * Log info messages
   */
  info(message, ...args) {
    if (this.currentLevel >= this.levels.info) {
      console.info(...this.formatMessage(message, ...args))
    }
  }

  /**
   * Log debug messages
   */
  debug(message, ...args) {
    if (this.currentLevel >= this.levels.debug) {
      console.debug(...this.formatMessage(message, ...args))
    }
  }

  /**
   * Create a child logger with the same configuration
   */
  child(name) {
    return new Logger(this.logLevel, `${this.pluginName}:${name}`)
  }
}