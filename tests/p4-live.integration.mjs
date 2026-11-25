import assert from 'node:assert/strict'
import test from 'node:test'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'

// Needs an isolated Worker started with `pnpm dev --port 4198` where the p4-live routes are mounted at /api/v1/live,
// the COLLABORATION Durable Object is bound, and LIVE_SERVER_SECRET_KEY is set (pass the same value in the environment).
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
const secret = process.env.LIVE_SERVER_SECRET_KEY
const live = '/api/v1/live'

const post = (path, body, headers = {}) =>
  fetch(new URL(`${live}${path}`, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })

test('health probe answers without a session', async () => {
  const response = await fetch(new URL(`${live}/health`, base))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.status, 'OK')
  assert.equal(typeof body.timestamp, 'string')
})

test('server-to-server endpoints reject a missing or wrong secret', async () => {
  assert.equal((await post('/convert-document', { description_html: '<p>x</p>', variant: 'rich' })).status, 401)
  assert.equal(
    (await post('/convert-document', { description_html: '<p>x</p>', variant: 'rich' }, { 'live-server-secret-key': 'wrong' })).status,
    401
  )
  assert.equal((await post('/force-close', { page_id: 1 })).status, 401)
})

test('convert-document validates the body and returns json and binary', { skip: !secret }, async () => {
  const headers = { 'live-server-secret-key': secret }
  const invalid = await post('/convert-document', { description_html: 'plain', variant: 'rich' }, headers)
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).message, 'Validation error')
  const ok = await post('/convert-document', { description_html: '<p>Hello <strong>world</strong></p>', variant: 'document' }, headers)
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.equal(typeof body.description_binary, 'string')
  assert.equal(body.description_json.type, 'doc')
})

test('a socket without a session is refused the Hocuspocus way', async () => {
  const url = new URL(`${live}/collaboration?workspaceSlug=none&documentType=project_page&pageId=1`, base)
  url.protocol = 'ws:'
  const socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  const frame = encoding.createEncoder()
  encoding.writeVarString(frame, '1')
  encoding.writeVarUint(frame, 2) // Auth
  encoding.writeVarUint(frame, 0) // Token
  encoding.writeVarString(frame, JSON.stringify({ id: '1' }))
  // The server sends a PermissionDenied frame and then closes with 4401. Dev can drop the frame right before the
  // close, so accept either the frame or the 4401 close; the upgrade itself (open) must have happened.
  const outcome = await new Promise((resolve, reject) => {
    let opened = false
    socket.addEventListener('open', () => {
      opened = true
      socket.send(encoding.toUint8Array(frame))
    })
    socket.addEventListener('message', event => resolve({ type: 'frame', data: new Uint8Array(event.data) }))
    socket.addEventListener('close', event => resolve({ type: 'close', code: event.code, opened }))
    socket.addEventListener('error', () => setTimeout(() => reject(new Error('socket error')), 1000))
    setTimeout(() => reject(new Error('timeout')), 10_000)
  })
  if (outcome.type === 'frame') {
    const decoder = decoding.createDecoder(outcome.data)
    assert.equal(decoding.readVarString(decoder), '1')
    assert.equal(decoding.readVarUint(decoder), 2) // Auth
    assert.equal(decoding.readVarUint(decoder), 1) // PermissionDenied
    assert.equal(decoding.readVarString(decoder), 'AUTH_MISSING_CREDENTIALS')
  } else {
    assert.equal(outcome.opened, true, 'the upgrade must succeed before the server refuses the session')
    assert.equal(outcome.code, 4401)
  }
  socket.close()
})
