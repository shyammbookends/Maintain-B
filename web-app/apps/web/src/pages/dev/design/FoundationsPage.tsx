import {
  ASSET_STATUS,
  PRIORITY,
  PURCHASE_ORDER_STATUS,
  REQUEST_STATUS,
  STEP_RESULT,
  WORK_ORDER_STATUS,
} from '@maintainx/shared'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Row, Section } from './Section'

const SURFACES = [
  ['background', 'Page / panels'],
  ['canvas', 'Admin canvas'],
  ['muted', 'Subtle fills'],
  ['secondary', 'Secondary fills'],
  ['border', 'Hairlines'],
  ['input', 'Input borders'],
  ['foreground', 'Text'],
  ['muted-foreground', 'Secondary text'],
  ['primary', 'Accent / primary action'],
  ['destructive', 'Destructive action'],
] as const

const TONES = ['neutral', 'info', 'warning', 'success', 'danger', 'review'] as const

const TONE_USE: Record<(typeof TONES)[number], string> = {
  neutral: 'Open, draft, inactive',
  info: 'Assigned, ordered, new',
  warning: 'In progress, on hold, pending',
  success: 'Completed, operational, received',
  danger: 'Critical, broken, overdue',
  review: 'Awaiting review',
}

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="size-9 shrink-0 rounded-md border"
        style={{ backgroundColor: `var(--${token})` }}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-foreground">--{token}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

export function FoundationsPage() {
  return (
    <>
      <PageHeader
        title="Colour & type"
        description="Tokens live in src/styles/index.css. A unit test fails the build if any text/background pair drops below WCAG AA (4.5:1)."
      />
      <div className="grid gap-6">
        <Section title="Surfaces and text">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {SURFACES.map(([token, label]) => (
              <Swatch key={token} token={token} label={label} />
            ))}
          </div>
        </Section>

        <Section
          title="Status tones"
          note="Colour is reserved for meaning. Each tone has a solid (dots, borders), a soft background and a text colour."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TONES.map((tone) => (
              <div key={tone} className="flex items-center gap-3 rounded-md border p-3">
                <div className="flex shrink-0 gap-1" aria-hidden>
                  <span
                    className="size-6 rounded-sm"
                    style={{ backgroundColor: `var(--${tone})` }}
                  />
                  <span
                    className="size-6 rounded-sm border"
                    style={{ backgroundColor: `var(--${tone}-soft)` }}
                  />
                  <span
                    className="size-6 rounded-sm"
                    style={{ backgroundColor: `var(--${tone}-fg)` }}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize">{tone}</p>
                  <p className="truncate text-xs text-muted-foreground">{TONE_USE[tone]}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Status badges"
          note="Every status in the system, translated. Switch language in the top bar to check Hindi and Gujarati."
        >
          <div className="grid gap-3 text-13">
            <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr]">
              <span className="text-muted-foreground">Work order</span>
              <Row>
                {WORK_ORDER_STATUS.map((s) => (
                  <StatusBadge key={s} kind="workOrderStatus" value={s} />
                ))}
              </Row>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr]">
              <span className="text-muted-foreground">Priority</span>
              <Row>
                {PRIORITY.map((s) => (
                  <StatusBadge key={s} kind="priority" value={s} />
                ))}
              </Row>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr]">
              <span className="text-muted-foreground">Asset</span>
              <Row>
                {ASSET_STATUS.map((s) => (
                  <StatusBadge key={s} kind="assetStatus" value={s} />
                ))}
              </Row>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr]">
              <span className="text-muted-foreground">Purchase order</span>
              <Row>
                {PURCHASE_ORDER_STATUS.map((s) => (
                  <StatusBadge key={s} kind="purchaseOrderStatus" value={s} />
                ))}
              </Row>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr]">
              <span className="text-muted-foreground">Request</span>
              <Row>
                {REQUEST_STATUS.map((s) => (
                  <StatusBadge key={s} kind="requestStatus" value={s} />
                ))}
              </Row>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr]">
              <span className="text-muted-foreground">Checklist result</span>
              <Row>
                {STEP_RESULT.map((s) => (
                  <StatusBadge key={s} kind="stepResult" value={s} />
                ))}
              </Row>
            </div>
          </div>
        </Section>

        <Section
          title="Type scale"
          note="Inter for Latin; Noto Sans Devanagari / Gujarati load only when those scripts appear."
        >
          <div className="grid gap-3">
            <p className="text-2xl font-semibold tracking-tight">24 · Page title (rare)</p>
            <p className="text-xl font-semibold tracking-tight">20 · Page heading</p>
            <p className="text-base font-semibold">16 · Section heading / worker body</p>
            <p className="text-sm">14 · Admin body text and tables</p>
            <p className="text-13 text-muted-foreground">13 · Secondary text, helper text</p>
            <p className="text-xs text-muted-foreground">12 · Labels, metadata</p>
            <p className="text-sm">
              हिन्दी: वर्क ऑर्डर पूरा हुआ · ગુજરાતી: વર્ક ઓર્ડર પૂર્ણ · 1,23,456 ₹
            </p>
          </div>
        </Section>

        <Section title="Radius, borders, elevation">
          <Row className="gap-4">
            <div className="flex size-20 items-center justify-center rounded-sm border text-xs text-muted-foreground">
              4px
            </div>
            <div className="flex size-20 items-center justify-center rounded-md border text-xs text-muted-foreground">
              6px
            </div>
            <div className="flex size-20 items-center justify-center rounded-lg border text-xs text-muted-foreground">
              8px
            </div>
            <div className="flex size-20 items-center justify-center rounded-md border bg-popover text-xs text-muted-foreground shadow-popover">
              Popover
            </div>
          </Row>
        </Section>
      </div>
    </>
  )
}
