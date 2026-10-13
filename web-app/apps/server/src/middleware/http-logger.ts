import { pinoHttp } from 'pino-http'
import { logger } from '../core/logger.js'

const QUIET_PATHS = ['/api/v1/health', '/api/v1/ready']

/** Query strings that are credentials (signed file links, OAuth codes) never reach the log. */
const SECRET_QUERY = /^\/api\/v1\/(files|auth\/sso\/[^/?]+\/callback)\?/
export const loggableUrl = (url: string | undefined) =>
  url && SECRET_QUERY.test(url) ? `${url.split('?')[0]}?[redacted]` : url

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as unknown as { requestId?: string }).requestId ?? '-',
  autoLogging: {
    ignore: (req) => QUIET_PATHS.some((p) => req.url?.startsWith(p)),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
  customSuccessMessage: (req, res) => `${req.method} ${loggableUrl(req.url)} → ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${loggableUrl(req.url)} → ${res.statusCode}`,
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: loggableUrl(req.url),
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
})
