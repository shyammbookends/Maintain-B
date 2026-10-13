import { Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'
import { Row, Section } from './Section'

export function ComponentsPage() {
  const [saving, setSaving] = useState(false)

  return (
    <>
      <PageHeader
        title="Buttons & inputs"
        description="shadcn/ui primitives on our tokens. One primary button per view; everything else is secondary or ghost."
      />
      <div className="grid gap-6">
        <Section title="Buttons" note="Variants">
          <Row>
            <Button>
              <Plus /> New work order
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="destructive-outline">Archive</Button>
            <Button variant="link">Link</Button>
          </Row>
          <p className="text-13 text-muted-foreground">Sizes (xl = worker 48px touch target)</p>
          <Row>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="xl">Start task</Button>
          </Row>
          <p className="text-13 text-muted-foreground">
            States and icon buttons (hover for tooltips)
          </p>
          <Row>
            <Button
              loading={saving}
              onClick={() => {
                setSaving(true)
                setTimeout(() => setSaving(false), 1500)
              }}
            >
              {saving ? 'Saving…' : 'Click to save'}
            </Button>
            <Button disabled>Disabled</Button>
            <Tooltip content="Edit">
              <Button variant="ghost" size="icon" aria-label="Edit">
                <Pencil />
              </Button>
            </Tooltip>
            <Tooltip content="Export CSV">
              <Button variant="secondary" size="icon" aria-label="Export CSV">
                <Download />
              </Button>
            </Tooltip>
            <Tooltip content="Delete">
              <Button variant="ghost" size="icon" aria-label="Delete" className="text-danger-fg">
                <Trash2 />
              </Button>
            </Tooltip>
          </Row>
        </Section>

        <Section title="Text inputs">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="c-default">Default</Label>
              <Input id="c-default" placeholder="Walk-in freezer" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-disabled">Disabled</Label>
              <Input id="c-disabled" value="WO-001024" disabled readOnly />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-invalid">Invalid</Label>
              <Input
                id="c-invalid"
                aria-invalid
                defaultValue="ab"
                aria-describedby="c-invalid-msg"
              />
              <p id="c-invalid-msg" className="text-xs font-medium text-danger-fg">
                Must be at least 3 characters.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-select">Select</Label>
              <Select defaultValue="HIGH">
                <SelectTrigger id="c-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="c-textarea">Textarea</Label>
              <Textarea id="c-textarea" placeholder="Describe the problem…" />
            </div>
          </div>
        </Section>

        <Section title="Choices">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="grid gap-3">
              <div className="flex items-center gap-2">
                <Checkbox id="c-cb1" defaultChecked />
                <Label htmlFor="c-cb1" className="font-normal">
                  Notify assignee
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="c-cb2" />
                <Label htmlFor="c-cb2" className="font-normal">
                  Requires photo
                </Label>
              </div>
            </div>
            <RadioGroup defaultValue="weekly" aria-label="Frequency">
              {['daily', 'weekly', 'monthly'].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <RadioGroupItem id={`c-r-${f}`} value={f} />
                  <Label htmlFor={`c-r-${f}`} className="font-normal capitalize">
                    {f}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <div className="flex items-center gap-3">
              <Switch id="c-switch" defaultChecked />
              <Label htmlFor="c-switch" className="font-normal">
                Active
              </Label>
            </div>
          </div>
        </Section>

        <Section title="Badges and avatars">
          <Row>
            <Badge>Neutral</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="danger">Danger</Badge>
            <Badge tone="review">Review</Badge>
            <Badge tone="outline">Outline</Badge>
          </Row>
          <Row className="gap-3">
            <Avatar name="Ramesh Kumar" size="sm" />
            <Avatar name="Priya Mehta" />
            <Avatar name="इमरान शेख" size="lg" />
          </Row>
        </Section>
      </div>
    </>
  )
}
