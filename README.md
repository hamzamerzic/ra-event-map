# RA Event Map

An unofficial live finder for public Resident Advisor event listings. Choose a city and date to view events as a ranked list and as venue pins on an interactive OpenStreetMap map.

The app reads Resident Advisor's public GraphQL listing data with authenticated GET requests through Möbius's external-fetch proxy. The same response supplies venue coordinates; OpenStreetMap provides only the basemap tiles. Events with missing or zeroed venue coordinates remain in the list and are labelled as not mapped.

The app is intentionally network-dependent and does not cache listing data as if it were current.

## Install in Möbius

Install the app with this raw manifest URL:

```text
https://raw.githubusercontent.com/hamzamerzic/ra-event-map/main/mobius.json
```

The package includes its map runtime, while live listings and map tiles remain network-dependent.

## Map controls

Drag to pan, pinch on touch devices, or use the mouse wheel on desktop to zoom. Selecting a listing zooms the map to its venue. Selecting a map pin keeps the map visible and scrolls only the results list to the matching event.

Resident Advisor is a trademark of its respective owner. This project is unofficial and is not affiliated with or endorsed by Resident Advisor.
