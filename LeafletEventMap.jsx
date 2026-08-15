import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin } from '@openai/apps-sdk-ui/components/Icon'
import * as L from './vendor/leaflet-src.esm.js'
import { clusterEvents } from './mapClusters.js'

const TILE_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function createProxyTileLayer(token) {
  const controllers = new Set()
  const tileCache = new Map()
  const cacheLimit = 192

  function loadTile(remote) {
    const cached = tileCache.get(remote)
    if (cached) {
      tileCache.delete(remote)
      tileCache.set(remote, cached)
      return cached
    }
    const controller = new AbortController()
    controllers.add(controller)
    const pending = fetch(`/api/proxy?url=${encodeURIComponent(remote)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) throw new Error(`Map tile ${response.status}`)
      return response.blob()
    }).then(blobToDataUrl).finally(() => controllers.delete(controller))
    pending.catch(() => {
      if (tileCache.get(remote) === pending) tileCache.delete(remote)
    })
    tileCache.set(remote, pending)
    if (tileCache.size > cacheLimit) tileCache.delete(tileCache.keys().next().value)
    return pending
  }

  const ProxyTileLayer = L.GridLayer.extend({
    createTile(coords, done) {
      const image = document.createElement('img')
      image.alt = ''
      image.setAttribute('role', 'presentation')
      const remote = TILE_TEMPLATE
        .replace('{z}', coords.z)
        .replace('{x}', coords.x)
        .replace('{y}', coords.y)
      loadTile(remote).then((url) => {
        image.onload = () => {
          done(null, image)
        }
        image.onerror = (error) => {
          done(error, image)
        }
        image.src = url
      }).catch((error) => {
        if (error?.name !== 'AbortError') done(error, image)
      })
      return image
    },
  })
  const layer = new ProxyTileLayer({
    minZoom: 4,
    maxZoom: 19,
    keepBuffer: 4,
    updateWhenZooming: false,
    updateWhenIdle: true,
  })
  layer.abortPending = () => {
    controllers.forEach((controller) => controller.abort())
    controllers.clear()
    tileCache.clear()
  }
  return layer
}

function distanceKm(point, center) {
  if (!center) return 0
  const radians = (value) => (value * Math.PI) / 180
  const lat = radians(point.lat - center.lat)
  const lon = radians(point.lon - center.lon)
  const start = radians(center.lat)
  const end = radians(point.lat)
  const haversine = (Math.sin(lat / 2) ** 2)
    + Math.cos(start) * Math.cos(end) * (Math.sin(lon / 2) ** 2)
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function markerIcon(label, additionalEvents, selected) {
  return L.divIcon({
    className: 'ra-pin-shell',
    html: `<span class="ra-pin${selected ? ' is-selected' : ''}"><span>${label}</span>${additionalEvents ? `<span class="ra-pin-more">+${additionalEvents}</span>` : ''}</span>`,
    iconSize: [42, 42],
    iconAnchor: [18, 18],
  })
}

function clusterDescription(cluster) {
  const entries = cluster.listNumbers.join(', ')
  return cluster.events.length === 1
    ? `Event ${entries} at ${cluster.venue}`
    : `Events ${entries} at ${cluster.venue}`
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function frameClusters(map, clusters, area, animate) {
  if (!map) return
  if (!clusters.length) {
    if (area?.center) map.setView([area.center.lat, area.center.lon], 11, { animate: false })
    return
  }
  if (clusters.length === 1) {
    const cluster = clusters[0]
    if (animate && !reducedMotion()) map.flyTo([cluster.lat, cluster.lon], 14, { duration: 0.55 })
    else map.setView([cluster.lat, cluster.lon], 14, { animate: false })
    return
  }
  const bounds = L.latLngBounds(clusters.map((cluster) => [cluster.lat, cluster.lon]))
  if (animate && !reducedMotion()) {
    map.flyToBounds(bounds, { padding: [54, 54], maxZoom: 13, duration: 0.55 })
  } else {
    map.fitBounds(bounds, { padding: [54, 54], maxZoom: 13, animate: false })
  }
}

export function LeafletEventMap({ area, events, selectedId, onSelectFromMap, token }) {
  const nodeRef = useRef(null)
  const mapRef = useRef(null)
  const markerLayerRef = useRef(null)
  const markerEntriesRef = useRef(new Map())
  const selectedClusterKeyRef = useRef(null)
  const resizeRef = useRef(null)
  const onSelectRef = useRef(onSelectFromMap)
  const selectedIdRef = useRef(selectedId)
  const [mapReady, setMapReady] = useState(false)
  const [showNearby, setShowNearby] = useState(false)
  const clusters = useMemo(() => clusterEvents(events), [events])
  const cityClusters = useMemo(() => (
    area?.center ? clusters.filter((cluster) => distanceKm(cluster, area.center) <= 45) : clusters
  ), [area?.center, clusters])
  const visibleClusters = showNearby ? clusters : cityClusters

  onSelectRef.current = onSelectFromMap
  selectedIdRef.current = selectedId

  useEffect(() => setShowNearby(false), [area?.id])

  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return undefined
    const fallback = area?.center || { lat: 51.5, lon: -0.1167 }
    const map = L.map(nodeRef.current, {
      minZoom: 4,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      touchZoom: true,
      doubleClickZoom: true,
      keyboard: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelDebounceTime: 80,
      wheelPxPerZoomLevel: 120,
      bounceAtZoomLimits: false,
      zoomAnimation: !reducedMotion(),
      fadeAnimation: !reducedMotion(),
      markerZoomAnimation: !reducedMotion(),
    }).setView([fallback.lat, fallback.lon], 11)
    const tileLayer = createProxyTileLayer(token)
    tileLayer.addTo(map)
    const markerLayer = L.layerGroup().addTo(map)
    mapRef.current = map
    markerLayerRef.current = markerLayer
    resizeRef.current = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    resizeRef.current.observe(nodeRef.current)
    setMapReady(true)
    return () => {
      resizeRef.current?.disconnect()
      resizeRef.current = null
      tileLayer.abortPending?.()
      map.remove()
      mapRef.current = null
      markerLayerRef.current = null
      markerEntriesRef.current.clear()
      selectedClusterKeyRef.current = null
    }
  }, [token])

  useEffect(() => {
    const map = mapRef.current
    const layer = markerLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    markerEntriesRef.current.clear()
    selectedClusterKeyRef.current = null
    visibleClusters.forEach((cluster) => {
      const selected = cluster.events.some((event) => event.id === selectedIdRef.current)
      const label = cluster.listNumbers[0]
      const additionalEvents = cluster.events.length - 1
      const description = clusterDescription(cluster)
      const marker = L.marker([cluster.lat, cluster.lon], {
        icon: markerIcon(label, additionalEvents, selected),
        keyboard: true,
        title: description,
        alt: description,
      })
      marker.on('click', () => onSelectRef.current(cluster.events[0].id))
      marker.addTo(layer)
      marker.getElement()?.setAttribute('aria-label', description)
      markerEntriesRef.current.set(cluster.key, { marker, cluster })
      if (selected) selectedClusterKeyRef.current = cluster.key
    })
  }, [visibleClusters])

  useEffect(() => {
    const nextKey = visibleClusters.find((cluster) => (
      cluster.events.some((event) => event.id === selectedId)
    ))?.key || null
    const previousKey = selectedClusterKeyRef.current
    if (previousKey && previousKey !== nextKey) {
      const previous = markerEntriesRef.current.get(previousKey)
      if (previous) previous.marker.setIcon(markerIcon(
        previous.cluster.listNumbers[0],
        previous.cluster.events.length - 1,
        false,
      ))
    }
    if (nextKey && nextKey !== previousKey) {
      const next = markerEntriesRef.current.get(nextKey)
      if (next) next.marker.setIcon(markerIcon(
        next.cluster.listNumbers[0],
        next.cluster.events.length - 1,
        true,
      ))
    }
    selectedClusterKeyRef.current = nextKey
  }, [selectedId, visibleClusters])

  useEffect(() => {
    if (!mapReady) return
    frameClusters(mapRef.current, visibleClusters, area, showNearby)
  }, [area?.id, mapReady, showNearby, visibleClusters])

  useEffect(() => {
    if (!selectedId || !mapReady) return
    const selected = events.find((event) => event.id === selectedId)
    if (!Number.isFinite(selected?.venue.lat) || !Number.isFinite(selected?.venue.lon)) return
    if (!showNearby && distanceKm({ lat: selected.venue.lat, lon: selected.venue.lon }, area?.center) > 45) {
      setShowNearby(true)
      return
    }
    const map = mapRef.current
    const target = [selected.venue.lat, selected.venue.lon]
    const zoom = Math.max(map.getZoom(), 14)
    if (reducedMotion()) map.setView(target, zoom, { animate: false })
    else map.flyTo(target, zoom, { duration: 0.55 })
  }, [area?.center, events, mapReady, selectedId, showNearby])

  return (
    <section className="ra-map" aria-label={`Interactive event map for ${area?.name || 'selected city'}`}>
      <div ref={nodeRef} className="ra-leaflet" role="region" aria-label="Drag to pan. Pinch on a touch screen or use a mouse wheel to zoom." />
      {!mapReady && (
        <div className="ra-map-state" role="status">
          <MapPin width={18} height={18} />
          <span>Preparing interactive map…</span>
        </div>
      )}
      <div className="ra-map-wash" />
      <div className="ra-map-meta">
        <span><MapPin width={15} height={15} /> {visibleClusters.length} {showNearby ? 'listed' : 'city'} venues</span>
        {cityClusters.length < clusters.length && (
          <button type="button" onClick={() => setShowNearby((current) => !current)}>
            {showNearby ? 'City view' : `Show ${clusters.length - cityClusters.length} nearby`}
          </button>
        )}
      </div>
      <a className="ra-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap
      </a>
    </section>
  )
}
