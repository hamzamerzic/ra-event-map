const RA_GRAPHQL = 'https://ra.co/graphql'

const AREA_QUERY = `
  query AREA_SEARCH($term: String!) {
    areas(searchTerm: $term, limit: 8) {
      id
      name
      urlName
      ianaTimeZone
      location { latitude longitude }
      country { name urlCode }
    }
  }
`

const EVENTS_QUERY = `
  query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
    eventListings(
      filters: $filters
      pageSize: $pageSize
      page: $page
      sort: { attending: { priority: 1, order: DESCENDING } }
    ) {
      totalResults
      data {
        listingDate
        event {
          id
          title
          attending
          date
          startTime
          endTime
          contentUrl
          venue {
            id
            name
            contentUrl
            address
            location { latitude longitude }
          }
        }
      }
    }
  }
`

async function graphQL(token, query, variables, signal) {
  const remote = `${RA_GRAPHQL}?${new URLSearchParams({
    query,
    variables: JSON.stringify(variables),
  })}`
  const response = await fetch(`/api/proxy?url=${encodeURIComponent(remote)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) throw new Error(`Resident Advisor returned ${response.status}`)
  const payload = await response.json()
  if (payload.errors?.length) throw new Error(payload.errors[0].message || 'Resident Advisor could not complete the search')
  return payload.data
}

function normaliseArea(area) {
  const latitude = Number(area?.location?.latitude)
  const longitude = Number(area?.location?.longitude)
  return {
    id: String(area.id),
    name: area.name,
    urlName: area.urlName,
    timeZone: area.ianaTimeZone,
    country: area.country?.name || '',
    countryCode: String(area.country?.urlCode || '').toLowerCase(),
    center: Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { lat: latitude, lon: longitude }
      : null,
  }
}

export async function searchAreas(token, term, signal) {
  const data = await graphQL(token, AREA_QUERY, { term: term.trim() }, signal)
  return (data.areas || []).filter((area) => area?.id && area?.name).map(normaliseArea)
}

function normaliseEvent(row) {
  const event = row?.event
  if (!event?.id || !event?.title) return null
  const latitude = Number(event.venue?.location?.latitude)
  const longitude = Number(event.venue?.location?.longitude)
  const hasLocation = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && !(Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001)

  return {
    id: String(event.id),
    title: event.title,
    interested: Number(event.attending) || 0,
    listingDate: row.listingDate,
    startTime: event.startTime,
    endTime: event.endTime,
    url: `https://ra.co${event.contentUrl || `/events/${event.id}`}`,
    venue: {
      id: event.venue?.id ? String(event.venue.id) : `event-${event.id}`,
      name: event.venue?.name || 'Venue TBA',
      address: event.venue?.address || '',
      lat: hasLocation ? latitude : null,
      lon: hasLocation ? longitude : null,
    },
  }
}

async function fetchEventsPage(token, areaId, date, page, signal) {
  const filters = {
    areas: { eq: Number(areaId) },
    listingDate: { gte: date, lte: date },
    listingPosition: { eq: 1 },
  }
  const data = await graphQL(token, EVENTS_QUERY, {
    filters,
    pageSize: 100,
    page,
  }, signal)
  return data.eventListings || { totalResults: 0, data: [] }
}

function distanceFromAreaKm(event, center) {
  if (!center || !Number.isFinite(event.venue.lat) || !Number.isFinite(event.venue.lon)) return 0
  const toRadians = (value) => (value * Math.PI) / 180
  const latitudeDelta = toRadians(event.venue.lat - center.lat)
  const longitudeDelta = toRadians(event.venue.lon - center.lon)
  const start = toRadians(center.lat)
  const end = toRadians(event.venue.lat)
  const haversine = (Math.sin(latitudeDelta / 2) ** 2)
    + Math.cos(start) * Math.cos(end) * (Math.sin(longitudeDelta / 2) ** 2)
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export async function fetchAreaEvents(token, area, date, signal) {
  const first = await fetchEventsPage(token, area.id, date, 1, signal)
  const pageCount = Math.min(3, Math.ceil((first.totalResults || 0) / 100))
  const rest = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => (
      fetchEventsPage(token, area.id, date, index + 2, signal)
    )))
    : []
  const seen = new Set()
  const events = [first, ...rest]
    .flatMap((page) => page.data || [])
    .map(normaliseEvent)
    .filter((event) => event && !seen.has(event.id) && seen.add(event.id))
    .map((event) => distanceFromAreaKm(event, area.center) <= 150
      ? event
      : { ...event, venue: { ...event.venue, lat: null, lon: null } })
  return { events, total: Number(first.totalResults) || events.length }
}
