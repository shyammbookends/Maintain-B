/**
 * Vercel serverless entry: the whole Express API as one function.
 * vercel.json rewrites /api/* here; the app routes on the original path.
 * Built by `npm run vercel-build` (apps/server/dist must exist).
 */
import { connectEarly } from '../apps/server/dist/core/prisma.js'

// Cold start: the database connection opens while the rest of the API loads.
connectEarly()
const { createApp } = await import('../apps/server/dist/app.js')

export default createApp()
