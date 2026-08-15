import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Calendar,
  MapPin,
  Search,
} from '@openai/apps-sdk-ui/components/Icon'
import { fetchAreaEvents, searchAreas } from './data.js'
import { LeafletEventMap } from './LeafletEventMap.jsx'
import { LEAFLET_CSS } from './leafletCss.js'

const DEFAULT_AREA = {
  id: '13',
  name: 'London',
  country: 'United Kingdom',
  countryCode: 'uk',
  urlName: 'london',
  timeZone: 'Europe/London',
  center: { lat: 51.5, lon: -0.1167 },
}

function localDate() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function eventTime(event) {
  const start = event.startTime?.slice(11, 16)
  const end = event.endTime?.slice(11, 16)
  if (start && end) return `${start}–${end}`
  return start || 'Time TBA'
}

function prettyDate(value) {
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date)
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function EventList({ events, total, selectedId, scrollRequest, onSelect, loading, error, area, date }) {
  const refs = useRef(new Map())
  const resultsRef = useRef(null)
  const headerRef = useRef(null)

  useEffect(() => {
    const result = resultsRef.current
    const card = refs.current.get(scrollRequest?.id)
    if (!result || !card) return
    const resultRect = result.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const headerHeight = headerRef.current?.offsetHeight || 0
    const top = result.scrollTop + cardRect.top - resultRect.top - headerHeight - 8
    result.scrollTo({
      top: Math.max(0, top),
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [scrollRequest])

  if (loading) {
    return (
      <section ref={resultsRef} className="ra-results" aria-live="polite" aria-busy="true">
        <div className="ra-results-head"><span className="ra-eyebrow">Checking the night</span><strong>Loading live listings…</strong></div>
        {[1, 2, 3, 4].map((item) => <div className="ra-skeleton" key={item}><i /><span /><span /></div>)}
      </section>
    )
  }

  if (error) {
    return (
      <section ref={resultsRef} className="ra-results ra-message" aria-live="polite">
        <span className="ra-eyebrow">Couldn’t load listings</span>
        <h2>The map is ready for another try.</h2>
        <p>{error}</p>
      </section>
    )
  }

  if (!events.length) {
    return (
      <section ref={resultsRef} className="ra-results ra-message" aria-live="polite">
        <span className="ra-eyebrow">Nothing listed</span>
        <h2>No RA events found for this date.</h2>
        <p>Try the day before or after—weekends usually have the widest selection.</p>
      </section>
    )
  }

  const mapped = events.filter((event) => Number.isFinite(event.venue.lat)).length
  return (
    <section ref={resultsRef} className="ra-results" aria-live="polite">
      <header ref={headerRef} className="ra-results-head">
        <span className="ra-eyebrow">{prettyDate(date)}</span>
        <strong>{total} event{total === 1 ? '' : 's'} in {area.name}</strong>
        <small>{mapped} with venue locations · ranked by interest</small>
      </header>
      <div className="ra-event-list">
        {events.map((event, index) => {
          const selected = event.id === selectedId
          const mappedEvent = Number.isFinite(event.venue.lat)
          return (
            <article
              className={`ra-event${selected ? ' is-selected' : ''}`}
              key={event.id}
              ref={(node) => node ? refs.current.set(event.id, node) : refs.current.delete(event.id)}
            >
              <button type="button" className="ra-event-main" onClick={() => onSelect(event.id)}>
                <span className="ra-event-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="ra-event-copy">
                  <span className="ra-event-time">{eventTime(event)}</span>
                  <strong>{event.title}</strong>
                  <span className="ra-venue">{event.venue.name}{event.venue.address ? ` · ${event.venue.address}` : ''}</span>
                </span>
              </button>
              <footer>
                <span>{event.interested ? `${compactNumber(event.interested)} interested` : 'New listing'}</span>
                {!mappedEvent && <span className="ra-unmapped">Venue not mapped</span>}
                <a href={event.url} target="_blank" rel="noreferrer" aria-label={`View ${event.title} on Resident Advisor`}>
                  View on RA <ArrowUpRight width={15} height={15} />
                </a>
              </footer>
            </article>
          )
        })}
      </div>
      {events.length < total && <p className="ra-cap">Showing the first {events.length} listings. Open RA for the full set.</p>}
    </section>
  )
}

export default function App({ token }) {
  const [city, setCity] = useState(DEFAULT_AREA.name)
  const [date, setDate] = useState(localDate)
  const [area, setArea] = useState(DEFAULT_AREA)
  const [loadedArea, setLoadedArea] = useState(DEFAULT_AREA)
  const [loadedDate, setLoadedDate] = useState(localDate)
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [events, setEvents] = useState([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [scrollRequest, setScrollRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef(null)

  const load = async (nextArea, nextDate) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    setShowSuggestions(false)
    setLoadedArea(nextArea)
    setLoadedDate(nextDate)
    setEvents([])
    setTotal(0)
    setSelectedId(null)
    setScrollRequest(null)
    try {
      const result = await fetchAreaEvents(token, nextArea, nextDate, controller.signal)
      if (controller.signal.aborted) return
      setArea(nextArea)
      setCity(nextArea.name)
      setEvents(result.events)
      setTotal(result.total)
      window.mobius?.signal?.('events_loaded', {
        city: nextArea.name,
        date: nextDate,
        count: result.events.length,
        mapped: result.events.filter((event) => Number.isFinite(event.venue.lat)).length,
      })
    } catch (caught) {
      if (caught.name === 'AbortError') return
      setEvents([])
      setTotal(0)
      setError(caught.message || 'Resident Advisor did not respond. Please try again.')
      window.mobius?.signal?.('error', { operation: 'load_events', message: caught.message || 'Unknown error' })
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    load(DEFAULT_AREA, date)
    return () => requestRef.current?.abort()
  }, [])

  useEffect(() => {
    const term = city.trim()
    if (area && term.toLowerCase() === area.name.toLowerCase()) {
      setSuggestions([])
      return undefined
    }
    if (term.length < 2) {
      setSuggestions([])
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      searchAreas(token, term, controller.signal)
        .then((choices) => {
          setSuggestions(choices)
          setShowSuggestions(true)
        })
        .catch((caught) => {
          if (caught.name !== 'AbortError') setSuggestions([])
        })
    }, 280)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [area, city, token])

  const chooseArea = (choice) => {
    setArea(choice)
    setCity(choice.name)
    setShowSuggestions(false)
  }

  const submit = async (event) => {
    event.preventDefault()
    let nextArea = area
    if (!nextArea || city.trim().toLowerCase() !== nextArea.name.toLowerCase()) {
      try {
        const choices = await searchAreas(token, city)
        nextArea = choices[0]
      } catch (caught) {
        setError(caught.message || 'City search failed. Please try again.')
        setLoading(false)
        return
      }
    }
    if (!nextArea) {
      setError(`Resident Advisor doesn’t appear to list a city called “${city.trim()}”.`)
      setLoading(false)
      return
    }
    load(nextArea, date)
  }

  const selectFromList = (id) => {
    setSelectedId(id)
  }

  const selectFromMap = (id) => {
    setSelectedId(id)
    setScrollRequest({ id, requestedAt: Date.now() })
    window.mobius?.signal?.('map_pin_opened', { event_id: id })
  }

  return (
    <div className="ra-root">
      <style>{LEAFLET_CSS}</style>
      <style>{CSS}</style>
      <header className="ra-toolbar">
        <div className="ra-brand">
          <span className="ra-mark"><MapPin width={19} height={19} /></span>
          <span><strong>RA Event Map</strong><small>Unofficial live finder</small></span>
        </div>
        <form className="ra-search" onSubmit={submit}>
          <div className="ra-city-wrap">
            <label htmlFor="ra-city">City</label>
            <div className="ra-input-shell">
              <Search width={17} height={17} />
              <input
                id="ra-city"
                value={city}
                onChange={(event) => { setCity(event.target.value); setArea(null) }}
                onFocus={() => suggestions.length && setShowSuggestions(true)}
                autoComplete="off"
                spellCheck="false"
                placeholder="London, Berlin, New York…"
              />
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div className="ra-suggestions" role="listbox" aria-label="Resident Advisor cities">
                {suggestions.map((choice) => (
                  <button type="button" role="option" key={choice.id} onClick={() => chooseArea(choice)}>
                    <span>{choice.name}</span><small>{choice.country}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ra-date-wrap">
            <label htmlFor="ra-date">Date</label>
            <div className="ra-input-shell">
              <Calendar width={17} height={17} />
              <input id="ra-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </div>
          </div>
          <button className="ra-submit" type="submit" disabled={loading} aria-label="Find events">
            <Search width={18} height={18} /><span>Find events</span>
          </button>
        </form>
      </header>
      <main className="ra-main">
        <LeafletEventMap
          area={loadedArea}
          events={events}
          selectedId={selectedId}
          onSelectFromMap={selectFromMap}
          token={token}
        />
        <EventList
          events={events}
          total={total}
          selectedId={selectedId}
          scrollRequest={scrollRequest}
          onSelect={selectFromList}
          loading={loading}
          error={error}
          area={loadedArea}
          date={loadedDate}
        />
      </main>
    </div>
  )
}

const CSS = `
  * { box-sizing: border-box; }
  html, body, #root { min-height: 100%; margin: 0; }
  button, input { font: inherit; }
  button, a { -webkit-tap-highlight-color: transparent; }
  .ra-root {
    --ra-lime: #c9f66b;
    --ra-ink: #182011;
    height: 100vh;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    background: var(--bg);
    font-family: var(--font);
  }
  .ra-toolbar {
    position: relative;
    z-index: 30;
    display: flex;
    align-items: flex-end;
    gap: 24px;
    padding: 13px 16px 14px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    backdrop-filter: blur(18px);
  }
  .ra-brand { display: flex; align-items: center; gap: 10px; min-width: 190px; padding-bottom: 1px; }
  .ra-brand > span:last-child { display: flex; flex-direction: column; line-height: 1.05; }
  .ra-brand strong { font-size: 15px; letter-spacing: -.02em; }
  .ra-brand small { margin-top: 4px; color: var(--muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
  .ra-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; color: var(--ra-ink); background: var(--ra-lime); box-shadow: 0 8px 28px rgba(174, 229, 75, .22); }
  .ra-search { min-width: 0; flex: 1; display: grid; grid-template-columns: minmax(170px, 1fr) minmax(150px, 190px) auto; gap: 9px; align-items: end; }
  .ra-search label { display: block; margin: 0 0 5px 3px; color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .ra-city-wrap, .ra-date-wrap { min-width: 0; position: relative; }
  .ra-input-shell { height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--border); border-radius: 13px; background: var(--surface-2); color: var(--muted); transition: border-color .18s ease, box-shadow .18s ease; }
  .ra-input-shell:focus-within { border-color: color-mix(in srgb, var(--ra-lime) 72%, var(--border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ra-lime) 16%, transparent); }
  .ra-input-shell input { width: 100%; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; color: var(--text); background: transparent; }
  .ra-date-wrap input { color-scheme: light dark; }
  .ra-submit { height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 17px; border: 0; border-radius: 13px; color: var(--ra-ink); background: var(--ra-lime); font-weight: 750; cursor: pointer; box-shadow: 0 10px 28px rgba(154, 209, 54, .18); }
  .ra-submit:disabled { opacity: .56; cursor: wait; }
  .ra-submit:focus-visible, .ra-event-main:focus-visible, .ra-event a:focus-visible, .ra-suggestions button:focus-visible { outline: 3px solid color-mix(in srgb, var(--ra-lime) 60%, white); outline-offset: 2px; }
  .ra-suggestions { position: absolute; z-index: 50; top: calc(100% + 7px); left: 0; right: 0; overflow: hidden; padding: 5px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: 0 18px 48px rgba(0, 0, 0, .22); }
  .ra-suggestions button { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 0; border-radius: 9px; color: var(--text); background: transparent; cursor: pointer; text-align: left; }
  .ra-suggestions button:hover { background: var(--surface-2); }
  .ra-suggestions small { color: var(--muted); }
  .ra-main { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(340px, .78fr); }
  .ra-map { position: relative; min-height: 260px; overflow: hidden; background: #202a25; isolation: isolate; }
  .ra-leaflet { position: absolute; z-index: 1; inset: 0; background: radial-gradient(circle at 55% 38%, rgba(201, 246, 107, .12), transparent 35%), #26332d; font-family: var(--font); }
  .ra-leaflet .leaflet-tile-pane { filter: saturate(.72) contrast(.93) brightness(.84); }
  .ra-map-wash { position: absolute; z-index: 400; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgba(12,20,16,.06), rgba(12,20,16,.13)); box-shadow: inset 0 0 70px rgba(5, 10, 7, .2); }
  .ra-pin-shell { border: 0 !important; background: transparent !important; }
  .ra-pin { width: 34px; height: 34px; display: grid; place-items: center; border: 2px solid rgba(255,255,255,.88); border-radius: 50% 50% 50% 12%; color: #17200e; background: var(--ra-lime); box-shadow: 0 8px 18px rgba(12,20,14,.32); cursor: pointer; rotate: -45deg; transition: scale .18s ease, box-shadow .18s ease; }
  .ra-pin > span { rotate: 45deg; font-size: 10px; font-weight: 850; }
  .ra-pin-shell:hover .ra-pin, .ra-pin.is-selected { scale: 1.18; box-shadow: 0 0 0 7px rgba(201,246,107,.2), 0 10px 22px rgba(5,12,8,.38); }
  .ra-pin.is-selected { background: #fff; }
  .ra-pin-shell:focus-visible { outline: 0; }
  .ra-pin-shell:focus-visible .ra-pin { box-shadow: 0 0 0 7px rgba(201,246,107,.34), 0 10px 22px rgba(5,12,8,.38); }
  .ra-map-state { position: absolute; z-index: 450; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; color: rgba(255,255,255,.82); background: #26332d; font-size: 12px; font-weight: 700; }
  .ra-map-meta { position: absolute; z-index: 1000; top: 14px; left: 14px; display: flex; gap: 7px; }
  .ra-map-meta span, .ra-map-meta button { min-height: 34px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid rgba(255,255,255,.26); border-radius: 11px; color: white; background: rgba(18,27,22,.76); backdrop-filter: blur(12px); font-size: 12px; font-weight: 700; }
  .ra-map-meta button { cursor: pointer; }
  .ra-map-meta button:hover { border-color: rgba(201,246,107,.7); }
  .ra-map-meta button:focus-visible { outline: 3px solid rgba(201,246,107,.65); outline-offset: 2px; }
  .ra-attribution { position: absolute; z-index: 1000; right: 7px; bottom: 6px; padding: 3px 5px; border-radius: 4px; color: rgba(255,255,255,.8); background: rgba(18,27,22,.72); font-size: 9px; text-decoration: none; }
  .ra-results { min-width: 0; overflow: auto; overscroll-behavior: contain; border-left: 1px solid var(--border); background: var(--surface); }
  .ra-results-head { position: sticky; z-index: 12; top: 0; display: flex; flex-direction: column; gap: 3px; padding: 17px 18px 15px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 94%, transparent); backdrop-filter: blur(16px); }
  .ra-results-head strong { font-size: 19px; letter-spacing: -.025em; }
  .ra-results-head small { color: var(--muted); font-size: 11px; }
  .ra-eyebrow { color: color-mix(in srgb, var(--accent) 85%, var(--text)); font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
  .ra-event-list { padding: 7px; }
  .ra-event { overflow: hidden; margin-bottom: 6px; border: 1px solid transparent; border-radius: 15px; background: var(--surface-2); transition: border-color .18s ease, background .18s ease, transform .18s ease; }
  .ra-event:hover { transform: translateY(-1px); }
  .ra-event.is-selected { border-color: color-mix(in srgb, var(--ra-lime) 52%, var(--border)); background: color-mix(in srgb, var(--surface-2) 92%, var(--ra-lime)); }
  .ra-event-main { width: 100%; display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 8px; padding: 13px 12px 9px; border: 0; color: var(--text); background: transparent; cursor: pointer; text-align: left; }
  .ra-event-index { width: 29px; height: 29px; display: grid; place-items: center; margin-top: 1px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
  .ra-event.is-selected .ra-event-index { border-color: transparent; color: var(--ra-ink); background: var(--ra-lime); }
  .ra-event-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .ra-event-time { color: color-mix(in srgb, var(--accent) 76%, var(--text)); font-size: 10px; font-weight: 800; letter-spacing: .06em; }
  .ra-event-copy strong { font-size: 14px; line-height: 1.24; letter-spacing: -.01em; }
  .ra-venue { overflow: hidden; color: var(--muted); font-size: 11px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
  .ra-event footer { min-height: 35px; display: flex; align-items: center; gap: 9px; padding: 0 12px 8px 56px; color: var(--muted); font-size: 10px; }
  .ra-event footer a { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; color: var(--text); font-weight: 700; text-decoration: none; }
  .ra-unmapped { padding: 3px 6px; border-radius: 6px; background: color-mix(in srgb, var(--border) 60%, transparent); }
  .ra-cap { margin: 10px 14px 18px; color: var(--muted); font-size: 11px; text-align: center; }
  .ra-message { display: flex; flex-direction: column; justify-content: center; padding: 32px; }
  .ra-message h2 { max-width: 360px; margin: 8px 0 5px; font-size: 24px; letter-spacing: -.04em; }
  .ra-message p { max-width: 400px; margin: 0; color: var(--muted); line-height: 1.5; }
  .ra-skeleton { margin: 8px; padding: 15px; border-radius: 15px; background: var(--surface-2); }
  .ra-skeleton i, .ra-skeleton span { display: block; height: 10px; margin-bottom: 9px; border-radius: 99px; background: linear-gradient(90deg, var(--border), color-mix(in srgb, var(--border) 25%, var(--surface-2)), var(--border)); background-size: 220% 100%; animation: ra-shimmer 1.4s linear infinite; }
  .ra-skeleton i { width: 22%; } .ra-skeleton span:nth-child(2) { width: 78%; height: 15px; } .ra-skeleton span:last-child { width: 54%; margin: 0; }
  @keyframes ra-shimmer { to { background-position: -220% 0; } }
  @media (max-width: 760px) {
    .ra-root { height: 100vh; min-height: 100%; overflow: hidden; }
    .ra-toolbar { display: block; padding: 9px 10px 10px; }
    .ra-brand { min-width: 0; margin-bottom: 8px; }
    .ra-mark { width: 34px; height: 34px; border-radius: 10px; }
    .ra-search { grid-template-columns: minmax(0, 1fr) 142px 44px; gap: 7px; }
    .ra-search label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .ra-input-shell, .ra-submit { height: 44px; border-radius: 12px; }
    .ra-input-shell { padding: 0 10px; }
    .ra-date-wrap .ra-input-shell { padding-left: 8px; padding-right: 5px; }
    .ra-date-wrap .ra-input-shell > svg { display: none; }
    .ra-submit { width: 44px; padding: 0; }
    .ra-submit span { display: none; }
    .ra-main { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(188px, 45%) minmax(0, 1fr); }
    .ra-map { height: auto; min-height: 0; }
    .ra-results { min-height: 0; overflow: auto; border-top: 1px solid var(--border); border-left: 0; }
    .ra-results-head { position: sticky; padding: 14px 13px 12px; }
    .ra-results-head strong { font-size: 17px; }
    .ra-event-list { padding: 6px; }
    .ra-event-main { padding-left: 9px; padding-right: 9px; }
    .ra-event footer { padding-left: 53px; }
    .ra-city-wrap .ra-suggestions { min-width: 230px; }
    .ra-map-meta { top: 10px; left: 10px; }
    .ra-map-meta span, .ra-map-meta button { min-height: 38px; }
  }
  @media (max-width: 390px) {
    .ra-search { grid-template-columns: minmax(0, 1fr) 128px 44px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
  }
`
