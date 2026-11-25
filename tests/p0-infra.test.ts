import assert from 'node:assert/strict'
import test from 'node:test'
import { cronMatches, dispatchJob, enqueueJob, registerJobHandler, registerScheduled, UnknownJobError } from '../src/server/common/jobs'
import { renderEmail } from '../src/server/common/mail-templates'

const env = { DB: {} as D1Database }

test('cron expressions match on UTC boundaries', () => {
  assert.ok(cronMatches('*/5 * * * *', new Date('2026-01-01T10:05:00Z')))
  assert.ok(!cronMatches('*/5 * * * *', new Date('2026-01-01T10:06:00Z')))
  assert.ok(cronMatches('30 1 * * *', new Date('2026-01-01T01:30:00Z')))
  assert.throws(() => registerScheduled('61 * * * *', () => undefined))
})

test('enqueueJob runs inline without a queue binding and unknown types fail', async () => {
  const seen: unknown[] = []
  registerJobHandler('p0.test', payload => void seen.push(payload))
  await dispatchJob(env, { type: 'p0.test', payload: 1 })
  assert.deepEqual(seen, [1])
  await assert.rejects(dispatchJob(env, { type: 'missing' }), UnknownJobError)
  const sent: unknown[] = []
  await enqueueJob({ ...env, JOBS_QUEUE: { send: async (body: unknown) => void sent.push(body) } as unknown as Queue }, { type: 'p0.test', payload: 2, delaySeconds: 5 })
  // enqueueJob assigns a stable id so handlers can deduplicate at-least-once deliveries.
  assert.equal(typeof (sent[0] as { id?: unknown }).id, 'string')
  assert.deepEqual(sent, [{ type: 'p0.test', payload: 2, id: (sent[0] as { id: string }).id }])
})

test('email template escapes HTML', () => {
  const mail = renderEmail({ subject: 's', heading: '<b>', paragraphs: ['a & b'], action: { label: 'Go', url: 'https://x.test/?a=1&b=2' } })
  assert.ok(mail.html.includes('&lt;b&gt;') && mail.html.includes('a &amp; b'))
  assert.ok(mail.text.includes('https://x.test/?a=1&b=2'))
})
