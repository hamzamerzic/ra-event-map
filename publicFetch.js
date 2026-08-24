function tokenClaims(token) {
  try {
    const payload = String(token || '').split('.')[1]
    if (!payload) return null
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

export function publicFetchUrl(token, remoteUrl) {
  const claims = tokenClaims(token)
  if (claims?.scope === 'public_app' && Number.isInteger(claims.app_id)) {
    return `/api/public-apps/${claims.app_id}/fetch?url=${encodeURIComponent(remoteUrl)}`
  }
  return `/api/proxy?url=${encodeURIComponent(remoteUrl)}`
}

export function fetchExternal(token, remoteUrl, options = {}) {
  return fetch(publicFetchUrl(token, remoteUrl), {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}
