#!/usr/bin/env node
/**
 * Bundle budget. Run after `vite build`:
 *   node scripts/check-bundle.mjs
 *
 * Fails when the JavaScript a phone downloads before the first screen
 * (entry + preloaded chunks, gzipped) or any single lazy chunk grows past
 * its budget. Raise a budget deliberately, never by accident.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const BUDGET_INITIAL_KB = 230
const BUDGET_CHUNK_KB = 80
/** Chunks allowed to be larger (lazy-loaded, rarely used). */
const ALLOWED_LARGE = [/^WorkerScanPage-/]

const dir = new URL('../dist/', import.meta.url)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const initial = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
const gz = (file) => gzipSync(readFileSync(new URL(`assets/${file}`, dir))).length / 1024

let failed = false
const initialKb = initial.reduce((sum, f) => sum + gz(f), 0)
console.log(`Initial JS (gzip): ${initialKb.toFixed(1)} KB / budget ${BUDGET_INITIAL_KB} KB`)
for (const f of initial) console.log(`  ${f.padEnd(40)} ${gz(f).toFixed(1)} KB`)
if (initialKb > BUDGET_INITIAL_KB) {
  console.error(`✖ Initial JS is over budget by ${(initialKb - BUDGET_INITIAL_KB).toFixed(1)} KB`)
  failed = true
}

const lazy = readdirSync(new URL('assets/', dir)).filter(
  (f) => f.endsWith('.js') && !initial.includes(f),
)
for (const f of lazy) {
  const kb = gz(f)
  if (kb > BUDGET_CHUNK_KB && !ALLOWED_LARGE.some((re) => re.test(f))) {
    console.error(`✖ ${f} is ${kb.toFixed(1)} KB gzip (budget ${BUDGET_CHUNK_KB} KB)`)
    failed = true
  }
}
console.log(`Lazy chunks: ${lazy.length}, largest ${Math.max(...lazy.map(gz)).toFixed(1)} KB`)
if (failed) process.exit(1)
console.log('✔ Bundle within budget')
