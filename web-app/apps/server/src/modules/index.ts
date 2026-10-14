import { Router } from 'express'
import { automationsRouter } from './automations/automations.routes.js'
import { metersRouter } from './meters/meters.routes.js'
import { appUpdatesRouter } from './app-updates/app-updates.routes.js'
import { assetsRouter } from './assets/assets.routes.js'
import { auditRouter } from './audit/audit.routes.js'
import { authRouter } from './auth/auth.routes.js'
import { calendarRouter } from './calendar/calendar.routes.js'
import { dashboardRouter } from './dashboard/dashboard.routes.js'
import { documentsRouter } from './documents/documents.routes.js'
import { filesRouter } from './files/files.routes.js'
import { healthRouter } from './health/health.routes.js'
import { inspectionsRouter } from './inspections/inspections.routes.js'
import { inventoryRouter } from './inventory/inventory.routes.js'
import { jobsRouter } from './jobs/jobs.routes.js'
import { locationsRouter } from './locations/locations.routes.js'
import { maintenanceRouter } from './maintenance/maintenance.routes.js'
import { meRouter } from './me/me.routes.js'
import { devicesRouter } from './notifications/devices.routes.js'
import { notificationsRouter } from './notifications/notifications.routes.js'
import { proceduresRouter } from './procedures/procedures.routes.js'
import { purchaseOrdersRouter } from './purchase-orders/purchase-orders.routes.js'
import { reportSchedulesRouter } from './report-schedules/report-schedules.routes.js'
import { reportsRouter } from './reports/reports.routes.js'
import { requestsRouter } from './requests/requests.routes.js'
import { restaurantsRouter } from './restaurants/restaurants.routes.js'
import { rolesRouter } from './roles/roles.routes.js'
import { stockCountsRouter } from './stock-counts/stock-counts.routes.js'
import { settingsRouter } from './settings/settings.routes.js'
import { portalRouter } from './portal/portal.routes.js'
import { searchRouter } from './search/search.routes.js'
import { customizationRouter } from './customization/customization.routes.js'
import { chatRouter } from './chat/chat.routes.js'
import { integrationsRouter } from './integrations/integrations.routes.js'
import { storageAdminRouter } from './storage-admin/storage-admin.routes.js'
import { teamsRouter } from './teams/teams.routes.js'
import { usersRouter } from './users/users.routes.js'
import { vendorsRouter } from './vendors/vendors.routes.js'
import { workOrdersRouter } from './work-orders/work-orders.routes.js'

/** Everything under /api/v1. Each module registers its own router here. */
export const apiRouter = Router()

apiRouter.use(healthRouter)
apiRouter.use(authRouter)
apiRouter.use(dashboardRouter)
apiRouter.use(meRouter)
apiRouter.use(appUpdatesRouter)
apiRouter.use(restaurantsRouter)
apiRouter.use(locationsRouter)
apiRouter.use(assetsRouter)
apiRouter.use(metersRouter)
apiRouter.use(automationsRouter)
apiRouter.use(requestsRouter)
apiRouter.use(workOrdersRouter)
apiRouter.use(calendarRouter)
apiRouter.use(maintenanceRouter)
apiRouter.use(proceduresRouter)
apiRouter.use(inspectionsRouter)
apiRouter.use(inventoryRouter)
apiRouter.use(stockCountsRouter)
apiRouter.use(storageAdminRouter)
apiRouter.use(settingsRouter)
apiRouter.use(portalRouter)
apiRouter.use(searchRouter)
apiRouter.use(customizationRouter)
apiRouter.use(chatRouter)
apiRouter.use(integrationsRouter)
apiRouter.use(vendorsRouter)
apiRouter.use(purchaseOrdersRouter)
apiRouter.use(notificationsRouter)
apiRouter.use(devicesRouter)
apiRouter.use(documentsRouter)
apiRouter.use(reportsRouter)
apiRouter.use(reportSchedulesRouter)
apiRouter.use(auditRouter)
apiRouter.use(jobsRouter)
apiRouter.use(usersRouter)
apiRouter.use(rolesRouter)
apiRouter.use(teamsRouter)
apiRouter.use(filesRouter)
