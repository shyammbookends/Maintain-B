import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** A one-time secret (temporary password) in a large, easy-to-read box with a copy button. */
export function SecretReveal({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (http, permissions): the value is still visible to copy by hand.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 pl-3">
      <code aria-label={label} className="flex-1 font-mono text-lg tracking-wider select-all">
        {value}
      </code>
      <Button variant="secondary" size="sm" onClick={() => void copy()}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  )
}
