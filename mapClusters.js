export function clusterEvents(events) {
  const clusters = new Map()
  events.forEach((event, eventIndex) => {
    if (!Number.isFinite(event.venue.lat) || !Number.isFinite(event.venue.lon)) return
    const key = `${event.venue.lat.toFixed(4)},${event.venue.lon.toFixed(4)}`
    const cluster = clusters.get(key) || {
      key,
      lat: event.venue.lat,
      lon: event.venue.lon,
      venue: event.venue.name,
      events: [],
      listNumbers: [],
    }
    cluster.events.push(event)
    cluster.listNumbers.push(eventIndex + 1)
    clusters.set(key, cluster)
  })
  return [...clusters.values()]
}
