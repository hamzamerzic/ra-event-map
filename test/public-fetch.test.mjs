import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchExternal, publicFetchUrl } from '../publicFetch.js'

function unsignedToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${body}.signature`
}

test('public app tokens use their exact app-scoped fetch route', () => {
  const token = unsignedToken({ scope: 'public_app', app_id: 113 })
  assert.equal(
    publicFetchUrl(token, 'https://ra.co/graphql?operationName=eventListings'),
    '/api/public-apps/113/fetch?url=https%3A%2F%2Fra.co%2Fgraphql%3FoperationName%3DeventListings',
  )
})

test('ordinary and malformed tokens keep the owner proxy route', () => {
  const remote = 'https://tile.openstreetmap.org/8/128/84.png'
  assert.equal(publicFetchUrl('not-a-token', remote), `/api/proxy?url=${encodeURIComponent(remote)}`)
  assert.equal(
    publicFetchUrl(unsignedToken({ scope: 'app', app_id: 113 }), remote),
    `/api/proxy?url=${encodeURIComponent(remote)}`,
  )
})

test('fetchExternal preserves request options and adds the bearer token', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    return { ok: true }
  }
  try {
    const token = unsignedToken({ scope: 'public_app', app_id: 113 })
    await fetchExternal(token, 'https://ra.co/graphql', {
      headers: { Accept: 'application/json' },
      signal: 'signal',
    })
    assert.deepEqual(calls, [[
      '/api/public-apps/113/fetch?url=https%3A%2F%2Fra.co%2Fgraphql',
      {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: 'signal',
      },
    ]])
  } finally {
    globalThis.fetch = originalFetch
  }
})
