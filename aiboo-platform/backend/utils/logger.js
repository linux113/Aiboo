import pino from 'pino';

// LOG_FILE=/path/to/log.log mirrors every log line to a file (in addition to
// stdout) — set it when running on a VM/bare metal or via scripts/real-stack.sh
// so `real-stack.sh logs` and your log shipper have a persistent source.
// Docker deployments should leave it unset (stdout → docker logs).
const logFile = process.env.LOG_FILE;
const pretty = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL || 'info';

const logger = pino(
  logFile
    ? {
        level,
        transport: {
          targets: [
            pretty
              ? { target: 'pino-pretty', level, options: { colorize: true } }
              : // fd 1 = stdout, JSON (production default)
                { target: 'pino/file', level, options: { destination: 1 } },
            { target: 'pino/file', level, options: { destination: logFile, mkdir: true } },
          ],
        },
      }
    : {
        level,
        transport: pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
      },
);

export default logger;
