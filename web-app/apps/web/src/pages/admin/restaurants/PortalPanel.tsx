import { Copy, Download, ExternalLink, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Can } from '@/components/common/Can'
import { QrCode } from '@/components/assets/QrCode'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { toast } from '@/components/ui/toaster'
import { useWorkflow } from '@/contexts/WorkflowContext'
import { downloadQrPng, portalUrl } from '@/utils/qr'

/**
 * The restaurant's public request portal: a link and a QR code guests use to
 * report a problem without logging in. Shown once the portal is turned on.
 */
export function PortalPanel({ portalId, name }: { portalId: string; name: string }) {
  const { t } = useTranslation()
  const workflow = useWorkflow()
  const url = portalUrl(portalId)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('portal.copied'))
    } catch {
      toast.error(t('portal.copyFailed'))
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" aria-hidden /> {t('portal.panelTitle')}
        </PanelTitle>
      </PanelHeader>
      <PanelBody>
        {!workflow?.requestPortal ? (
          <p className="text-13 text-muted-foreground">
            {t('portal.off')}{' '}
            <Can permission="settings:view">
              <Link to="/settings" className="text-primary underline-offset-2 hover:underline">
                {t('portal.turnOn')}
              </Link>
            </Can>
          </p>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <QrCode value={url} label={t('portal.qrLabel', { name })} className="w-36 shrink-0" />
            <div className="grid min-w-0 gap-3">
              <p className="text-13 text-muted-foreground">{t('portal.panelHint')}</p>
              <code className="truncate rounded-md bg-muted px-2 py-1.5 text-xs">{url}</code>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => void copy()}>
                  <Copy aria-hidden /> {t('portal.copy')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void downloadQrPng(url, `request-portal-${name}.png`)}
                >
                  <Download aria-hidden /> {t('assets.downloadPng')}
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden /> {t('portal.open')}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}
      </PanelBody>
    </Panel>
  )
}
