// Fetch Little Free Library / public bookcase locations from OpenStreetMap
// via the Overpass API. OSM tag: amenity=public_bookcase.
// Mirror of mobile/lib/osmLibraries.ts — same shape, JS for the web app.

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const FETCH_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 5 * 60 * 1000

const cache = new Map()

function cacheKey(lat, lng, radiusKm) {
  return `${lat.toFixed(2)}:${lng.toFixed(2)}:${Math.round(radiusKm)}`
}

export async function fetchOsmLibraries(lat, lng, radiusKm) {
  const key = cacheKey(lat, lng, radiusKm)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.rows

  const radiusMeters = Math.round(Math.min(radiusKm, 100) * 1000)
  const query = `
    [out:json][timeout:10];
    (
      node["amenity"="public_bookcase"](around:${radiusMeters},${lat},${lng});
      way["amenity"="public_bookcase"](around:${radiusMeters},${lat},${lng});
    );
    out center tags;
  `.trim()

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) continue
      const json = await res.json()
      const rows = (json.elements || []).map(parseElement).filter(Boolean)
      cache.set(key, { ts: Date.now(), rows })
      return rows
    } catch {
      clearTimeout(timer)
    }
  }
  return cached?.rows ?? []
}

function parseElement(el) {
  const lat = el.lat ?? el.center?.lat
  const lng = el.lon ?? el.center?.lon
  if (lat == null || lng == null) return null
  const tags = el.tags || {}
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
  const addrParts = [street, tags['addr:city']].filter(Boolean)
  return {
    osm_id: `${el.type}/${el.id}`,
    latitude: lat,
    longitude: lng,
    name: tags.name || null,
    location_name: addrParts.length ? addrParts.join(', ') : null,
    operator: tags.operator || null,
  }
}
