import { pino, type LoggerOptions } from 'pino'
import { env } from '../config/env.js'

const options: LoggerOptions = {
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'maintainx-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      'req.headers["x-device-key"]',
      'req.headers["idempotency-key"]',
      '*.temporaryPassword',
      '*.secret',
      '*.key',
      '*.signature',
      '*.code_verifier',
      '*.client_secret',
      '*.SMTP_URL',
      '*.DATABASE_URL',
      '*.VAPID_PRIVATE_KEY',
      '*.SUPABASE_SERVICE_ROLE_KEY',
    ],
    censor: '[redacted]',
  },
}

if (env.isDevelopment) {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
  }
}

export const logger = pino(options)
export type Logger = typeof logger
