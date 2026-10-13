import { Copy, MoreHorizontal, Pencil, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { DetailList } from '@/components/common/DetailList'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toaster'
import { Row, Section } from './Section'

export function OverlaysPage() {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <PageHeader
        title="Overlays"
        description="Dialogs for short decisions, side sheets for create/edit on desktop, bottom sheets on phones. All trap focus and close on Escape."
      />
      <div className="grid gap-6">
        <Section title="Dialog, sheets, confirm">
          <Row>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Put on hold…</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Put work order on hold</DialogTitle>
                  <DialogDescription>
                    The assignee and admins will see the reason.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-1.5">
                  <Label htmlFor="hold-reason">Reason</Label>
                  <Textarea id="hold-reason" placeholder="Waiting for compressor part" />
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button onClick={() => toast('Work order put on hold')}>Put on hold</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Edit in side sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Edit location</SheetTitle>
                  <SheetDescription>Restaurant 3</SheetDescription>
                </SheetHeader>
                <SheetBody className="grid content-start gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="loc-name">Name</Label>
                    <Input id="loc-name" defaultValue="Cold kitchen" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="loc-notes">Notes</Label>
                    <Textarea id="loc-notes" />
                  </div>
                </SheetBody>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button onClick={() => toast.success('Changes saved.')}>Save</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Bottom sheet (mobile)</Button>
              </SheetTrigger>
              <SheetContent side="bottom">
                <SheetHeader>
                  <SheetTitle>Add a note</SheetTitle>
                  <SheetDescription>Visible to the admin reviewing this task.</SheetDescription>
                </SheetHeader>
                <SheetBody>
                  <Textarea
                    aria-label="Note"
                    rows={4}
                    placeholder="Replaced door gasket, tested for 15 min."
                  />
                </SheetBody>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button size="xl">Save note</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <Button variant="destructive-outline" onClick={() => setConfirmOpen(true)}>
              <Trash2 /> Archive asset…
            </Button>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              tone="destructive"
              title="Archive “Walk-in freezer”?"
              description="It will be hidden from lists. History and reports keep it."
              confirmLabel="Archive"
              onConfirm={async () => {
                await new Promise((r) => setTimeout(r, 900))
                toast.success('Asset archived')
              }}
            />
          </Row>
        </Section>

        <Section title="Menus and popovers">
          <Row>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Row actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <UserPlus /> Reassign
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Trash2 /> Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Warranty details</Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80">
                <DetailList
                  items={[
                    { label: 'Vendor', value: 'CoolTech Services' },
                    { label: 'Ends', value: '14 Mar 2027' },
                    { label: 'Document', value: 'warranty-card.pdf' },
                  ]}
                />
              </PopoverContent>
            </Popover>
          </Row>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
            </TabsList>
            <TabsContent value="details">
              <DetailList
                items={[
                  {
                    label: 'Status',
                    value: <StatusBadge kind="assetStatus" value="OPERATIONAL" />,
                  },
                  { label: 'Manufacturer', value: 'Blue Star' },
                  { label: 'Serial number', value: 'BS-WF-22-00418' },
                  { label: 'Location', value: 'Storage' },
                ]}
              />
            </TabsContent>
            <TabsContent value="history">
              <p className="text-sm text-muted-foreground">
                Maintenance history renders here (Phase 8).
              </p>
            </TabsContent>
            <TabsContent value="documents">
              <p className="text-sm text-muted-foreground">Documents render here (Phase 15).</p>
            </TabsContent>
          </Tabs>
        </Section>
      </div>
    </>
  )
}
