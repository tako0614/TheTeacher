/**
 * Logger utility for development and production environments
 * In production, logs can be sent to external monitoring services
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  data?: unknown;
  timestamp: string;
}

const isDevelopment = import.meta.env.DEV;

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 100; // Keep last 100 logs in memory

  private log(level: LogLevel, message: string, context?: string, data?: unknown) {
    const entry: LogEntry = {
      level,
      message,
      context,
      data,
      timestamp: new Date().toISOString(),
    };

    // Store in memory
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // In development, also log to console
    if (isDevelopment) {
      const prefix = context ? `[${context}]` : "";
      switch (level) {
        case "debug":
          console.debug(prefix, message, data ?? "");
          break;
        case "info":
          console.info(prefix, message, data ?? "");
          break;
        case "warn":
          console.warn(prefix, message, data ?? "");
          break;
        case "error":
          console.error(prefix, message, data ?? "");
          break;
      }
    }

    // In production, you could send to external service here
    // Example: sendToMonitoringService(entry);
  }

  debug(message: string, context?: string, data?: unknown) {
    this.log("debug", message, context, data);
  }

  info(message: string, context?: string, data?: unknown) {
    this.log("info", message, context, data);
  }

  warn(message: string, context?: string, data?: unknown) {
    this.log("warn", message, context, data);
  }

  error(message: string, context?: string, data?: unknown) {
    this.log("error", message, context, data);
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }
}

export const logger = new Logger();
