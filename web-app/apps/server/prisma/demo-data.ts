/**
 * Realistic, fully connected demo data for showing the app (local / demo databases only).
 *
 *   npm run db:seed:demo -w @maintainx/server     (after `npm run db:seed`)
 *
 * Creates 5 restaurants, 5 admins, 5 workers, teams, locations, vendors, assets, parts and
 * stock, procedures, PM schedules, requests, work orders (photos, checklists, chat, parts,
 * costs, time), inspections, purchase orders, documents, invoices, meters, labels,
 * notifications and team chat. Runs once: it stops if the demo data already exists.
 * Every demo login uses the password Demo@1234 (override with SEED_DEMO_PASSWORD).
 */
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { nextCode } from '../src/core/counters.js'
import { generatePublicId } from '../src/core/ids.js'
import { optimizePhoto } from '../src/core/images.js'
import { demoSeedAllowed } from '../src/config/seed-guard.js'
import { hashPassword } from '../src/core/password.js'
import { prisma } from '../src/core/prisma.js'
import { storage } from '../src/storage/index.js'

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo@1234'
const tx = prisma as unknown as Prisma.TransactionClient

// ---------------------------------------------------------------- helpers

const DAY = 86_400_000
/** A date `days` from now (negative = past) at the given local hour. */
function at(days: number, hour = 10, minute = 0): Date {
  const d = new Date(Date.now() + days * DAY)
  d.setHours(hour, minute, 0, 0)
  return d
}
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000)

/** Unsplash photos picked for each topic (checked by eye). */
const PHOTOS: Record<string, string[]> = {
  fridge: ['1571175443880-49e1d25b2bc5', '1581092160562-40aa08e78837'],
  gas: ['1600565193348-f74bd3c7ccdf', '1504328345606-18bbc8c9d7d1'],
  electrical: ['1621905251189-08b45d6a269e', '1621905252507-b35492cc74b4'],
  plumbing: ['1585704032915-c3400ca199e7', '1558618666-fcd25c85cd64'],
  kitchen: ['1574269909862-7e1d70bb8078', '1556909172-54557c7e4fb7', '1556911220-bff31c812dba'],
  dishwasher: ['1626806787461-102c1bfaaea1'],
  cleaning: ['1581578731548-c64695cc6952', '1563453392212-326f5e854473'],
  dining: ['1517248135467-4c7edcad34c4', '1552566626-52f8b828add9', '1590846406792-0adc7f938f1d'],
  tools: ['1581244277943-fe4a9c777189', '1581092160562-40aa08e78837'],
  store: ['1587293852726-70cdb56c2866'],
}
const photoCache = new Map<string, Buffer>()
const photoTurn = new Map<string, number>()

async function placeholder(text: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><rect width="100%" height="100%" fill="#e2e8f0"/><text x="50%" y="50%" font-family="Arial" font-size="48" fill="#334155" text-anchor="middle">${text}</text></svg>`
  return sharp(Buffer.from(svg)).jpeg().toBuffer()
}

async function photo(topic: string): Promise<Buffer> {
  const ids = PHOTOS[topic] ?? PHOTOS.tools!
  const turn = photoTurn.get(topic) ?? 0
  photoTurn.set(topic, turn + 1)
  const id = ids[turn % ids.length]!
  const cached = photoCache.get(id)
  if (cached) return cached
  let buf: Buffer
  try {
    const res = await fetch(`https://images.unsplash.com/photo-${id}?w=1280&q=75`)
    if (!res.ok) throw new Error(String(res.status))
    buf = Buffer.from(await res.arrayBuffer())
  } catch {
    buf = await placeholder(topic)
  }
  photoCache.set(id, buf)
  return buf
}

function monthFolder(root: string, d: Date) {
  return `${root}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Stores a photo the same way the upload endpoint does (WebP + thumbnail). */
async function attachPhoto(o: {
  ownerType: 'WORK_ORDER' | 'REQUEST' | 'CHECKLIST_ITEM' | 'INSPECTION_ITEM' | 'MESSAGE'
  ownerId: string
  organizationId: string
  topic: string
  caption: string
  stage?: 'BEFORE' | 'DURING' | 'AFTER'
  uploadedById: string | null
  when: Date
  fileName: string
}) {
  const input = await photo(o.topic)
  const p = await optimizePhoto(input)
  const id = randomUUID()
  const folder = monthFolder('attachments', o.when)
  const main = p?.main ?? input
  const mime = p && p.main !== input ? 'image/webp' : 'image/jpeg'
  const key = `${folder}/${id}.${mime === 'image/webp' ? 'webp' : 'jpg'}`
  await storage.put(key, main, { mimeType: mime })
  let thumbKey: string | null = null
  if (p) {
    thumbKey = `${folder}/${id}-thumb.webp`
    await storage.put(thumbKey, p.thumb, { mimeType: 'image/webp' })
  }
  await prisma.attachment.create({
    data: {
      ownerType: o.ownerType,
      ownerId: o.ownerId,
      kind: 'PHOTO',
      storageKey: key,
      thumbKey,
      fileName: o.fileName,
      mimeType: mime,
      sizeBytes: main.length + (p?.thumb.length ?? 0),
      width: p?.width ?? null,
      height: p?.height ?? null,
      stage: o.stage ?? null,
      caption: o.caption,
      uploadedById: o.uploadedById,
      createdAt: o.when,
    } as Prisma.AttachmentUncheckedCreateInput,
  })
}

/** A small but valid one-page PDF with the given lines of text. */
function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const text = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 18 : 11} Tf 60 ${770 - i * 22} Td (${esc(l)}) Tj ET`)
    .join('\n')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out)
}

// ---------------------------------------------------------------- main

async function main() {
  // Every demo login shares a published password: local databases only.
  if (!demoSeedAllowed()) {
    console.error(
      'Refusing to create demo data: DATABASE_URL is not a local database (or this is production). ' +
        'For a throwaway demo site set ALLOW_DEMO_SEED=yes-i-understand and SEED_DEMO_PASSWORD.',
    )
    process.exitCode = 1
    return
  }
  if (process.env.ALLOW_DEMO_SEED === 'yes-i-understand' && !process.env.SEED_DEMO_PASSWORD) {
    console.error('Set SEED_DEMO_PASSWORD: the default demo password is public.')
    process.exitCode = 1
    return
  }
  const org = await prisma.organization.findUnique({ where: { slug: 'bookends' } })
  if (!org) throw new Error('Run `npm run db:seed` first (organization not found).')
  const O = org.id
  if (await prisma.restaurant.findFirst({ where: { organizationId: O, code: 'BKD-SBR' } })) {
    console.log('Demo data already exists — nothing to do.')
    return
  }

  const roles = new Map(
    (await prisma.role.findMany({ where: { organizationId: O } })).map((r) => [r.systemKey, r.id]),
  )
  const hash = await hashPassword(PASSWORD)

  // ---- Super Admin: keep the password, skip the forced change so the demo is smooth
  const superAdmin = await prisma.user.findFirstOrThrow({
    where: { organizationId: O, username: 'superadmin' },
  })
  await prisma.user.update({
    where: { id: superAdmin.id },
    data: { mustChangePassword: false, phone: '+919825000001', jobTitle: 'Operations Head' },
  })

  // ---- Restaurants (the seed's DEMO restaurant becomes the first one)
  const R_DATA = [
    {
      code: 'BKD-CGR',
      name: 'Bookends Café – CG Road',
      a: '12, Shivalik Plaza, CG Road, Navrangpura',
      city: 'Ahmedabad',
      pin: '380009',
      phone: '+917926400101',
      contact: 'Priya Shah',
    },
    {
      code: 'BKD-SBR',
      name: 'Bookends Bistro – Sindhu Bhavan',
      a: 'Ground Floor, Iscon Elegance, Sindhu Bhavan Road, Bodakdev',
      city: 'Ahmedabad',
      pin: '380054',
      phone: '+917926400202',
      contact: 'Rahul Desai',
    },
    {
      code: 'BKD-PRH',
      name: 'Bookends Kitchen – Prahlad Nagar',
      a: '4, Corporate Road, Prahlad Nagar',
      city: 'Ahmedabad',
      pin: '380015',
      phone: '+917926400303',
      contact: 'Neha Joshi',
    },
    {
      code: 'BKD-ALK',
      name: 'Bookends Café – Alkapuri',
      a: '22, R C Dutt Road, Alkapuri',
      city: 'Vadodara',
      pin: '390007',
      phone: '+912652300404',
      contact: 'Kunal Parikh',
    },
    {
      code: 'BKD-VSU',
      name: 'Bookends Eatery – Vesu',
      a: 'Shop 7, Happy Excellencia, VIP Road, Vesu',
      city: 'Surat',
      pin: '395007',
      phone: '+912612700505',
      contact: 'Sneha Trivedi',
    },
  ]
  const restaurants: { id: string; code: string; name: string }[] = []
  const demo = await prisma.restaurant.findFirst({ where: { organizationId: O, code: 'DEMO' } })
  for (const [i, r] of R_DATA.entries()) {
    const data = {
      code: r.code,
      name: r.name,
      addressLine1: r.a,
      city: r.city,
      state: 'Gujarat',
      postalCode: r.pin,
      phone: r.phone,
      email: `${r.code.toLowerCase()}@bookends.in`,
      opensAt: '08:00',
      closesAt: '23:00',
      contactName: r.contact,
    }
    const row =
      i === 0 && demo
        ? await prisma.restaurant.update({ where: { id: demo.id }, data })
        : await prisma.restaurant.create({ data: { organizationId: O, ...data } })
    restaurants.push(row)
  }
  const [R1, R2, R3, R4, R5] = restaurants as [
    (typeof restaurants)[0],
    (typeof restaurants)[0],
    (typeof restaurants)[0],
    (typeof restaurants)[0],
    (typeof restaurants)[0],
  ]

  // ---- People
  async function person(p: {
    username: string
    first: string
    last: string
    role: string
    title: string
    phone: string
    rate?: number
    restaurants: string[]
  }) {
    let u = await prisma.user.findFirst({ where: { organizationId: O, username: p.username } })
    const data = {
      firstName: p.first,
      lastName: p.last,
      phone: p.phone,
      jobTitle: p.title,
      hourlyRate: p.rate ?? null,
      lastLoginAt: at(-1, 9),
    }
    if (u) u = await prisma.user.update({ where: { id: u.id }, data })
    else
      u = await prisma.user.create({
        data: {
          organizationId: O,
          username: p.username,
          email: `${p.username}@bookends.in`,
          passwordHash: hash,
          status: 'ACTIVE',
          ...data,
        },
      })
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: u.id, roleId: roles.get(p.role)! } },
      update: {},
      create: { userId: u.id, roleId: roles.get(p.role)! },
    })
    for (const rid of p.restaurants)
      await prisma.userRestaurant.upsert({
        where: { userId_restaurantId: { userId: u.id, restaurantId: rid } },
        update: {},
        create: { userId: u.id, restaurantId: rid },
      })
    return u
  }

  const A1 = await person({
    username: 'manager',
    first: 'Priya',
    last: 'Shah',
    role: 'ADMIN',
    title: 'Restaurant Manager',
    phone: '+919825011001',
    restaurants: [R1.id],
  })
  const A2 = await person({
    username: 'rahul.desai',
    first: 'Rahul',
    last: 'Desai',
    role: 'ADMIN',
    title: 'Restaurant Manager',
    phone: '+919825011002',
    restaurants: [R2.id],
  })
  const A3 = await person({
    username: 'neha.joshi',
    first: 'Neha',
    last: 'Joshi',
    role: 'ADMIN',
    title: 'Restaurant Manager',
    phone: '+919825011003',
    restaurants: [R3.id],
  })
  const A4 = await person({
    username: 'kunal.parikh',
    first: 'Kunal',
    last: 'Parikh',
    role: 'ADMIN',
    title: 'Restaurant Manager',
    phone: '+919825011004',
    restaurants: [R4.id],
  })
  const A5 = await person({
    username: 'sneha.trivedi',
    first: 'Sneha',
    last: 'Trivedi',
    role: 'ADMIN',
    title: 'Restaurant Manager',
    phone: '+919825011005',
    restaurants: [R5.id],
  })
  const W1 = await person({
    username: 'technician',
    first: 'Ravi',
    last: 'Kumar',
    role: 'WORKER',
    title: 'Electrician',
    phone: '+919825022001',
    rate: 250,
    restaurants: [R1.id, R2.id],
  })
  const W2 = await person({
    username: 'suresh.yadav',
    first: 'Suresh',
    last: 'Yadav',
    role: 'WORKER',
    title: 'Refrigeration Technician',
    phone: '+919825022002',
    rate: 300,
    restaurants: [R1.id, R3.id],
  })
  const W3 = await person({
    username: 'mahesh.solanki',
    first: 'Mahesh',
    last: 'Solanki',
    role: 'WORKER',
    title: 'Plumber',
    phone: '+919825022003',
    rate: 220,
    restaurants: [R2.id, R4.id],
  })
  const W4 = await person({
    username: 'imran.shaikh',
    first: 'Imran',
    last: 'Shaikh',
    role: 'WORKER',
    title: 'AC & Gas Technician',
    phone: '+919825022004',
    rate: 280,
    restaurants: [R3.id, R5.id],
  })
  const W5 = await person({
    username: 'vikram.thakor',
    first: 'Vikram',
    last: 'Thakor',
    role: 'WORKER',
    title: 'Kitchen Equipment Technician',
    phone: '+919825022005',
    rate: 260,
    restaurants: [R4.id, R5.id],
  })
  const SUP = await person({
    username: 'supervisor',
    first: 'Meera',
    last: 'Patel',
    role: 'ADMIN',
    title: 'Maintenance Supervisor',
    phone: '+919825033001',
    restaurants: [R1.id, R2.id, R3.id],
  })
  const STAFF = await person({
    username: 'staff',
    first: 'Arjun',
    last: 'Mehta',
    role: 'WORKER',
    title: 'Floor Staff',
    phone: '+919825044001',
    restaurants: [R1.id],
  })

  const managers = [A1, A2, A3, A4, A5]
  for (const [i, r] of restaurants.entries())
    await prisma.restaurant.update({ where: { id: r.id }, data: { managerId: managers[i]!.id } })

  // ---- Teams
  const teamDefs = [
    {
      name: 'Refrigeration & Cold Room',
      desc: 'Walk-in coolers, freezers and ice machines',
      lead: W2,
      members: [W2, W4],
    },
    {
      name: 'Electrical',
      desc: 'Panels, wiring, lighting and power backup',
      lead: W1,
      members: [W1],
    },
    {
      name: 'Plumbing & Water',
      desc: 'Sinks, drains, RO plants and water lines',
      lead: W3,
      members: [W3],
    },
    {
      name: 'Gas & Kitchen Equipment',
      desc: 'Gas ranges, tandoors, ovens and dishwashers',
      lead: W5,
      members: [W5, W4],
    },
    {
      name: 'AC & Ventilation',
      desc: 'Split ACs, exhaust hoods and fresh air units',
      lead: W4,
      members: [W4, W2],
    },
  ]
  const teams: Record<string, string> = {}
  for (const t of teamDefs) {
    const row = await prisma.team.create({
      data: { organizationId: O, name: t.name, description: t.desc, leadUserId: t.lead.id },
    })
    for (const m of t.members)
      await prisma.teamMember.create({ data: { teamId: row.id, userId: m.id } })
    teams[t.name] = row.id
  }

  // ---- Locations (5 per restaurant)
  const LOCS = [
    {
      name: 'Hot Kitchen',
      type: 'HOT_KITCHEN',
      desc: 'Main cooking line with gas ranges and tandoor',
    },
    {
      name: 'Cold Kitchen & Cold Room',
      type: 'COLD_KITCHEN',
      desc: 'Salad, dessert prep and walk-in cooler',
    },
    { name: 'Dishwashing Area', type: 'DISHWASHING', desc: 'Pot wash and commercial dishwasher' },
    { name: 'Dining Hall', type: 'DINING', desc: 'Guest seating, 60 covers' },
    {
      name: 'Store Room & Utility',
      type: 'STORAGE',
      desc: 'Dry store, electrical panel and spares',
    },
  ] as const
  const loc: Record<string, Record<string, string>> = {}
  for (const r of restaurants) {
    loc[r.id] = {}
    for (const l of LOCS) {
      const row = await prisma.location.create({
        data: {
          organizationId: O,
          restaurantId: r.id,
          name: l.name,
          type: l.type,
          description: l.desc,
        },
      })
      loc[r.id]![l.type] = row.id
    }
  }

  // ---- Vendors + contracts
  const vendorDefs = [
    {
      name: 'CoolTech Refrigeration Services',
      contact: 'Jignesh Panchal',
      phone: '+919898012345',
      city: 'Ahmedabad',
      tax: '24AAKCC1234F1Z5',
      note: 'AMC for all walk-in coolers. 4-hour response.',
    },
    {
      name: 'Shree Ganesh Electricals',
      contact: 'Haresh Prajapati',
      phone: '+919824056789',
      city: 'Ahmedabad',
      tax: '24ABCPP5678K1Z2',
      note: 'Licensed electrical contractor (Class A).',
    },
    {
      name: 'AquaFix Plumbing Solutions',
      contact: 'Dinesh Rathod',
      phone: '+919909087654',
      city: 'Vadodara',
      tax: '24AAFCA4321M1Z8',
      note: 'Plumbing and RO servicing.',
    },
    {
      name: 'Gujarat Gas Safety Services',
      contact: 'Paresh Bhatt',
      phone: '+919727034567',
      city: 'Ahmedabad',
      tax: '24AAGCG8765N1Z3',
      note: 'Gas pipeline, burner and safety valve specialists.',
    },
    {
      name: 'Blue Star Authorised Service – Surat',
      contact: 'Amit Chauhan',
      phone: '+919879045678',
      city: 'Surat',
      tax: '24AABCB2468P1Z6',
      note: 'Authorised AC service centre.',
    },
  ]
  const vendors = []
  for (const v of vendorDefs) {
    const row = await prisma.vendor.create({
      data: {
        organizationId: O,
        name: v.name,
        contactName: v.contact,
        phone: v.phone,
        email: `service@${v.name.split(' ')[0]!.toLowerCase()}.in`,
        address: `${v.city}, Gujarat`,
        city: v.city,
        taxId: v.tax,
        notes: v.note,
      },
    })
    for (const r of restaurants)
      await prisma.vendorRestaurant.create({ data: { vendorId: row.id, restaurantId: r.id } })
    vendors.push(row)
  }
  const [V_COOL, V_ELEC, V_PLUMB, V_GAS, V_AC] = vendors as [
    (typeof vendors)[0],
    (typeof vendors)[0],
    (typeof vendors)[0],
    (typeof vendors)[0],
    (typeof vendors)[0],
  ]
  const contractDefs = [
    {
      v: V_COOL,
      r: null,
      title: 'Annual maintenance – walk-in coolers (all outlets)',
      no: 'CT/AMC/2026/014',
      value: 180000,
      hrs: 4,
    },
    {
      v: V_ELEC,
      r: R1.id,
      title: 'Electrical AMC – CG Road',
      no: 'SGE/AMC/2026/07',
      value: 45000,
      hrs: 6,
    },
    {
      v: V_PLUMB,
      r: R4.id,
      title: 'Plumbing & RO service – Alkapuri',
      no: 'AQF/2026/112',
      value: 36000,
      hrs: 8,
    },
    {
      v: V_GAS,
      r: null,
      title: 'Gas line safety audit – quarterly (all outlets)',
      no: 'GGS/QA/2026/03',
      value: 60000,
      hrs: 2,
    },
    {
      v: V_AC,
      r: R5.id,
      title: 'Split AC comprehensive AMC – Vesu',
      no: 'BS/SRT/AMC/889',
      value: 52000,
      hrs: 12,
    },
  ]
  for (const c of contractDefs)
    await prisma.vendorContract.create({
      data: {
        organizationId: O,
        vendorId: c.v.id,
        restaurantId: c.r,
        title: c.title,
        contractNumber: c.no,
        startDate: at(-200),
        endDate: at(165),
        value: c.value,
        responseHours: c.hrs,
        terms:
          'Preventive visits as per schedule; breakdown calls within response time; parts billed extra.',
      },
    })

  // ---- Asset categories (add the two the defaults don't have)
  for (const name of ['Gas range', 'Walk-in cooler'])
    await prisma.assetCategory.upsert({
      where: { organizationId_name: { organizationId: O, name } },
      update: {},
      create: { organizationId: O, name },
    })
  const cats = new Map(
    (await prisma.assetCategory.findMany({ where: { organizationId: O } })).map((c) => [
      c.name,
      c.id,
    ]),
  )

  // ---- Procedures
  type Step = {
    t: string
    i?: string
    type?: string
    unit?: string
    min?: number
    max?: number
    photo?: boolean
  }
  async function procedure(
    name: string,
    category: string | null,
    description: string,
    steps: Step[],
  ) {
    return prisma.procedure.create({
      data: {
        organizationId: O,
        name,
        category: category as never,
        description,
        steps: {
          create: steps.map((s, i) => ({
            position: i + 1,
            title: s.t,
            instruction: s.i ?? null,
            inputType: (s.type ?? 'PASS_FAIL_NA') as never,
            unit: s.unit ?? null,
            minValue: s.min ?? null,
            maxValue: s.max ?? null,
            requirePhoto: s.photo ?? false,
          })),
        },
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    })
  }
  const P_COOLER = await procedure(
    'Walk-in cooler monthly service',
    'REFRIGERATION',
    'Monthly preventive service of walk-in coolers.',
    [
      {
        t: 'Cabinet temperature',
        i: 'Read the display after the door has been closed 10 minutes.',
        type: 'NUMBER',
        unit: '°C',
        min: 0,
        max: 5,
      },
      {
        t: 'Clean condenser coil',
        i: 'Brush and blow out dust from the condenser fins.',
        photo: true,
      },
      {
        t: 'Check door gasket and hinges',
        i: 'No gaps when the door is closed; replace torn gasket.',
      },
      { t: 'Check refrigerant pressure', type: 'NUMBER', unit: 'psi', min: 20, max: 35 },
      { t: 'Drain line clear and no ice build-up' },
    ],
  )
  const P_AC = await procedure(
    'Split AC quarterly service',
    'AC',
    'Quarterly wet service of split ACs.',
    [
      { t: 'Clean indoor filters', photo: true },
      { t: 'Jet wash indoor coil and blower' },
      { t: 'Supply air temperature', type: 'NUMBER', unit: '°C', min: 10, max: 16 },
      { t: 'Check outdoor unit fan and wiring' },
    ],
  )
  const P_GAS = await procedure(
    'Gas range safety check',
    'GAS',
    'Weekly safety check of gas ranges and pipeline.',
    [
      {
        t: 'Soap-water leak test on all joints',
        i: 'No bubbles at any joint, valve or hose.',
        photo: true,
      },
      { t: 'Burner flame is blue and even' },
      { t: 'Main gas shut-off valve operates freely' },
      { t: 'Hose expiry date', type: 'TEXT' },
    ],
  )
  const P_DISH = await procedure(
    'Dishwasher descaling',
    'KITCHEN_EQUIPMENT',
    'Monthly descaling of the commercial dishwasher.',
    [
      { t: 'Drain and clean filters', photo: true },
      { t: 'Run descaling cycle with descaler' },
      { t: 'Rinse temperature', type: 'NUMBER', unit: '°C', min: 80, max: 90 },
      { t: 'Check wash arms spin freely' },
    ],
  )
  const P_PANEL = await procedure(
    'Electrical panel inspection',
    'ELECTRICAL',
    'Quarterly inspection of the main LT panel.',
    [
      { t: 'No burning smell or discoloured cables', photo: true },
      { t: 'Tighten busbar and MCB terminals' },
      { t: 'Earth leakage (ELCB) test trips' },
      { t: 'Phase voltage R-Y', type: 'NUMBER', unit: 'V', min: 390, max: 430 },
    ],
  )
  const P_OPEN = await procedure(
    'Daily opening checklist',
    null,
    'Done by the opening supervisor before service starts.',
    [
      { t: 'Walk-in cooler below 5°C', type: 'NUMBER', unit: '°C', min: 0, max: 5 },
      { t: 'Gas main valve opened and leak test done' },
      { t: 'Exhaust hood fans running' },
      { t: 'Hand wash sinks have soap and water' },
      { t: 'Dining AC and lights working' },
    ],
  )
  const P_CLOSE = await procedure(
    'Daily closing checklist',
    null,
    'Done by the closing supervisor after service.',
    [
      { t: 'All burners and gas main valve closed' },
      { t: 'Cold room door closed and locked' },
      { t: 'Dishwasher drained and switched off' },
      { t: 'Kitchen floor cleaned and dry', photo: true },
    ],
  )
  const P_FIRE = await procedure(
    'Weekly fire safety check',
    'FIRE_SAFETY',
    'Fire extinguishers, exits and alarm panel.',
    [
      { t: 'Fire extinguishers pressure in green zone', photo: true },
      { t: 'Emergency exits unblocked' },
      { t: 'Fire alarm panel shows no fault' },
      { t: 'Kitchen hood suppression system tagged' },
    ],
  )

  // ---- Assets (5 per restaurant)
  const ASSET_DEFS = [
    {
      key: 'cooler',
      name: 'Walk-in Cooler',
      cat: 'Walk-in cooler',
      loc: 'COLD_KITCHEN',
      crit: 'CRITICAL',
      mfr: 'Blue Star',
      model: 'WIC-2000',
      vendor: V_COOL,
      cost: 385000,
    },
    {
      key: 'range',
      name: '6-Burner Gas Range',
      cat: 'Gas range',
      loc: 'HOT_KITCHEN',
      crit: 'HIGH',
      mfr: 'Kitchen King',
      model: 'KK-6BR',
      vendor: V_GAS,
      cost: 68000,
    },
    {
      key: 'ac',
      name: 'Split AC 2 Ton – Dining',
      cat: 'AC unit',
      loc: 'DINING',
      crit: 'MEDIUM',
      mfr: 'Daikin',
      model: 'FTKM71',
      vendor: V_AC,
      cost: 72000,
    },
    {
      key: 'dish',
      name: 'Commercial Dishwasher',
      cat: 'Dishwasher',
      loc: 'DISHWASHING',
      crit: 'HIGH',
      mfr: 'Hobart',
      model: 'AM15',
      vendor: V_PLUMB,
      cost: 245000,
    },
    {
      key: 'panel',
      name: 'Main LT Electrical Panel',
      cat: 'Electrical panel',
      loc: 'STORAGE',
      crit: 'CRITICAL',
      mfr: 'L&T',
      model: 'MCCB-200A',
      vendor: V_ELEC,
      cost: 95000,
    },
  ] as const
  const asset: Record<string, Record<string, string>> = {}
  for (const [ri, r] of restaurants.entries()) {
    asset[r.id] = {}
    for (const [ai, a] of ASSET_DEFS.entries()) {
      const installed = at(-700 + ri * 60 + ai * 15)
      const row = await prisma.asset.create({
        data: {
          organizationId: O,
          publicId: generatePublicId(),
          assetCode: await nextCode(tx, O, 'AST', 4),
          name: a.name,
          categoryId: cats.get(a.cat)!,
          restaurantId: r.id,
          locationId: loc[r.id]![a.loc]!,
          criticality: a.crit,
          manufacturer: a.mfr,
          model: a.model,
          serialNumber: `${a.model.replace(/\W/g, '')}-${2400 + ri * 10 + ai}`,
          installDate: installed,
          purchaseDate: addMin(installed, -7 * 24 * 60),
          purchaseCost: a.cost,
          warrantyStart: installed,
          warrantyEnd: at(-700 + ri * 60 + ai * 15 + 730),
          vendorId: a.vendor.id,
          notes: `Installed by ${a.vendor.name}. Service as per AMC schedule.`,
        },
      })
      asset[r.id]![a.key] = row.id
      await prisma.assetHistory.create({
        data: {
          assetId: row.id,
          eventType: 'CREATED',
          actorId: superAdmin.id,
          note: 'Asset registered',
          occurredAt: installed,
        },
      } as never)
    }
  }
  // Category default procedures
  await prisma.assetCategory.update({
    where: { id: cats.get('Walk-in cooler')! },
    data: { defaultProcedureId: P_COOLER.id },
  })
  await prisma.assetCategory.update({
    where: { id: cats.get('AC unit')! },
    data: { defaultProcedureId: P_AC.id },
  })
  await prisma.assetCategory.update({
    where: { id: cats.get('Dishwasher')! },
    data: { defaultProcedureId: P_DISH.id },
  })

  // ---- Meters: cooler temperature in every restaurant
  const meterIds: Record<string, string> = {}
  for (const [ri, r] of restaurants.entries()) {
    const readings = [3.2, 3.6, 4.1, 3.4, ri === 0 ? 9.8 : 3.9, ri === 0 ? 3.1 : 3.5]
    const m = await prisma.assetMeter.create({
      data: {
        organizationId: O,
        assetId: asset[r.id]!.cooler!,
        name: 'Cabinet temperature',
        type: 'TEMPERATURE',
        unit: '°C',
        currentValue: readings.at(-1)!,
        previousValue: readings.at(-2)!,
        lastReadingAt: at(0, 9),
      },
    } as never)
    meterIds[r.id] = m.id
    for (const [i, v] of readings.entries())
      await prisma.meterReading.create({
        data: {
          meterId: m.id,
          value: v,
          previousValue: i ? readings[i - 1]! : null,
          readAt: at(i - readings.length + 1, 9),
          userId: [W2.id, W4.id, W2.id, W5.id, W4.id][ri]!,
          note: v > 5 ? 'Above limit — reported' : null,
        },
      })
  }

  // ---- Parts + stock
  const partDefs = [
    {
      name: 'Compressor run capacitor 45µF',
      no: 'CAP-45UF',
      cat: 'Refrigeration',
      unit: 'pcs',
      cost: 650,
      min: 2,
      vendor: V_COOL,
      loc: 'Rack A-1',
    },
    {
      name: 'Refrigerant gas R-404A',
      no: 'GAS-R404A',
      cat: 'Refrigeration',
      unit: 'kg',
      cost: 1450,
      min: 3,
      vendor: V_COOL,
      loc: 'Cage B',
    },
    {
      name: 'Gas burner brass nozzle',
      no: 'NOZ-BR-2MM',
      cat: 'Gas',
      unit: 'pcs',
      cost: 180,
      min: 6,
      vendor: V_GAS,
      loc: 'Rack A-3',
    },
    {
      name: 'Split AC air filter (pair)',
      no: 'FLT-AC-71',
      cat: 'AC',
      unit: 'set',
      cost: 420,
      min: 4,
      vendor: V_AC,
      loc: 'Rack C-2',
    },
    {
      name: 'MCB 32A double pole',
      no: 'MCB-32A-DP',
      cat: 'Electrical',
      unit: 'pcs',
      cost: 560,
      min: 3,
      vendor: V_ELEC,
      loc: 'Rack D-1',
    },
  ]
  const parts = []
  for (const p of partDefs)
    parts.push(
      await prisma.part.create({
        data: {
          organizationId: O,
          name: p.name,
          partNumber: p.no,
          sku: `BKD-${p.no}`,
          category: p.cat,
          unit: p.unit,
          unitCost: p.cost,
          minStock: p.min,
          reorderQty: p.min * 2,
          preferredVendorId: p.vendor.id,
          storageLocation: p.loc,
          description: `${p.name} – standard spare kept at every outlet.`,
        },
      }),
    )
  const [P_CAP, P_R404, P_NOZ, P_FLT, P_MCB] = parts as [
    (typeof parts)[0],
    (typeof parts)[0],
    (typeof parts)[0],
    (typeof parts)[0],
    (typeof parts)[0],
  ]
  // quantities[restaurant][part]; some deliberately at/below minimum for low-stock alerts
  const qty = [
    [4, 6, 12, 8, 5],
    [3, 4, 10, 6, 2],
    [2, 5, 1, 8, 4],
    [5, 2, 9, 3, 6],
    [3, 7, 11, 2, 5],
  ]
  for (const [ri, r] of restaurants.entries())
    for (const [pi, p] of parts.entries()) {
      const q = qty[ri]![pi]!
      await prisma.inventory.create({
        data: {
          organizationId: O,
          partId: p.id,
          restaurantId: r.id,
          quantity: q,
          storageLocation: p.storageLocation,
        },
      } as never)
      await prisma.inventoryTransaction.create({
        data: {
          organizationId: O,
          partId: p.id,
          restaurantId: r.id,
          type: 'RECEIPT',
          quantityDelta: q,
          balanceAfter: q,
          unitCost: p.unitCost,
          actorId: managers[ri]!.id,
          reason: 'Opening stock',
          createdAt: at(-60),
        },
      } as never)
    }

  // ---- Labels
  const labelDefs = [
    ['Urgent', '#ef4444'],
    ['Warranty claim', '#8b5cf6'],
    ['Vendor visit', '#0ea5e9'],
    ['Recurring issue', '#f59e0b'],
    ['Food safety', '#10b981'],
  ] as const
  const labels: Record<string, string> = {}
  for (const [name, color] of labelDefs)
    labels[name] = (await prisma.label.create({ data: { organizationId: O, name, color } })).id

  // ---- PM schedules (one per restaurant)
  const pmDefs = [
    {
      r: R1,
      a: 'cooler',
      name: 'Walk-in cooler monthly service',
      f: 'MONTHLY',
      p: P_COOLER,
      cat: 'REFRIGERATION',
      w: W2,
      due: 2,
      mins: 90,
    },
    {
      r: R2,
      a: 'ac',
      name: 'Dining AC quarterly service',
      f: 'QUARTERLY',
      p: P_AC,
      cat: 'AC',
      w: W1,
      due: 12,
      mins: 120,
    },
    {
      r: R3,
      a: 'cooler',
      name: 'Walk-in cooler monthly service',
      f: 'MONTHLY',
      p: P_COOLER,
      cat: 'REFRIGERATION',
      w: W2,
      due: 1,
      mins: 90,
    },
    {
      r: R4,
      a: 'dish',
      name: 'Dishwasher monthly descaling',
      f: 'MONTHLY',
      p: P_DISH,
      cat: 'KITCHEN_EQUIPMENT',
      w: W5,
      due: 20,
      mins: 60,
    },
    {
      r: R5,
      a: 'range',
      name: 'Gas range weekly safety check',
      f: 'WEEKLY',
      p: P_GAS,
      cat: 'GAS',
      w: W4,
      due: 3,
      mins: 30,
    },
  ] as const
  const pm: Record<string, string> = {}
  for (const d of pmDefs) {
    const row = await prisma.pmSchedule.create({
      data: {
        organizationId: O,
        restaurantId: d.r.id,
        assetId: asset[d.r.id]![d.a]!,
        name: d.name,
        description: `Preventive maintenance as per ${d.p.name}.`,
        frequency: d.f,
        timeOfDay: '07:00',
        procedureId: d.p.id,
        category: d.cat,
        priority: 'MEDIUM',
        defaultAssigneeUserId: d.w.id,
        estimatedMinutes: d.mins,
        leadTimeDays: 3,
        startDate: at(-90, 7),
        nextDueAt: at(d.due, 7),
        lastGeneratedAt: at(-28, 7),
      },
    } as never)
    pm[`${d.r.code}-${d.a}`] = row.id
  }

  // ---- Requests
  async function request(d: {
    r: typeof R1
    loc: string
    asset?: string
    cat: string
    title: string
    desc: string
    pri: string
    status: string
    by?: string | null
    guest?: { name: string; phone: string }
    when: Date
    reviewer?: string
    reject?: string
    note?: string
    photoTopic: string
    photoCaption: string
  }) {
    const row = await prisma.request.create({
      data: {
        organizationId: O,
        code: await nextCode(tx, O, 'REQ', 6),
        restaurantId: d.r.id,
        locationId: loc[d.r.id]![d.loc]!,
        assetId: d.asset ? asset[d.r.id]![d.asset]! : null,
        category: d.cat as never,
        title: d.title,
        description: d.desc,
        priority: d.pri as never,
        status: d.status as never,
        requestedById: d.by ?? null,
        guestName: d.guest?.name ?? null,
        guestPhone: d.guest?.phone ?? null,
        reviewedById: d.reviewer ?? null,
        reviewedAt: d.reviewer ? addMin(d.when, 40) : null,
        rejectionReason: d.reject ?? null,
        reviewNote: d.note ?? null,
        createdAt: d.when,
      },
    } as never)
    await attachPhoto({
      ownerType: 'REQUEST',
      ownerId: row.id,
      organizationId: O,
      topic: d.photoTopic,
      caption: d.photoCaption,
      uploadedById: d.by ?? null,
      when: d.when,
      fileName: 'IMG_20261003_1012.jpg',
    })
    return row
  }
  const REQ1 = await request({
    r: R1,
    loc: 'COLD_KITCHEN',
    asset: 'cooler',
    cat: 'REFRIGERATION',
    title: 'Cold room door not sealing properly',
    desc: 'The walk-in cooler door does not close fully, cold air is leaking and there is water on the floor near the door. Gasket at the bottom looks torn.',
    pri: 'HIGH',
    status: 'CONVERTED',
    by: STAFF.id,
    when: at(-2, 11, 15),
    reviewer: A1.id,
    note: 'Converted to work order, Suresh to replace gasket.',
    photoTopic: 'fridge',
    photoCaption: 'Gap at the bottom of the cold room door',
  })
  const REQ2 = await request({
    r: R2,
    loc: 'DISHWASHING',
    cat: 'PLUMBING',
    title: 'Water leaking under hand wash sink',
    desc: 'Continuous dripping from the pipe under the hand wash sink near dishwashing. Bucket kept for now.',
    pri: 'MEDIUM',
    status: 'CONVERTED',
    by: A2.id,
    when: at(-4, 16, 30),
    reviewer: A2.id,
    note: 'Assigned to Mahesh.',
    photoTopic: 'plumbing',
    photoCaption: 'Leak at the trap joint',
  })
  const REQ3 = await request({
    r: R3,
    loc: 'DINING',
    asset: 'ac',
    cat: 'AC',
    title: 'Dining AC making loud rattling noise',
    desc: 'AC near table 6 is making a rattling sound since lunch time. Guests complained. Cooling is okay.',
    pri: 'MEDIUM',
    status: 'APPROVED',
    by: A3.id,
    when: at(-1, 14, 5),
    reviewer: SUP.id,
    note: 'Approved — vendor visit to be scheduled with AC service.',
    photoTopic: 'dining',
    photoCaption: 'AC unit above table 6',
  })
  const REQ4 = await request({
    r: R4,
    loc: 'HOT_KITCHEN',
    asset: 'range',
    cat: 'GAS',
    title: 'Slight gas smell near the gas range',
    desc: 'Chef noticed a faint gas smell near the right side burners in the morning. Burners switched off and windows opened.',
    pri: 'CRITICAL',
    status: 'NEW',
    guest: { name: 'Chef Rakesh Nair', phone: '+919712345678' },
    when: at(0, 8, 20),
    photoTopic: 'gas',
    photoCaption: 'Right side burners of the range',
  })
  await request({
    r: R5,
    loc: 'DINING',
    cat: 'ELECTRICAL',
    title: 'Dining hall tube light flickering',
    desc: 'One tube light near the entrance keeps flickering in the evening.',
    pri: 'LOW',
    status: 'REJECTED',
    by: A5.id,
    when: at(-3, 19, 40),
    reviewer: A5.id,
    reject:
      'Duplicate — already covered under the exhaust hood / electrical work order for this week.',
    photoTopic: 'dining',
    photoCaption: 'Flickering light near entrance',
  })

  // ---- Work orders
  interface WoDef {
    r: typeof R1
    title: string
    desc: string
    type?: 'REACTIVE' | 'PREVENTIVE' | 'INSPECTION_FOLLOWUP'
    cat: string
    loc: string
    asset?: string
    pri: string
    status: string
    worker?: { id: string } | null
    helper?: { id: string }
    team?: string
    vendor?: { id: string }
    createdBy: { id: string }
    created: Date
    due: Date
    est: number
    procedure?: typeof P_COOLER
    pmKey?: string
    labels?: string[]
    holdReason?: string
    photos: { topic: string; caption: string; stage: 'BEFORE' | 'DURING' | 'AFTER' }[]
    chat: { by: { id: string }; body: string; internal?: boolean }[]
    completion?: {
      problem: string
      root: string
      work: string
      newParts?: string
      oldParts?: string
      rec?: string
      cond: 'FULLY_WORKING' | 'WORKING_WITH_LIMITATIONS'
      minutes: number
    }
    partsUsed?: { part: typeof P_CAP; qty: number }[]
    costs?: {
      type: 'VENDOR' | 'MATERIAL' | 'TRAVEL' | 'OTHER'
      desc: string
      amount: number
      vendor?: { id: string }
    }[]
  }

  const FLOW: Record<string, string[]> = {
    OPEN: ['OPEN'],
    ASSIGNED: ['OPEN', 'ASSIGNED'],
    SCHEDULED: ['OPEN', 'ASSIGNED', 'SCHEDULED'],
    IN_PROGRESS: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'],
    ON_HOLD: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'],
    COMPLETED: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'],
    VERIFIED: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'],
    CLOSED: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'],
  }

  async function workOrder(d: WoDef) {
    const flow = FLOW[d.status]!
    const started = flow.includes('IN_PROGRESS') ? addMin(d.created, 90) : null
    const done = d.completion ? addMin(started!, d.completion.minutes) : null
    const verified = flow.includes('VERIFIED') ? addMin(done!, 120) : null
    const closed = flow.includes('CLOSED') ? addMin(verified!, 30) : null
    const wo = await prisma.workOrder.create({
      data: {
        organizationId: O,
        code: await nextCode(tx, O, 'WO', 6),
        title: d.title,
        description: d.desc,
        type: d.type ?? 'REACTIVE',
        category: d.cat as never,
        restaurantId: d.r.id,
        locationId: loc[d.r.id]![d.loc]!,
        assetId: d.asset ? asset[d.r.id]![d.asset]! : null,
        priority: d.pri as never,
        status: d.status as never,
        assignedUserId: d.worker?.id ?? null,
        assignedTeamId: d.team ? teams[d.team]! : null,
        vendorId: d.vendor?.id ?? null,
        supervisorId: [R1.id, R2.id, R3.id].includes(d.r.id) ? SUP.id : null,
        scheduledStart: flow.includes('SCHEDULED') ? addMin(d.due, -120) : null,
        dueDate: d.due,
        estimatedMinutes: d.est,
        actualMinutes: d.completion?.minutes ?? null,
        procedureId: d.procedure?.id ?? null,
        pmScheduleId: d.pmKey ? pm[d.pmKey]! : null,
        pmDueDate: d.pmKey ? d.due : null,
        createdById: d.createdBy.id,
        startedAt: started,
        completedAt: done,
        verifiedAt: verified,
        verifiedById: verified ? d.createdBy.id : null,
        closedAt: closed,
        closedById: closed ? d.createdBy.id : null,
        holdReason: d.holdReason ?? null,
        completionNotes: d.completion?.work ?? null,
        createdAt: d.created,
      },
    } as never)
    const actor = (s: string) =>
      ['OPEN', 'ASSIGNED', 'VERIFIED', 'CLOSED'].includes(s)
        ? d.createdBy.id
        : (d.worker?.id ?? d.createdBy.id)
    const stamp = (s: string, i: number) =>
      s === 'IN_PROGRESS'
        ? started!
        : s === 'COMPLETED'
          ? done!
          : s === 'VERIFIED'
            ? verified!
            : s === 'CLOSED'
              ? closed!
              : s === 'ON_HOLD'
                ? addMin(started!, 45)
                : addMin(d.created, i * 10)
    let prev: string | null = null
    for (const [i, s] of flow.entries()) {
      await prisma.workOrderStatusHistory.create({
        data: {
          workOrderId: wo.id,
          fromStatus: prev as never,
          toStatus: s as never,
          actorId: actor(s),
          note:
            s === 'ON_HOLD'
              ? d.holdReason
              : s === 'VERIFIED'
                ? 'Checked on site, working fine.'
                : null,
          createdAt: stamp(s, i),
        },
      } as never)
      prev = s
    }
    if (d.helper)
      await prisma.workOrderAssignment.create({
        data: {
          workOrderId: wo.id,
          userId: d.helper.id,
          addedById: d.createdBy.id,
          addedAt: addMin(d.created, 15),
        },
      })
    for (const l of d.labels ?? [])
      await prisma.workOrderLabel.create({ data: { workOrderId: wo.id, labelId: labels[l]! } })

    // Checklist from the procedure; answered when the work is done
    if (d.procedure) {
      const answered = !!d.completion
      const sample: Record<string, number> = {
        '°C': d.procedure === P_DISH ? 84 : d.procedure === P_AC ? 13 : 3.4,
        psi: 28,
        V: 412,
      }
      for (const s of d.procedure.steps) {
        const item = await prisma.workOrderChecklistItem.create({
          data: {
            workOrderId: wo.id,
            position: s.position,
            title: s.title,
            instruction: s.instruction,
            inputType: s.inputType,
            unit: s.unit,
            minValue: s.minValue,
            maxValue: s.maxValue,
            required: s.required,
            requirePhoto: s.requirePhoto,
            ...(answered
              ? s.inputType === 'NUMBER'
                ? {
                    numericValue: sample[s.unit ?? ''] ?? 1,
                    result: 'PASS',
                    completedById: d.worker!.id,
                    completedAt: addMin(started!, 20 + s.position * 8),
                  }
                : s.inputType === 'TEXT'
                  ? {
                      textValue: 'Valid till 03/2028',
                      result: 'PASS',
                      completedById: d.worker!.id,
                      completedAt: addMin(started!, 20 + s.position * 8),
                    }
                  : {
                      result: 'PASS',
                      completedById: d.worker!.id,
                      completedAt: addMin(started!, 20 + s.position * 8),
                    }
              : {}),
          },
        } as never)
        if (answered && s.requirePhoto)
          await attachPhoto({
            ownerType: 'CHECKLIST_ITEM',
            ownerId: item.id,
            organizationId: O,
            topic: d.photos[0]?.topic ?? 'tools',
            caption: s.title,
            uploadedById: d.worker!.id,
            when: addMin(started!, 25),
            fileName: 'IMG_checklist.jpg',
          })
      }
    }

    // Photos
    for (const [i, p] of d.photos.entries()) {
      const when =
        p.stage === 'BEFORE'
          ? addMin(started ?? d.created, 5)
          : p.stage === 'DURING'
            ? addMin(started ?? d.created, 40)
            : (done ?? addMin(d.created, 60))
      await attachPhoto({
        ownerType: 'WORK_ORDER',
        ownerId: wo.id,
        organizationId: O,
        topic: p.topic,
        caption: p.caption,
        stage: p.stage,
        uploadedById: d.worker?.id ?? d.createdBy.id,
        when: addMin(when, i),
        fileName: `IMG_2026_${p.stage.toLowerCase()}_${i + 1}.jpg`,
      })
    }

    // Comments
    for (const [i, m] of d.chat.entries())
      await prisma.message.create({
        data: {
          workOrderId: wo.id,
          authorId: m.by.id,
          body: m.body,
          internal: m.internal ?? false,
          createdAt: addMin(d.created, 20 + i * 35),
        },
      } as never)

    // Time, completion, parts, costs
    if (started && d.worker) {
      const minutes = d.completion?.minutes ?? 45
      await prisma.workOrderTimeEntry.create({
        data: {
          workOrderId: wo.id,
          userId: d.worker.id,
          startedAt: started,
          endedAt: addMin(started, minutes),
          minutes,
          note: d.completion ? 'Diagnosis and repair' : 'Diagnosis',
          createdById: d.worker.id,
        },
      })
    }
    if (d.completion && d.worker) {
      const c = d.completion
      await prisma.workOrderCompletion.create({
        data: {
          workOrderId: wo.id,
          problemFound: c.problem,
          rootCause: c.root,
          workPerformed: c.work,
          newPartsInstalled: c.newParts ?? null,
          oldPartsRemoved: c.oldParts ?? null,
          recommendation: c.rec ?? null,
          finalCondition: c.cond,
          noPartsUsed: !d.partsUsed?.length,
          labourMinutes: c.minutes,
          confirmedById: d.worker.id,
          confirmedAt: done!,
        },
      })
    }
    for (const pu of d.partsUsed ?? []) {
      await prisma.workOrderPart.create({
        data: {
          workOrderId: wo.id,
          partId: pu.part.id,
          qtyRequired: pu.qty,
          qtyUsed: d.completion ? pu.qty : 0,
          unitCostSnapshot: pu.part.unitCost,
        },
      })
      if (d.completion) {
        const inv = await prisma.inventory.findUniqueOrThrow({
          where: { partId_restaurantId: { partId: pu.part.id, restaurantId: d.r.id } },
        })
        const balance = Number(inv.quantity) - pu.qty
        await prisma.inventory.update({ where: { id: inv.id }, data: { quantity: balance } })
        await prisma.inventoryTransaction.create({
          data: {
            organizationId: O,
            partId: pu.part.id,
            restaurantId: d.r.id,
            type: 'CONSUMPTION',
            quantityDelta: -pu.qty,
            balanceAfter: balance,
            unitCost: pu.part.unitCost,
            referenceType: 'WORK_ORDER',
            referenceId: wo.id,
            actorId: d.worker!.id,
            issuedToId: d.worker!.id,
            reason: `Used on ${wo.code}`,
            createdAt: addMin(started!, 30),
          },
        } as never)
      } else {
        await prisma.partReservation.create({
          data: {
            organizationId: O,
            partId: pu.part.id,
            restaurantId: d.r.id,
            workOrderId: wo.id,
            quantity: pu.qty,
            createdById: d.createdBy.id,
          },
        } as never)
      }
    }
    for (const c of d.costs ?? [])
      await prisma.workOrderCost.create({
        data: {
          workOrderId: wo.id,
          type: c.type,
          description: c.desc,
          amount: c.amount,
          vendorId: c.vendor?.id ?? null,
          createdById: d.createdBy.id,
        },
      })

    // Asset timeline
    if (d.asset && done)
      await prisma.assetHistory.create({
        data: {
          assetId: asset[d.r.id]![d.asset]!,
          eventType: 'WORK_ORDER_COMPLETED',
          workOrderId: wo.id,
          actorId: d.worker?.id ?? null,
          note: `${wo.code} · ${d.title}`,
          occurredAt: done,
        },
      } as never)
    return wo
  }

  const WO1 = await workOrder({
    r: R1,
    title: 'Walk-in cooler not cooling below 8°C',
    cat: 'REFRIGERATION',
    loc: 'COLD_KITCHEN',
    asset: 'cooler',
    pri: 'CRITICAL',
    status: 'CLOSED',
    desc: 'Cooler temperature went up to 9.8°C during the night. Dairy and marinated items shifted to the reach-in fridge. Please check the compressor urgently.',
    worker: W2,
    team: 'Refrigeration & Cold Room',
    vendor: V_COOL,
    createdBy: A1,
    created: at(-6, 7, 40),
    due: at(-6, 14),
    est: 120,
    procedure: P_COOLER,
    labels: ['Urgent', 'Food safety'],
    photos: [
      { topic: 'fridge', caption: 'Display showing 9.8°C in the morning', stage: 'BEFORE' },
      { topic: 'tools', caption: 'Compressor capacitor found swollen', stage: 'DURING' },
      { topic: 'fridge', caption: 'Temperature back to 3.1°C after repair', stage: 'AFTER' },
    ],
    chat: [
      { by: A1, body: '@Suresh please check first thing, we have a 40-cover booking tonight.' },
      {
        by: W2,
        body: 'Reached site. Compressor is tripping, run capacitor looks swollen. Replacing it and topping up gas.',
      },
      { by: W2, body: 'Done. Holding at 3.1°C for the last 45 minutes.' },
      { by: A1, body: 'Thanks Suresh, verified on site. Closing.' },
    ],
    completion: {
      problem: 'Compressor tripping on overload; cabinet at 9.8°C.',
      root: 'Run capacitor failed (swollen) and refrigerant slightly low.',
      work: 'Replaced 45µF run capacitor, charged 1.5 kg R-404A, cleaned condenser coil, checked door gasket.',
      newParts: '1 × capacitor 45µF, 1.5 kg R-404A',
      oldParts: 'Swollen capacitor',
      rec: 'Keep condenser area clear of boxes for airflow.',
      cond: 'FULLY_WORKING',
      minutes: 105,
    },
    partsUsed: [
      { part: P_CAP, qty: 1 },
      { part: P_R404, qty: 1.5 },
    ],
    costs: [
      { type: 'VENDOR', desc: 'CoolTech emergency visit charge', amount: 1500, vendor: V_COOL },
      { type: 'TRAVEL', desc: 'Auto fare', amount: 180 },
    ],
  })
  const WO2 = await workOrder({
    r: R1,
    title: 'Replace cold room door gasket',
    cat: 'REFRIGERATION',
    loc: 'COLD_KITCHEN',
    asset: 'cooler',
    pri: 'HIGH',
    status: 'IN_PROGRESS',
    desc: 'From staff request: door not sealing, water on floor. Replace bottom gasket and adjust hinges.',
    worker: W2,
    createdBy: A1,
    created: at(-2, 12),
    due: at(1, 18),
    est: 60,
    labels: ['Food safety'],
    photos: [
      { topic: 'fridge', caption: 'Torn gasket at the bottom of the door', stage: 'BEFORE' },
    ],
    chat: [
      { by: A1, body: 'Converted from staff request. Please replace the gasket this week.' },
      {
        by: W2,
        body: 'Old gasket removed. New gasket ordered from CoolTech, fitting it today evening.',
      },
    ],
  })
  const WO3 = await workOrder({
    r: R2,
    title: 'Fix leak under hand wash sink',
    cat: 'PLUMBING',
    loc: 'DISHWASHING',
    pri: 'MEDIUM',
    status: 'COMPLETED',
    desc: 'Continuous dripping from the trap under the hand wash sink. Bucket placed.',
    worker: W3,
    createdBy: A2,
    created: at(-4, 17),
    due: at(-2, 18),
    est: 45,
    photos: [
      { topic: 'plumbing', caption: 'Leak at the trap joint', stage: 'BEFORE' },
      { topic: 'plumbing', caption: 'New trap and washer fitted, no leak', stage: 'AFTER' },
    ],
    chat: [
      {
        by: W3,
        body: 'Trap washer worn out. Replaced trap with new PVC trap and sealed the waste coupling.',
      },
      { by: A2, body: 'Will check tomorrow morning and verify.', internal: true },
    ],
    completion: {
      problem: 'Water dripping from sink trap joint.',
      root: 'Old rubber washer worn out, trap cracked.',
      work: 'Replaced PVC bottle trap and washer, applied sealant on waste coupling, tested 15 minutes.',
      newParts: '1 × PVC bottle trap 32mm',
      cond: 'FULLY_WORKING',
      minutes: 40,
    },
    costs: [{ type: 'MATERIAL', desc: 'PVC bottle trap + sealant (local purchase)', amount: 340 }],
  })
  const WO4 = await workOrder({
    r: R2,
    title: 'Main panel MCB tripping during lunch rush',
    cat: 'ELECTRICAL',
    loc: 'STORAGE',
    asset: 'panel',
    pri: 'HIGH',
    status: 'ASSIGNED',
    desc: 'Kitchen MCB (32A) trips 2–3 times during lunch when both ovens and the dishwasher run. Check load and replace if faulty.',
    worker: W1,
    team: 'Electrical',
    createdBy: A2,
    created: at(-3, 13, 30),
    due: at(-1, 18),
    est: 90,
    labels: ['Recurring issue'],
    partsUsed: [{ part: P_MCB, qty: 1 }],
    photos: [{ topic: 'electrical', caption: 'Kitchen MCB in tripped position', stage: 'BEFORE' }],
    chat: [
      { by: A2, body: 'Happened again today at 1:15 pm. Please prioritise.' },
      { by: W1, body: 'Will come tomorrow 10 am with clamp meter and a new MCB.' },
    ],
  })
  const WO5 = await workOrder({
    r: R3,
    title: 'Gas range burner flame uneven (yellow flame)',
    cat: 'GAS',
    loc: 'HOT_KITCHEN',
    asset: 'range',
    pri: 'HIGH',
    status: 'ON_HOLD',
    desc: 'Burners 2 and 5 give yellow, uneven flame and soot on vessels. Nozzles likely clogged/worn.',
    worker: W4,
    helper: W5,
    team: 'Gas & Kitchen Equipment',
    createdBy: A3,
    created: at(-3, 10),
    due: at(2, 18),
    est: 60,
    holdReason: 'Waiting for brass nozzles — purchase order raised, stock is 1.',
    partsUsed: [{ part: P_NOZ, qty: 4 }],
    labels: ['Vendor visit'],
    photos: [
      { topic: 'gas', caption: 'Yellow flame on burner 2', stage: 'BEFORE' },
      { topic: 'gas', caption: 'Nozzle removed – heavily carboned', stage: 'DURING' },
    ],
    chat: [
      { by: W4, body: 'Cleaned all nozzles, burner 2 and 5 nozzles are worn. Need 4 new nozzles.' },
      {
        by: A3,
        body: 'PO raised to Gujarat Gas Safety, expected in 2 days. Use burners 1,3,4,6 till then.',
      },
    ],
  })
  const WO6 = await workOrder({
    r: R3,
    title: 'Walk-in cooler monthly service',
    type: 'PREVENTIVE',
    cat: 'REFRIGERATION',
    loc: 'COLD_KITCHEN',
    asset: 'cooler',
    pri: 'MEDIUM',
    status: 'SCHEDULED',
    desc: 'Monthly preventive service as per procedure.',
    worker: W2,
    createdBy: superAdmin,
    created: at(-2, 7),
    due: at(1, 11),
    est: 90,
    procedure: P_COOLER,
    pmKey: `${R3.code}-cooler`,
    photos: [],
    chat: [{ by: W2, body: 'Scheduled for tomorrow 9 am before prep starts.' }],
  })
  const WO7 = await workOrder({
    r: R4,
    title: 'Dishwasher not draining after cycle',
    cat: 'KITCHEN_EQUIPMENT',
    loc: 'DISHWASHING',
    asset: 'dish',
    pri: 'HIGH',
    status: 'IN_PROGRESS',
    desc: 'Water stays in the tank after the wash cycle. Dishes coming out with food particles.',
    worker: W5,
    helper: W3,
    team: 'Gas & Kitchen Equipment',
    createdBy: A4,
    created: at(-1, 15),
    due: at(0, 21),
    est: 75,
    labels: ['Urgent'],
    photos: [
      { topic: 'dishwasher', caption: 'Standing water in the tank', stage: 'BEFORE' },
      { topic: 'kitchen', caption: 'Drain filter removed for cleaning', stage: 'DURING' },
    ],
    chat: [
      { by: A4, body: 'Dishes are being washed manually right now, please fix before dinner.' },
      {
        by: W5,
        body: 'Drain filter fully choked with food waste. Cleaning it and checking the drain pump.',
      },
    ],
  })
  const WO8 = await workOrder({
    r: R4,
    title: 'Dishwasher monthly descaling',
    type: 'PREVENTIVE',
    cat: 'KITCHEN_EQUIPMENT',
    loc: 'DISHWASHING',
    asset: 'dish',
    pri: 'MEDIUM',
    status: 'VERIFIED',
    desc: 'Monthly descaling as per procedure.',
    worker: W5,
    createdBy: A4,
    created: at(-10, 7),
    due: at(-9, 12),
    est: 60,
    procedure: P_DISH,
    pmKey: `${R4.code}-dish`,
    photos: [{ topic: 'dishwasher', caption: 'After descaling – clean tank', stage: 'AFTER' }],
    chat: [{ by: W5, body: 'Descaling done, rinse temperature 84°C.' }],
    completion: {
      problem: 'Scheduled descaling.',
      root: 'Hard water scale (preventive).',
      work: 'Drained, cleaned filters, ran descaling cycle, rinsed and checked wash arms.',
      cond: 'FULLY_WORKING',
      minutes: 55,
    },
  })
  const WO9 = await workOrder({
    r: R5,
    title: 'Dining AC not cooling – guests complaining',
    cat: 'AC',
    loc: 'DINING',
    asset: 'ac',
    pri: 'CRITICAL',
    status: 'OPEN',
    desc: 'AC is running but blowing warm air since afternoon. Dining hall at 29°C. Outdoor unit fan not spinning.',
    createdBy: A5,
    created: at(0, 13, 10),
    due: at(0, 19),
    est: 90,
    team: 'AC & Ventilation',
    labels: ['Urgent', 'Warranty claim'],
    photos: [{ topic: 'dining', caption: 'Dining hall – AC above the bar side', stage: 'BEFORE' }],
    chat: [
      { by: A5, body: 'Unit is still in warranty, please coordinate with Blue Star if needed.' },
    ],
  })
  const WO10 = await workOrder({
    r: R5,
    title: 'Exhaust hood filters cleaning – grease build-up',
    type: 'INSPECTION_FOLLOWUP',
    cat: 'CLEANING',
    loc: 'HOT_KITCHEN',
    pri: 'MEDIUM',
    status: 'ASSIGNED',
    desc: 'Opening inspection found heavy grease on hood filters. Deep clean all baffle filters.',
    worker: W4,
    createdBy: A5,
    created: at(0, 9),
    due: at(1, 16),
    est: 120,
    labels: ['Food safety'],
    photos: [{ topic: 'kitchen', caption: 'Hood filters with grease', stage: 'BEFORE' }],
    chat: [{ by: W4, body: 'Will do after lunch service tomorrow.' }],
  })

  // Requests → work orders
  await prisma.request.update({ where: { id: REQ1.id }, data: { convertedWorkOrderId: WO2.id } })
  await prisma.request.update({ where: { id: REQ2.id }, data: { convertedWorkOrderId: WO3.id } })

  // Root cause analysis on the critical breakdown
  await prisma.rootCauseAnalysis.create({
    data: {
      organizationId: O,
      workOrderId: WO1.id,
      assetId: asset[R1.id]!.cooler!,
      failure: 'Walk-in cooler temperature rose to 9.8°C overnight.',
      cause: 'Compressor tripping on overload.',
      rootCause: 'Run capacitor aged and failed; condenser coil dusty adding load.',
      category: 'WEAR_AND_TEAR',
      correctiveAction: 'Replaced capacitor, topped up refrigerant, cleaned coil.',
      preventiveAction: 'Capacitor check added to monthly service; keep 2 spares in store.',
      createdById: A1.id,
    },
  } as never)
  await prisma.assetDowntime.create({
    data: {
      assetId: asset[R1.id]!.cooler!,
      workOrderId: WO1.id,
      startedAt: at(-6, 2),
      endedAt: at(-6, 11, 30),
      reason: 'Compressor failure',
    },
  } as never)

  // Asset status reflects open work
  const status: [string, string, string][] = [
    [R2.id, 'panel', 'WARNING'],
    [R3.id, 'range', 'WARNING'],
    [R4.id, 'dish', 'UNDER_MAINTENANCE'],
    [R5.id, 'ac', 'BROKEN'],
  ]
  for (const [rid, key, s] of status) {
    await prisma.asset.update({ where: { id: asset[rid]![key]! }, data: { status: s as never } })
    await prisma.assetHistory.create({
      data: {
        assetId: asset[rid]![key]!,
        eventType: 'STATUS_CHANGED',
        actorId: superAdmin.id,
        oldValue: { status: 'OPERATIONAL' },
        newValue: { status: s },
        occurredAt: at(-1, 12),
      },
    } as never)
  }

  // ---- Inspection templates + inspections
  const tplDefs = [
    { type: 'OPENING', name: 'Daily opening checklist', p: P_OPEN },
    { type: 'CLOSING', name: 'Daily closing checklist', p: P_CLOSE },
    { type: 'SAFETY', name: 'Weekly fire safety check', p: P_FIRE },
    { type: 'ASSET', name: 'Gas range safety check', p: P_GAS },
    { type: 'ASSET', name: 'Electrical panel inspection', p: P_PANEL },
  ] as const
  const tpl: Record<string, { id: string; type: string; p: typeof P_OPEN }> = {}
  for (const t of tplDefs) {
    const row = await prisma.inspectionTemplate.create({
      data: { organizationId: O, type: t.type, name: t.name, procedureId: t.p.id },
    })
    tpl[t.name] = { id: row.id, type: t.type, p: t.p }
  }
  const inspDefs = [
    {
      t: 'Daily opening checklist',
      r: R5,
      by: W4,
      when: at(0, 8, 30),
      fail: [3],
      failNote: 'Hood filters heavily greased — work order raised.',
      corrective: WO10.id,
      asset: undefined,
    },
    { t: 'Daily opening checklist', r: R1, by: SUP, when: at(0, 8, 0), fail: [], asset: undefined },
    {
      t: 'Daily closing checklist',
      r: R2,
      by: SUP,
      when: at(-1, 23, 10),
      fail: [],
      asset: undefined,
    },
    { t: 'Weekly fire safety check', r: R3, by: W4, when: at(-2, 16), fail: [], asset: undefined },
    {
      t: 'Electrical panel inspection',
      r: R2,
      by: W1,
      when: at(-3, 11),
      fail: [1],
      failNote: 'Kitchen MCB terminal discoloured — see work order.',
      corrective: WO4.id,
      asset: 'panel',
    },
  ]
  for (const d of inspDefs) {
    const t = tpl[d.t]!
    const insp = await prisma.inspection.create({
      data: {
        organizationId: O,
        code: await nextCode(tx, O, 'INS', 6),
        templateId: t.id,
        restaurantId: d.r.id,
        assetId: d.asset ? asset[d.r.id]![d.asset]! : null,
        type: t.type as never,
        performedById: d.by.id,
        status: 'SUBMITTED',
        startedAt: d.when,
        submittedAt: addMin(d.when, 18),
        passCount: t.p.steps.length - d.fail.length,
        failCount: d.fail.length,
        naCount: 0,
        notes: d.fail.length ? d.failNote : 'All OK.',
        createdAt: d.when,
      },
    } as never)
    for (const s of t.p.steps) {
      const failed = (d.fail as number[]).includes(s.position)
      const item = await prisma.inspectionItem.create({
        data: {
          inspectionId: insp.id,
          position: s.position,
          title: s.title,
          instruction: s.instruction,
          inputType: s.inputType,
          unit: s.unit,
          minValue: s.minValue,
          maxValue: s.maxValue,
          required: s.required,
          requirePhoto: s.requirePhoto,
          result: failed ? 'FAIL' : 'PASS',
          numericValue: s.inputType === 'NUMBER' ? (s.unit === 'V' ? 410 : 3.5) : null,
          textValue: s.inputType === 'TEXT' ? 'Valid till 03/2028' : null,
          note: failed ? d.failNote : null,
          completedAt: addMin(d.when, s.position * 3),
          correctiveWorkOrderId: failed ? d.corrective : null,
        },
      } as never)
      if (failed || s.requirePhoto)
        await attachPhoto({
          ownerType: 'INSPECTION_ITEM',
          ownerId: item.id,
          organizationId: O,
          topic: failed ? (d.r.id === R5.id ? 'kitchen' : 'electrical') : 'cleaning',
          caption: s.title,
          uploadedById: d.by.id,
          when: addMin(d.when, s.position * 3),
          fileName: 'IMG_inspection.jpg',
        })
    }
  }

  // ---- Purchase orders
  async function purchaseOrder(d: {
    r: typeof R1
    v: { id: string }
    status: string
    by: { id: string }
    approver?: { id: string }
    items: { part: typeof P_CAP; qty: number }[]
    created: Date
    notes: string
    received?: boolean
  }) {
    const subtotal = d.items.reduce((s, i) => s + i.qty * Number(i.part.unitCost), 0)
    const tax = Math.round(subtotal * 0.18)
    const steps = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'RECEIVED']
    const reached = (s: string) => steps.indexOf(d.status) >= steps.indexOf(s)
    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: O,
        code: await nextCode(tx, O, 'PO', 6),
        vendorId: d.v.id,
        restaurantId: d.r.id,
        status: d.status as never,
        requestedById: d.by.id,
        approvedById: reached('APPROVED') ? (d.approver ?? superAdmin).id : null,
        submittedAt: reached('PENDING_APPROVAL') ? addMin(d.created, 30) : null,
        approvedAt: reached('APPROVED') ? addMin(d.created, 180) : null,
        orderedAt: reached('ORDERED') ? addMin(d.created, 240) : null,
        expectedAt: addMin(d.created, 3 * 24 * 60),
        receivedAt: reached('RECEIVED') ? addMin(d.created, 2 * 24 * 60) : null,
        subtotal,
        tax,
        total: subtotal + tax,
        notes: d.notes,
        createdAt: d.created,
        items: {
          create: d.items.map((i) => ({
            partId: i.part.id,
            description: i.part.name,
            qtyOrdered: i.qty,
            qtyReceived: d.received ? i.qty : 0,
            unitCost: i.part.unitCost,
          })),
        },
      },
      include: { items: true },
    } as never)
    if (d.received) {
      const receipt = await prisma.poReceipt.create({
        data: {
          purchaseOrderId: po.id,
          receivedById: d.by.id,
          receivedAt: addMin(d.created, 2 * 24 * 60),
          notes: 'Received in good condition.',
        },
      })
      for (const it of (
        po as unknown as { items: { id: string; partId: string; qtyOrdered: unknown }[] }
      ).items) {
        await prisma.poReceiptLine.create({
          data: {
            receiptId: receipt.id,
            purchaseOrderItemId: it.id,
            quantity: Number(it.qtyOrdered),
          },
        })
        const inv = await prisma.inventory.findUniqueOrThrow({
          where: { partId_restaurantId: { partId: it.partId, restaurantId: d.r.id } },
        })
        const balance = Number(inv.quantity) + Number(it.qtyOrdered)
        await prisma.inventory.update({ where: { id: inv.id }, data: { quantity: balance } })
        await prisma.inventoryTransaction.create({
          data: {
            organizationId: O,
            partId: it.partId,
            restaurantId: d.r.id,
            type: 'RECEIPT',
            quantityDelta: Number(it.qtyOrdered),
            balanceAfter: balance,
            referenceType: 'PURCHASE_ORDER',
            referenceId: po.id,
            actorId: d.by.id,
            reason: `Received on ${po.code}`,
            createdAt: addMin(d.created, 2 * 24 * 60),
          },
        } as never)
      }
    }
    return po
  }
  const PO1 = await purchaseOrder({
    r: R1,
    v: V_COOL,
    status: 'RECEIVED',
    by: A1,
    items: [
      { part: P_R404, qty: 3 },
      { part: P_CAP, qty: 2 },
    ],
    created: at(-5, 15),
    notes: 'Restock after cooler breakdown (WO1).',
    received: true,
  })
  const PO2 = await purchaseOrder({
    r: R3,
    v: V_GAS,
    status: 'ORDERED',
    by: A3,
    items: [{ part: P_NOZ, qty: 8 }],
    created: at(-2, 12),
    notes: `Nozzles for gas range repair – ${WO5.code}.`,
  })
  await purchaseOrder({
    r: R2,
    v: V_ELEC,
    status: 'APPROVED',
    by: A2,
    items: [{ part: P_MCB, qty: 4 }],
    created: at(-1, 11),
    notes: `MCBs for panel repair – ${WO4.code} and spare.`,
  })
  await purchaseOrder({
    r: R4,
    v: V_AC,
    status: 'PENDING_APPROVAL',
    by: A4,
    items: [{ part: P_FLT, qty: 4 }],
    created: at(0, 10),
    notes: 'AC filters below minimum stock.',
  })
  await purchaseOrder({
    r: R5,
    v: V_AC,
    status: 'DRAFT',
    by: A5,
    items: [
      { part: P_FLT, qty: 6 },
      { part: P_CAP, qty: 2 },
    ],
    created: at(0, 12),
    notes: 'Monthly spares for Vesu outlet.',
  })

  // ---- Documents (real PDF files)
  async function document(d: {
    r: string | null
    ownerType: 'RESTAURANT' | 'ASSET' | 'VENDOR' | 'WORK_ORDER'
    ownerId: string
    type: string
    title: string
    issued: Date
    expires?: Date
    by: { id: string }
    lines: string[]
  }) {
    const body = makePdf(d.lines)
    const key = `${monthFolder('documents', d.issued)}/${randomUUID()}.pdf`
    await storage.put(key, body, { mimeType: 'application/pdf' })
    return prisma.document.create({
      data: {
        organizationId: O,
        restaurantId: d.r,
        ownerType: d.ownerType,
        ownerId: d.ownerId,
        docType: d.type as never,
        title: d.title,
        storageKey: key,
        fileName: `${d.title.replace(/[^\w]+/g, '_')}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: body.length,
        issuedAt: d.issued,
        expiresAt: d.expires ?? null,
        uploadedById: d.by.id,
      },
    } as never)
  }
  await document({
    r: R1.id,
    ownerType: 'RESTAURANT',
    ownerId: R1.id,
    type: 'LICENSE',
    title: 'FSSAI License – CG Road',
    issued: at(-340),
    expires: at(25),
    by: A1,
    lines: [
      'FSSAI License',
      'Licence No: 10726001000456',
      `Premises: ${R1.name}`,
      'Category: Restaurant / Food Service',
      'Valid for 1 year from date of issue',
    ],
  })
  await document({
    r: R2.id,
    ownerType: 'RESTAURANT',
    ownerId: R2.id,
    type: 'CERTIFICATE',
    title: 'Fire NOC – Sindhu Bhavan',
    issued: at(-200),
    expires: at(165),
    by: A2,
    lines: [
      'Fire No Objection Certificate',
      'AMC Fire & Emergency Services, Ahmedabad',
      `Premises: ${R2.name}`,
      'NOC No: AFES/2026/NOC/3381',
    ],
  })
  await document({
    r: null,
    ownerType: 'VENDOR',
    ownerId: V_COOL.id,
    type: 'AMC',
    title: 'CoolTech AMC Agreement 2026',
    issued: at(-200),
    expires: at(165),
    by: superAdmin,
    lines: [
      'Annual Maintenance Contract',
      'CoolTech Refrigeration Services',
      'Contract No: CT/AMC/2026/014',
      'Scope: walk-in coolers at all 5 Bookends outlets',
      'Value: Rs 1,80,000 + GST',
    ],
  })
  await document({
    r: R1.id,
    ownerType: 'ASSET',
    ownerId: asset[R1.id]!.cooler!,
    type: 'WARRANTY',
    title: 'Walk-in Cooler Warranty Card',
    issued: at(-700),
    expires: at(30),
    by: A1,
    lines: [
      'Warranty Certificate',
      'Blue Star WIC-2000 Walk-in Cooler',
      'Serial: WIC2000-2400',
      'Warranty: 24 months compressor, 12 months parts',
    ],
  })
  const INV_DOC = await document({
    r: R1.id,
    ownerType: 'WORK_ORDER',
    ownerId: WO1.id,
    type: 'INVOICE',
    title: `CoolTech Invoice – ${WO1.code}`,
    issued: at(-5),
    by: A1,
    lines: [
      'Tax Invoice',
      'CoolTech Refrigeration Services',
      'Invoice No: CT/INV/26-27/0412',
      `Against: ${WO1.code} Walk-in cooler breakdown`,
      'Emergency visit Rs 1,500 + GST 18% = Rs 1,770',
    ],
  })

  // ---- Vendor invoices
  const invoices = [
    {
      v: V_COOL,
      r: R1.id,
      wo: WO1.id,
      po: null,
      no: 'CT/INV/26-27/0412',
      amt: 1770,
      paid: true,
      doc: INV_DOC.id,
    },
    {
      v: V_COOL,
      r: R1.id,
      wo: null,
      po: PO1.id,
      no: 'CT/INV/26-27/0419',
      amt: Number(PO1.total),
      paid: false,
      doc: null,
    },
    {
      v: V_GAS,
      r: R3.id,
      wo: null,
      po: PO2.id,
      no: 'GGS/2026/1187',
      amt: Number(PO2.total),
      paid: false,
      doc: null,
    },
    {
      v: V_PLUMB,
      r: R4.id,
      wo: null,
      po: null,
      no: 'AQF/INV/552',
      amt: 9000,
      paid: true,
      doc: null,
    },
    {
      v: V_AC,
      r: R5.id,
      wo: null,
      po: null,
      no: 'BS/SRT/2026/3310',
      amt: 13000,
      paid: false,
      doc: null,
    },
  ]
  for (const i of invoices)
    await prisma.vendorInvoice.create({
      data: {
        organizationId: O,
        vendorId: i.v.id,
        restaurantId: i.r,
        workOrderId: i.wo,
        purchaseOrderId: i.po,
        invoiceNumber: i.no,
        amount: i.amt,
        invoiceDate: at(-4),
        dueDate: at(11),
        paidAt: i.paid ? at(-1) : null,
        documentId: i.doc,
        notes: i.paid ? 'Paid via NEFT.' : 'Due in 15 days.',
      },
    } as never)

  // ---- Stock count (completed, R1)
  const sc = await prisma.stockCount.create({
    data: {
      organizationId: O,
      code: await nextCode(tx, O, 'SC', 6),
      restaurantId: R1.id,
      name: 'Monthly spares count – CG Road',
      status: 'COMPLETED',
      createdById: A1.id,
      completedById: SUP.id,
      completedAt: at(-1, 18),
      notes: 'All spares counted, one capacitor short.',
    },
  } as never)
  for (const p of parts) {
    const inv = await prisma.inventory.findUniqueOrThrow({
      where: { partId_restaurantId: { partId: p.id, restaurantId: R1.id } },
    })
    const sys = Number(inv.quantity)
    const counted = p.id === P_CAP.id ? sys - 1 : sys
    await prisma.stockCountLine.create({
      data: {
        stockCountId: sc.id,
        partId: p.id,
        systemQty: sys,
        countedQty: counted,
        variance: counted - sys,
        unitCost: p.unitCost,
        countedById: SUP.id,
        countedAt: at(-1, 17),
      },
    })
  }

  // ---- Notifications
  const N = (
    recipientId: string,
    type: string,
    title: string,
    body: string,
    url: string,
    pri = 'MEDIUM',
    read = false,
    days = 0,
  ) =>
    prisma.notification.create({
      data: {
        organizationId: O,
        recipientId,
        type: type as never,
        title,
        body,
        actionUrl: url,
        priority: pri as never,
        readAt: read ? at(days, 12) : null,
        createdAt: at(days, 10),
      },
    } as never)
  const woUrl = (w: { id: string }) => `/work-orders/${w.id}`
  await N(
    W2.id,
    'TASK_ASSIGNED',
    `${WO2.code} assigned to you`,
    'Replace cold room door gasket',
    woUrl(WO2),
    'HIGH',
    false,
    -2,
  )
  await N(
    W2.id,
    'PM_DUE',
    `${WO6.code} due tomorrow`,
    'Walk-in cooler monthly service – Prahlad Nagar',
    woUrl(WO6),
  )
  await N(
    W1.id,
    'TASK_OVERDUE',
    `${WO4.code} is overdue`,
    'Main panel MCB tripping during lunch rush',
    woUrl(WO4),
    'HIGH',
  )
  await N(
    W3.id,
    'TASK_ASSIGNED',
    `${WO7.code}: you were added as helper`,
    'Dishwasher not draining after cycle',
    woUrl(WO7),
    'HIGH',
    false,
    -1,
  )
  await N(
    W4.id,
    'TASK_ASSIGNED',
    `${WO10.code} assigned to you`,
    'Exhaust hood filters cleaning',
    woUrl(WO10),
  )
  await N(
    W5.id,
    'TASK_ASSIGNED',
    `${WO7.code} assigned to you`,
    'Dishwasher not draining after cycle',
    woUrl(WO7),
    'HIGH',
    true,
    -1,
  )
  await N(
    A1.id,
    'TASK_COMPLETED',
    `${WO1.code} completed`,
    'Walk-in cooler repaired by Suresh Yadav',
    woUrl(WO1),
    'MEDIUM',
    true,
    -6,
  )
  await N(
    A2.id,
    'TASK_COMPLETED',
    `${WO3.code} completed – please review`,
    'Leak under hand wash sink fixed by Mahesh Solanki',
    woUrl(WO3),
    'MEDIUM',
    false,
    -2,
  )
  await N(
    A3.id,
    'LOW_STOCK',
    'Low stock: Gas burner brass nozzle',
    'Only 1 left at Prahlad Nagar (minimum 6).',
    `/inventory/parts/${P_NOZ.id}`,
    'HIGH',
  )
  await N(
    A4.id,
    'CRITICAL_ISSUE',
    'Critical request: gas smell near range',
    'Reported by Chef Rakesh Nair',
    `/requests?highlight=${REQ4.id}`,
    'CRITICAL',
  )
  await N(
    A5.id,
    'CRITICAL_ISSUE',
    `${WO9.code}: Dining AC not cooling`,
    'Critical work order is unassigned',
    woUrl(WO9),
    'CRITICAL',
  )
  await N(
    superAdmin.id,
    'PO_APPROVAL',
    'Purchase order waiting for approval',
    'AC filters for Alkapuri',
    '/purchase-orders',
    'MEDIUM',
  )
  await N(
    superAdmin.id,
    'CRITICAL_ISSUE',
    'Critical request at Alkapuri',
    'Slight gas smell near the gas range',
    `/requests?highlight=${REQ4.id}`,
    'CRITICAL',
  )
  await N(
    superAdmin.id,
    'DOCUMENT_EXPIRY',
    'FSSAI License expires in 25 days',
    'Bookends Café – CG Road',
    '/documents',
    'HIGH',
  )
  await N(
    STAFF.id,
    'REQUEST_APPROVED',
    'Your request was approved',
    'Cold room door not sealing properly',
    `/requests?highlight=${REQ1.id}`,
    'MEDIUM',
    true,
    -2,
  )
  await N(
    SUP.id,
    'NEW_REQUEST',
    'New request at Prahlad Nagar',
    'Dining AC making loud rattling noise',
    `/requests?highlight=${REQ3.id}`,
  )

  // ---- Team chat
  const everyone = [superAdmin, ...managers, W1, W2, W3, W4, W5, SUP]
  const group = await prisma.conversation.create({
    data: {
      organizationId: O,
      type: 'GROUP',
      name: 'Bookends Maintenance Team',
      createdById: superAdmin.id,
      lastMessageAt: at(0, 9, 30),
    },
  } as never)
  for (const u of everyone)
    await prisma.conversationMember.create({
      data: { conversationId: group.id, userId: u.id, lastReadAt: at(-1, 20) },
    } as never)
  const groupMsgs: [{ id: string }, string, Date, string?][] = [
    [
      superAdmin,
      'Good morning team. Please update your work orders with photos before closing them.',
      at(-1, 9),
    ],
    [A3, 'Gas nozzles PO is placed, should arrive Thursday.', at(-1, 12), WO5.id],
    [W2, 'CG Road cooler holding at 3°C since the repair 👍', at(-1, 18), WO1.id],
    [A5, 'Vesu dining AC down, need someone from AC team today.', at(0, 13, 20), WO9.id],
    [W4, 'I can reach Vesu by 4 pm after Prahlad Nagar.', at(0, 13, 35), WO9.id],
  ]
  for (const [by, body, when, woId] of groupMsgs)
    await prisma.chatMessage.create({
      data: {
        conversationId: group.id,
        authorId: by.id,
        body,
        workOrderId: woId ?? null,
        createdAt: when,
      },
    } as never)
  const direct = await prisma.conversation.create({
    data: {
      organizationId: O,
      type: 'DIRECT',
      directKey: [A1.id, W2.id].sort().join(':'),
      createdById: A1.id,
      lastMessageAt: at(0, 9, 30),
    },
  } as never)
  for (const u of [A1, W2])
    await prisma.conversationMember.create({
      data: { conversationId: direct.id, userId: u.id, lastReadAt: at(0, 9) },
    } as never)
  for (const [by, body, when] of [
    [A1, 'Suresh, gasket fitting today possible?', at(0, 9, 10)],
    [W2, 'Yes madam, gasket is coming at 4 pm. Will fit before dinner service.', at(0, 9, 30)],
  ] as const)
    await prisma.chatMessage.create({
      data: { conversationId: direct.id, authorId: by.id, body, createdAt: when },
    } as never)

  // ---- Summary
  console.log('\nDemo data created.\n')
  console.log(`  Restaurants: ${restaurants.map((r) => r.code).join(', ')}`)
  console.log(
    `  Work orders: ${[WO1, WO2, WO3, WO4, WO5, WO6, WO7, WO8, WO9, WO10].map((w) => w.code).join(', ')}`,
  )
  console.log(`  Logins (password ${PASSWORD} unless noted):`)
  for (const u of [...managers, W1, W2, W3, W4, W5, SUP, STAFF]) console.log(`    ${u.username}`)
}

main()
  .catch((err) => {
    console.error('Demo data failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
