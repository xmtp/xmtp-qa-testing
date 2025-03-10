import fs from "fs";
import path from "path";
import winston from "winston";
import Transport from "winston-transport";
import type { LogInfo } from "./types";

class MemoryTransport extends Transport {
  logs: string[] = [];
  log(info: LogInfo, callback: () => void) {
    // Ensure the formatted message is available
    const formattedMessage = String(
      info[Symbol.for("message")] ||
        `[${info.timestamp}] [${info.level}] ${info.message}`,
    );
    this.logs.push(formattedMessage);
    setImmediate(() => this.emit("logged", info));
    callback();
  }
  flush(filePath: string) {
    // Write all logs at once
    fs.writeFileSync(filePath, this.logs.join("\n"), { flag: "w" });
    this.logs = [];
  }
}

let sharedLogger: winston.Logger | null = null;
let memoryTransport: MemoryTransport | null = null;
// Export a flush function to flush the memory transport logs
export const flushLogger = (testName: string): string => {
  if (memoryTransport) {
    const logFilePath = getLogFilePath(testName);
    memoryTransport.flush(logFilePath);
    return logFilePath;
  }
  return "";
};
// Add this function to capture external process output
export const captureProcessOutput = (
  stdout: string,
  stderr: string,
  logger: winston.Logger,
) => {
  if (stdout) {
    stdout.split("\n").forEach((line) => {
      if (line.trim()) logger.log("info", `[Rust] ${line.trim()}`);
    });
  }

  if (stderr) {
    stderr.split("\n").forEach((line) => {
      if (line.trim()) logger.log("error", `[Rust] ${line.trim()}`);
    });
  }
};
export const createLogger = (testName: string) => {
  if (!sharedLogger) {
    const logFilePath = getLogFilePath(testName);
    // Shared format for console and memory transport
    const sharedFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp as string}] [${level}] ${message as string}`;
      }),
    );

    const consoleTransport = new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), sharedFormat),
    });

    // Initialize our custom memory transport
    memoryTransport = new MemoryTransport({
      format: sharedFormat,
    });

    sharedLogger = winston.createLogger({
      transports: [consoleTransport, memoryTransport],
    });

    // Optionally, catch termination signals to flush logs before exit
    const flushAndExit = () => {
      if (memoryTransport) {
        memoryTransport.flush(logFilePath);
      }
      process.exit();
    };
    process.on("exit", flushAndExit);
    process.on("SIGINT", flushAndExit);
    process.on("SIGTERM", flushAndExit);
  }

  return sharedLogger;
};

function filterLog(args: any[]): string {
  // Check for the console.time/timeEnd pattern: where args[0] is "%s: %s"
  if (args.length >= 2 && args[0] === "%s: %s") {
    // Join the remaining parts into one message
    const message = args.slice(1).join(" ");
    const timePattern = /(\d+(\.\d+)?)(ms|s)\b/;
    const match = message.match(timePattern);
    if (match) {
      const timeValue = parseFloat(match[1]);
      const unit = match[3];
      const timeInMs = unit === "ms" ? timeValue : timeValue * 1000;
      // Skip logs for durations less than or equal to 300ms
      if (timeInMs <= 300) {
        return "";
      }
    }
    // Remove any "%s" placeholders from the message.
    return message.replace(/%s/g, "").trim();
  }

  return (
    args
      .map((arg) => {
        if (arg === null) return "null";
        if (arg === undefined) return "undefined";
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg);
          } catch (e: unknown) {
            if (e instanceof Error) {
              return e.message;
            }
            return "[Circular Object]";
          }
        }
        return String(arg);
      })
      .filter(Boolean)
      .join(" ")
      .trim() || ""
  );
}
const getLogFilePath = (testName: string): string => {
  const sanitizedName = testName.replace(/[^a-zA-Z0-9-_]/g, "_");
  const fileName = `${sanitizedName}.log`;

  return testName.includes("bug")
    ? path.join("bugs", testName, "test.log")
    : path.join("logs", fileName);
};

export const overrideConsole = (logger: winston.Logger) => {
  try {
    console.log = (...args: any[]) => {
      const message = filterLog(args);
      if (message) {
        // If this is a console.time/end log, always use warn if duration > 300ms.
        if (args.length >= 2 && args[0] === "%s: %s") {
          logger.log("warn", message);
        } else {
          logger.log("info", message);
        }
      }
    };
    console.info = (...args: any[]) => {
      const message = filterLog(args);
      if (message) {
        // Also promote timing logs from console.info to warn.
        if (args.length >= 2 && args[0] === "%s: %s") {
          logger.log("warn", message);
        } else {
          logger.log("info", message);
        }
      }
    };
    console.warn = (...args: any[]) => {
      const message = filterLog(args);
      if (message) {
        logger.log("warn", message);
      }
    };
    console.error = (...args: any[]) => {
      const message = filterLog(args);
      if (message) {
        logger.log("error", message);
      }
    };
    // Add a new debug method that only logs in non-production environments
    console.debug = (...args: any[]) => {
      // Only log debug messages in non-production environments
      if (process.env.NODE_ENV !== "production") {
        const message = filterLog(args);
        if (message) {
          logger.log("debug", message);
        }
      }
    };
  } catch (error) {
    console.error("Error overriding console", error);
  }
};

if (!fs.existsSync("logs")) {
  fs.mkdirSync("logs");
}
