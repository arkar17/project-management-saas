import { pino, type DestinationStream, type Logger } from 'pino';

/** Structured JSON logs; credentials and tokens are always redacted (NFR-02, NFR-09). */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.tokenHash',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}
