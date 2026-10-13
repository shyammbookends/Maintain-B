import type { RouteObject } from 'react-router'
import { AuthLayout } from '@/layouts/AuthLayout'
import { RouteErrorPage } from '@/pages/RouteErrorPage'
import { GuestOnly, RequireAuth, RequirePermission, RequireRoleKind } from './guards'

/**
 * Product routes.
 *   /login, /change-password      auth screens
 *   /…                            admin app (Super Admin, Admin, custom admin roles)
 *   /w/…                          worker app (mobile-first)
 *   /r/:token                     public request portal (no login)
 *   /status                       public health page
 */
export const appRoutes: RouteObject[] = [
  {
    element: <GuestOnly />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          {
            path: '/login',
            lazy: async () => ({ Component: (await import('@/pages/auth/LoginPage')).LoginPage }),
          },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          {
            path: '/change-password',
            lazy: async () => ({
              Component: (await import('@/pages/auth/ChangePasswordPage')).ChangePasswordPage,
            }),
          },
        ],
      },
      // Scanned asset QR codes land here, then open in the user's own app.
      {
        path: '/a/:publicId',
        lazy: async () => ({
          Component: (await import('@/pages/assets/AssetQrLandingPage')).AssetQrLandingPage,
        }),
      },
      // Location and part QR codes (stuck on doors, shelves and bins).
      {
        path: '/l/:publicId',
        lazy: async () => ({
          Component: (await import('@/pages/assets/QrLandingPages')).LocationQrLandingPage,
        }),
      },
      {
        path: '/p/:publicId',
        lazy: async () => ({
          Component: (await import('@/pages/assets/QrLandingPages')).PartQrLandingPage,
        }),
      },
      {
        element: <RequireRoleKind kind="ADMIN" />,
        children: [
          // Print / save as PDF: a clean page without the app chrome.
          {
            path: '/work-orders/:workOrderId/print',
            lazy: async () => ({
              Component: (await import('@/pages/admin/work-orders/WorkOrderPrintPage'))
                .WorkOrderPrintPage,
            }),
          },
          {
            path: '/',
            // Shells are lazy so the sign-in page doesn't download the app chrome.
            lazy: async () => ({ Component: (await import('@/layouts/AppShells')).AdminShell }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('@/pages/admin/dashboard/AdminIndex')).AdminIndex,
                }),
              },
              {
                element: <RequirePermission permission="restaurants:view" />,
                children: [
                  {
                    path: 'restaurants',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/restaurants/RestaurantsPage'))
                        .RestaurantsPage,
                    }),
                  },
                  {
                    path: 'restaurants/:restaurantId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/restaurants/RestaurantDetailPage'))
                        .RestaurantDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="assets:view" />,
                children: [
                  {
                    path: 'assets',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/assets/AssetsPage')).AssetsPage,
                    }),
                  },
                  {
                    path: 'assets/:assetId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/assets/AssetDetailPage'))
                        .AssetDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="qr:view" />,
                children: [
                  {
                    path: 'assets/qr-print',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/assets/QrPrintPage')).QrPrintPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="requests:view" />,
                children: [
                  {
                    path: 'requests',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/requests/RequestsPage')).RequestsPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="work_orders:view" />,
                children: [
                  {
                    path: 'work-orders',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/work-orders/WorkOrdersPage'))
                        .WorkOrdersPage,
                    }),
                  },
                  {
                    path: 'calendar',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/calendar/CalendarPage')).CalendarPage,
                    }),
                  },
                  {
                    path: 'work-orders/:workOrderId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/work-orders/WorkOrderDetailPage'))
                        .WorkOrderDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="maintenance:view" />,
                children: [
                  {
                    path: 'maintenance',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/maintenance/MaintenancePage'))
                        .MaintenancePage,
                    }),
                  },
                  {
                    path: 'maintenance/:scheduleId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/maintenance/PmScheduleDetailPage'))
                        .PmScheduleDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="automations:view" />,
                children: [
                  {
                    path: 'automations',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/automations/AutomationsPage'))
                        .AutomationsPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="reports:view" />,
                children: [
                  {
                    path: 'analytics',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/reports/AnalyticsPage'))
                        .AnalyticsPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="procedures:view" />,
                children: [
                  {
                    path: 'procedures',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/procedures/ProceduresPage'))
                        .ProceduresPage,
                    }),
                  },
                  {
                    path: 'procedures/new',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/procedures/ProcedureEditorPage'))
                        .ProcedureEditorPage,
                    }),
                  },
                  {
                    path: 'procedures/:procedureId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/procedures/ProcedureEditorPage'))
                        .ProcedureEditorPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="inspections:view" />,
                children: [
                  {
                    path: 'inspections',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/inspections/InspectionsPage'))
                        .InspectionsPage,
                    }),
                  },
                  {
                    path: 'inspections/:inspectionId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/inspections/InspectionDetailPage'))
                        .InspectionDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="parts:view" />,
                children: [
                  {
                    path: 'inventory',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/inventory/InventoryPage'))
                        .InventoryPage,
                    }),
                  },
                  {
                    path: 'inventory/parts/:partId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/inventory/PartDetailPage'))
                        .PartDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="inventory:view" />,
                children: [
                  {
                    path: 'stock-counts',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/inventory/StockCountsPage'))
                        .StockCountsPage,
                    }),
                  },
                  {
                    path: 'stock-counts/:countId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/inventory/StockCountDetailPage'))
                        .StockCountDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="vendors:view" />,
                children: [
                  {
                    path: 'vendors',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/vendors/VendorsPage')).VendorsPage,
                    }),
                  },
                  {
                    path: 'vendors/:vendorId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/vendors/VendorDetailPage'))
                        .VendorDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="purchase_orders:create" />,
                children: [
                  {
                    path: 'purchase-orders/new',
                    lazy: async () => ({
                      Component: (
                        await import('@/pages/admin/purchase-orders/PurchaseOrderFormPage')
                      ).PurchaseOrderFormPage,
                    }),
                  },
                  {
                    path: 'purchase-orders/:orderId/edit',
                    lazy: async () => ({
                      Component: (
                        await import('@/pages/admin/purchase-orders/PurchaseOrderFormPage')
                      ).PurchaseOrderFormPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="purchase_orders:view" />,
                children: [
                  {
                    path: 'purchase-orders',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/purchase-orders/PurchaseOrdersPage'))
                        .PurchaseOrdersPage,
                    }),
                  },
                  {
                    path: 'purchase-orders/:orderId',
                    lazy: async () => ({
                      Component: (
                        await import('@/pages/admin/purchase-orders/PurchaseOrderDetailPage')
                      ).PurchaseOrderDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="reports:view" />,
                children: [
                  {
                    path: 'reports',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/reports/ReportsPage')).ReportsPage,
                    }),
                  },
                  {
                    path: 'reports/:key',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/reports/ReportViewPage'))
                        .ReportViewPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="documents:view" />,
                children: [
                  {
                    path: 'documents',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/documents/DocumentsPage'))
                        .DocumentsPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="audit_logs:view" />,
                children: [
                  {
                    path: 'audit',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/audit/AuditLogPage')).AuditLogPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="teams:view" />,
                children: [
                  {
                    path: 'teams',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/teams/TeamsPage')).TeamsPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="users:view" />,
                children: [
                  {
                    path: 'users',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/users/UsersPage')).UsersPage,
                    }),
                  },
                  {
                    path: 'users/:userId',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/users/UserDetailPage'))
                        .UserDetailPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission permission="settings:view" />,
                children: [
                  {
                    path: 'settings',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/settings/SettingsPage')).SettingsPage,
                    }),
                  },
                  {
                    path: 'storage',
                    lazy: async () => ({
                      Component: (await import('@/pages/admin/storage/StoragePage')).StoragePage,
                    }),
                  },
                ],
              },
              {
                path: 'notifications',
                lazy: async () => ({
                  Component: (await import('@/pages/notifications/NotificationsPage'))
                    .NotificationsPage,
                }),
              },
              {
                path: 'chat/:conversationId?',
                lazy: async () => ({
                  Component: (await import('@/pages/chat/ChatPage')).AdminChatPage,
                }),
              },
              {
                path: 'account',
                lazy: async () => ({
                  Component: (await import('@/pages/account/AccountPages')).AdminAccountPage,
                }),
              },
            ],
          },
        ],
      },
      {
        element: <RequireRoleKind kind="WORKER" />,
        children: [
          {
            path: '/w',
            lazy: async () => ({ Component: (await import('@/layouts/AppShells')).WorkerShell }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerHomePage')).WorkerHomePage,
                }),
              },
              {
                path: 'tasks',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerTasksPage')).WorkerTasksPage,
                }),
              },
              {
                path: 'tasks/:taskId',
                handle: { hideWorkerNav: true },
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerTaskPage')).WorkerTaskPage,
                }),
              },
              {
                path: 'report',
                handle: { hideWorkerNav: true },
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerReportPage')).WorkerReportPage,
                }),
              },
              {
                path: 'notifications',
                lazy: async () => ({
                  Component: (await import('@/pages/notifications/NotificationsPage'))
                    .WorkerNotificationsPage,
                }),
              },
              {
                path: 'chat/:conversationId?',
                lazy: async () => ({
                  Component: (await import('@/pages/chat/ChatPage')).WorkerChatPage,
                }),
              },
              {
                path: 'checklists',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerChecklistsPage'))
                    .WorkerChecklistsPage,
                }),
              },
              {
                path: 'inspections/:inspectionId',
                handle: { hideWorkerNav: true },
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerInspectionPage'))
                    .WorkerInspectionPage,
                }),
              },
              {
                path: 'reports',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerReportsPage')).WorkerReportsPage,
                }),
              },
              {
                path: 'schedule',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerSchedulePage')).WorkerSchedulePage,
                }),
              },
              {
                path: 'restaurants',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerRestaurantsPage'))
                    .WorkerRestaurantsPage,
                }),
              },
              {
                path: 'more',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerMorePage')).WorkerMorePage,
                }),
              },
              {
                path: 'assets',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerAssetsPage')).WorkerAssetsPage,
                }),
              },
              {
                path: 'assets/:assetId',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerAssetPage')).WorkerAssetPage,
                }),
              },
              {
                path: 'scan',
                lazy: async () => ({
                  Component: (await import('@/pages/worker/WorkerScanPage')).WorkerScanPage,
                }),
              },
              {
                path: 'account',
                lazy: async () => ({
                  Component: (await import('@/pages/account/AccountPages')).WorkerAccountPage,
                }),
              },
            ],
          },
        ],
      },
    ],
  },
  // Google / Microsoft sign-in lands here (session already set by the server).
  {
    path: '/sso',
    errorElement: <RouteErrorPage />,
    lazy: async () => ({ Component: (await import('@/pages/auth/SsoButtons')).SsoReturnPage }),
  },
  // Public request portal: a restaurant's link or a location's QR code, no login.
  {
    path: '/r/:token',
    errorElement: <RouteErrorPage />,
    lazy: async () => ({
      Component: (await import('@/pages/public/RequestPortalPage')).RequestPortalPage,
    }),
  },
  {
    path: '/status',
    errorElement: <RouteErrorPage />,
    lazy: async () => {
      const { SystemStatusPage } = await import('@/pages/system/SystemStatusPage')
      return { Component: SystemStatusPage }
    },
  },
]
