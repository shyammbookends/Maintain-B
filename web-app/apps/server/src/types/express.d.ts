import type { AuthContext } from '../modules/auth/auth.context.js'

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id set by the request-id middleware; echoed as `x-request-id`. */
    requestId: string
    /** Set by the authenticate middleware on protected routes. Read it via getAuth(req). */
    auth?: AuthContext
  }
}

export {}
