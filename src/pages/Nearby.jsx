import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import { supabase } from '../lib/supabase'
import NavBar from '../components/NavBar'
import BookDropCard from '../components/BookDropCard'
import AddLibraryModal from '../components/AddLibraryModal'
import ScanLibraryModal from '../components/ScanLibraryModal'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { haversineKm, formatDistance } from '../lib/geo'
import { getCoverUrl } from '../lib/coverUrl'
import { fetchOsmLibraries } from '../lib/osmLibraries'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const RADIUS_OPTIONS = [5, 10, 25, 50, null] // null = Any
const RADIUS_LABELS = { 5: '5 km', 10: '10 km', 25: '25 km', 50: '50 km', null: 'Any' }
const OSM_PIN_COLOR = '#b08968'
const OSM_DEDUP_METERS = 30

const CONDITION_LABELS = {
  like_new: 'Like New', very_good: 'Very Good', good: 'Good', acceptable: 'Acceptable',
}
const CONDITION_COLORS = {
  like_new: '#5a7a5a', very_good: '#5a7a5a', good: '#b8860b', acceptable: '#c0521e',
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export default function Nearby({ session }) {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const userMarkerRef = useRef(null)

  const [drops, setDrops] = useState([])
  const [myDrops, setMyDrops] = useState([])
  const [libraries, setLibraries] = useState([])
  const [osmLibraries, setOsmLibraries] = useState([])
  const [osmLoading, setOsmLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('nearby') // nearby | my-drops | libraries
  const [view, setView] = useState('map') // map | list
  const [userLat, setUserLat] = useState(null)
  const [userLng, setUserLng] = useState(null)
  const [radius, setRadius] = useState(25)
  const [selectedDrop, setSelectedDrop] = useState(null)
  const [selectedLibrary, setSelectedLibrary] = useState(null)
  const [selectedOsm, setSelectedOsm] = useState(null)
  const [showAddLibrary, setShowAddLibrary] = useState(false)
  const [adoptInitial, setAdoptInitial] = useState(null)
  const [showScanLibrary, setShowScanLibrary] = useState(null) // library object
  const [claiming, setClaiming] = useState(null)

  useEffect(() => { fetchDrops(); fetchLibraries() }, [])

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => { setUserLat(pos.coords.latitude); setUserLng(pos.coords.longitude) },
      () => {}
    )
  }, [])

  async function fetchDrops() {
    setLoading(true)
    const [{ data: available }, { data: mine }] = await Promise.all([
      // Cap the global query — radius is filtered client-side, but without a limit
      // this can pull every available drop in the world as the table grows.
      supabase
        .from('book_drops')
        .select('*, books(id, title, author, cover_image_url, genre), profiles:user_id(username, avatar_url)')
        .eq('status', 'available')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('book_drops')
        .select('*, books(id, title, author, cover_image_url, genre), claimer:claimed_by(username)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false }),
    ])
    setDrops(available || [])
    setMyDrops(mine || [])
    setLoading(false)
  }

  async function fetchLibraries() {
    const { data, error } = await supabase
      .from('little_libraries')
      .select('*, little_library_scans(id, books_found, photo_url, created_at, user_id)')
      .order('created_at', { ascending: false })
    if (error) { console.error('fetchLibraries error:', error); return }
    // Pick most recent scan for each library
    setLibraries((data || []).map(lib => ({
      ...lib,
      latest_scan: lib.little_library_scans?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))?.[0] || null,
    })))
  }

  // Round to ~1km grid so small geolocation jitters don't refire the OSM fetch.
  const osmLat = userLat != null ? Math.round(userLat * 100) / 100 : null
  const osmLng = userLng != null ? Math.round(userLng * 100) / 100 : null

  // Fetch OSM-sourced little libraries for the user's area when on the libraries tab.
  useEffect(() => {
    if (tab !== 'libraries' || osmLat == null || osmLng == null) return
    let cancelled = false
    setOsmLoading(true)
    fetchOsmLibraries(osmLat, osmLng, radius ?? 50)
      .then(rows => { if (!cancelled) setOsmLibraries(rows) })
      .finally(() => { if (!cancelled) setOsmLoading(false) })
    return () => { cancelled = true }
  }, [tab, osmLat, osmLng, radius])

  // Compute distances for libraries
  const librariesWithDistance = libraries.map(lib => ({
    ...lib,
    distanceKm: userLat != null ? haversineKm(userLat, userLng, lib.latitude, lib.longitude) : null,
  }))

  const filteredLibraries = librariesWithDistance.filter(lib => {
    if (radius == null) return true
    if (lib.distanceKm == null) return true
    return lib.distanceKm <= radius
  }).sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))

  // Dedupe OSM pins against adopted (osm_id match) and very-close (≤30m) user pins.
  const adoptedOsmIds = new Set(libraries.map(l => l.osm_id).filter(Boolean))
  const filteredOsm = osmLibraries
    .filter(o => !adoptedOsmIds.has(o.osm_id))
    .filter(o => !libraries.some(l =>
      l.latitude != null && l.longitude != null &&
      haversineKm(l.latitude, l.longitude, o.latitude, o.longitude) * 1000 < OSM_DEDUP_METERS
    ))
    .map(o => ({
      ...o,
      distanceKm: userLat != null ? haversineKm(userLat, userLng, o.latitude, o.longitude) : null,
    }))
    .filter(o => radius == null || o.distanceKm == null || o.distanceKm <= radius)
    .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))

  const totalLibraries = filteredLibraries.length + filteredOsm.length

  // Compute distances
  const dropsWithDistance = drops.map(d => ({
    ...d,
    distanceKm: userLat != null ? haversineKm(userLat, userLng, d.latitude, d.longitude) : null,
  }))

  // Filter by radius
  const filtered = dropsWithDistance.filter(d => {
    if (radius == null) return true
    if (d.distanceKm == null) return true // no user location, show all
    return d.distanceKm <= radius
  }).sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))

  // Initialize map. Intentionally NOT depending on userLat — when geolocation
  // resolves later we flyTo (see effect below) instead of rebuilding the map.
  useEffect(() => {
    if ((tab !== 'nearby' && tab !== 'libraries') || view !== 'map' || !mapContainer.current || !MAPBOX_TOKEN) return

    // Destroy old map if the container changed (tab switch unmounts the old one)
    if (mapRef.current) {
      try {
        const oldContainer = mapRef.current.getContainer()
        if (!document.body.contains(oldContainer)) {
          mapRef.current.remove()
          mapRef.current = null
        }
      } catch { mapRef.current = null }
    }

    if (mapRef.current) {
      updateMarkers()
      return
    }

    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: userLng && userLat ? [userLng, userLat] : [-98.5, 39.8],
      zoom: userLat ? 10 : 3,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.on('load', () => updateMarkers())
    return () => {
      map.remove()
      mapRef.current = null
      userMarkerRef.current = null
    }
  }, [tab, view])

  // When geolocation arrives (or radius changes), recenter without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map || userLat == null || userLng == null) return
    map.flyTo({ center: [userLng, userLat], zoom: 11, duration: 800 })
    if (userMarkerRef.current) userMarkerRef.current.remove()
    userMarkerRef.current = new mapboxgl.Marker({ color: '#4a90d9' })
      .setLngLat([userLng, userLat])
      .addTo(map)
  }, [userLat, userLng])

  useEffect(() => {
    if (mapRef.current) updateMarkers()
  }, [filtered.length, filteredLibraries.length, filteredOsm.length, radius, tab])

  function updateMarkers() {
    const map = mapRef.current
    if (!map) return
    // Remove old markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    if (tab === 'nearby') {
      for (const drop of filtered) {
        const el = document.createElement('div')
        el.style.width = '28px'
        el.style.height = '28px'
        el.style.borderRadius = '50%'
        el.style.background = '#c0521e'
        el.style.border = '3px solid white'
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)'
        el.style.cursor = 'pointer'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.fontSize = '12px'
        el.textContent = '📖'
        el.addEventListener('click', () => setSelectedDrop(drop))

        const marker = new mapboxgl.Marker(el)
          .setLngLat([drop.longitude, drop.latitude])
          .addTo(map)
        markersRef.current.push(marker)
      }

      if (filtered.length > 0 && !userLat) {
        const bounds = new mapboxgl.LngLatBounds()
        filtered.forEach(d => bounds.extend([d.longitude, d.latitude]))
        map.fitBounds(bounds, { padding: 60 })
      }
    }

    if (tab === 'libraries') {
      for (const lib of filteredLibraries) {
        const el = document.createElement('div')
        el.style.width = '30px'
        el.style.height = '30px'
        el.style.borderRadius = '50%'
        el.style.background = '#2a9d8f'
        el.style.border = '3px solid white'
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)'
        el.style.cursor = 'pointer'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.fontSize = '13px'
        el.textContent = '📚'
        el.addEventListener('click', () => setSelectedLibrary(lib))

        const marker = new mapboxgl.Marker(el)
          .setLngLat([lib.longitude, lib.latitude])
          .addTo(map)
        markersRef.current.push(marker)
      }

      // OSM-sourced pins (muted brown to distinguish from user-added teal)
      for (const osm of filteredOsm) {
        const el = document.createElement('div')
        el.style.width = '28px'
        el.style.height = '28px'
        el.style.borderRadius = '50%'
        el.style.background = OSM_PIN_COLOR
        el.style.border = '3px solid white'
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)'
        el.style.cursor = 'pointer'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.fontSize = '12px'
        el.textContent = '📖'
        el.title = osm.name || 'Little Free Library (OpenStreetMap)'
        el.addEventListener('click', () => setSelectedOsm(osm))

        const marker = new mapboxgl.Marker(el)
          .setLngLat([osm.longitude, osm.latitude])
          .addTo(map)
        markersRef.current.push(marker)
      }

      if ((filteredLibraries.length + filteredOsm.length) > 0 && !userLat) {
        const bounds = new mapboxgl.LngLatBounds()
        filteredLibraries.forEach(lib => bounds.extend([lib.longitude, lib.latitude]))
        filteredOsm.forEach(o => bounds.extend([o.longitude, o.latitude]))
        map.fitBounds(bounds, { padding: 60 })
      }
    }
  }

  async function claimDrop(dropId) {
    setClaiming(dropId)
    const { error } = await supabase
      .from('book_drops')
      .update({ status: 'claimed', claimed_by: session.user.id, claimed_at: new Date().toISOString() })
      .eq('id', dropId)
      .eq('status', 'available')

    if (!error) {
      // Notify the dropper
      const drop = drops.find(d => d.id === dropId)
      if (drop && drop.user_id !== session.user.id) {
        const { data: myProfile } = await supabase.from('profiles').select('username').eq('id', session.user.id).single()
        await supabase.from('notifications').insert({
          user_id: drop.user_id,
          type: 'book_drop_claimed',
          title: `${myProfile?.username || 'Someone'} claimed "${drop.books?.title}"`,
          body: `Your book drop at ${drop.location_name} was claimed!`,
          link: '/nearby',
        })
      }
      setSelectedDrop(null)
      fetchDrops()
    }
    setClaiming(null)
  }

  const s = makeStyles(theme, isMobile)

  return (
    <div style={s.page}>
      <NavBar session={session} />
      <div style={s.content}>

        {/* Header */}
        <div style={s.header}>
          <h1 style={s.h1}>📍 Nearby Books</h1>
          <p style={s.subtitle}>Find books freed by readers in your area</p>
        </div>

        {/* Tabs */}
        <div style={s.tabRow}>
          {[['nearby', 'Nearby'], ['libraries', '📚 Little Libraries'], ['my-drops', 'My Drops']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setSelectedDrop(null); setSelectedLibrary(null) }}
              style={tab === key ? s.tabActive : s.tab}
            >
              {label}
              {key === 'my-drops' && myDrops.length > 0 && (
                <span style={s.tabCount}>{myDrops.length}</span>
              )}
              {key === 'libraries' && libraries.length > 0 && (
                <span style={s.tabCount}>{libraries.length}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'nearby' && (
          <>
            {/* Controls */}
            <div style={s.controls}>
              <div style={s.filterRow}>
                <span style={s.filterLabel}>Radius:</span>
                {RADIUS_OPTIONS.map(r => (
                  <button
                    key={String(r)}
                    onClick={() => setRadius(r)}
                    style={radius === r ? s.pillActive : s.pill}
                  >
                    {RADIUS_LABELS[r]}
                  </button>
                ))}
              </div>
              <div style={s.viewToggle}>
                <button onClick={() => setView('map')} style={view === 'map' ? s.viewBtnActive : s.viewBtn}>🗺️ Map</button>
                <button onClick={() => setView('list')} style={view === 'list' ? s.viewBtnActive : s.viewBtn}>📋 List</button>
              </div>
            </div>

            {/* Map view — render immediately so Mapbox can warm up while data loads */}
            {view === 'map' && (
              <div style={{ position: 'relative' }}>
                <div ref={mapContainer} style={s.mapContainer} />
                <div style={s.mapCount}>
                  {loading
                    ? 'Loading…'
                    : `${filtered.length} book${filtered.length !== 1 ? 's' : ''} available`}
                </div>
              </div>
            )}

            {/* List view */}
            {view === 'list' && (
              loading ? (
                <div style={s.empty}>Loading nearby books...</div>
              ) : filtered.length === 0 ? (
                <div style={s.empty}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📍</div>
                  <div style={{ fontWeight: 600, color: theme.text, marginBottom: 6 }}>No books nearby</div>
                  <div>Be the first to free a book in your area!</div>
                </div>
              ) : (
                <div style={s.grid}>
                  {filtered.map(drop => (
                    <BookDropCard
                      key={drop.id}
                      drop={drop}
                      distanceKm={drop.distanceKm}
                      onClick={() => setSelectedDrop(drop)}
                    />
                  ))}
                </div>
              )
            )}

            {/* Selected drop detail panel */}
            {selectedDrop && (
              <div
                style={s.detailOverlay}
                onClick={e => { if (e.target === e.currentTarget) setSelectedDrop(null) }}
              >
                <div style={s.detailCard}>
                  <button onClick={() => setSelectedDrop(null)} style={s.detailClose}>✕</button>

                  <div style={s.detailTop}>
                    {selectedDrop.books?.cover_image_url && (
                      <img
                        src={getCoverUrl(selectedDrop.books)}
                        alt={selectedDrop.books.title}
                        style={s.detailCover}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={s.detailTitle}>{selectedDrop.books?.title}</div>
                      <div style={s.detailAuthor}>{selectedDrop.books?.author}</div>
                      <span style={{
                        display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600,
                        padding: '2px 8px', borderRadius: 10,
                        background: `${CONDITION_COLORS[selectedDrop.condition]}18`,
                        color: CONDITION_COLORS[selectedDrop.condition],
                      }}>
                        {CONDITION_LABELS[selectedDrop.condition]}
                      </span>
                    </div>
                  </div>

                  <div style={s.detailMeta}>
                    <div>📍 {selectedDrop.location_name}</div>
                    {selectedDrop.distanceKm != null && (
                      <div>{formatDistance(selectedDrop.distanceKm)} from you</div>
                    )}
                    <div>Freed by {selectedDrop.profiles?.username} · {timeAgo(selectedDrop.created_at)}</div>
                  </div>

                  {selectedDrop.note && (
                    <div style={s.detailNote}>"{selectedDrop.note}"</div>
                  )}

                  {selectedDrop.photo_url && (
                    <img src={selectedDrop.photo_url} alt="Drop location" style={s.detailPhoto} />
                  )}

                  {selectedDrop.user_id !== session.user.id ? (
                    <button
                      onClick={() => claimDrop(selectedDrop.id)}
                      disabled={claiming === selectedDrop.id}
                      style={s.claimBtn}
                    >
                      {claiming === selectedDrop.id ? 'Claiming...' : '🎉 Claim This Book'}
                    </button>
                  ) : (
                    <div style={{ fontSize: 12, color: theme.textSubtle, textAlign: 'center', marginTop: 12, fontStyle: 'italic' }}>
                      This is your book drop
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Little Libraries tab */}
        {tab === 'libraries' && (
          <>
            <div style={s.controls}>
              <div style={s.filterRow}>
                <span style={s.filterLabel}>Radius:</span>
                {RADIUS_OPTIONS.map(r => (
                  <button
                    key={String(r)}
                    onClick={() => setRadius(r)}
                    style={radius === r ? s.pillActive : s.pill}
                  >
                    {RADIUS_LABELS[r]}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={s.viewToggle}>
                  <button onClick={() => setView('map')} style={view === 'map' ? s.viewBtnActive : s.viewBtn}>🗺️ Map</button>
                  <button onClick={() => setView('list')} style={view === 'list' ? s.viewBtnActive : s.viewBtn}>📋 List</button>
                </div>
                <button
                  onClick={() => setShowAddLibrary(true)}
                  style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: '#2a9d8f', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  + Add Library
                </button>
              </div>
            </div>

            {view === 'map' ? (
              <div style={{ position: 'relative' }}>
                <div ref={mapContainer} style={s.mapContainer} />
                <div style={{ ...s.mapCount, background: 'rgba(42,157,143,0.92)', color: 'white' }}>
                  {totalLibraries} librar{totalLibraries !== 1 ? 'ies' : 'y'}
                  {filteredOsm.length > 0 && ` · ${filteredOsm.length} from OpenStreetMap`}
                  {osmLoading && totalLibraries === 0 && ' · searching…'}
                </div>
              </div>
            ) : loading ? (
              <div style={s.empty}>Loading little libraries...</div>
            ) : totalLibraries === 0 ? (
              <div style={s.empty}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📚</div>
                <div style={{ fontWeight: 600, color: theme.text, marginBottom: 6 }}>
                  {osmLoading ? 'Searching nearby…' : 'No Little Libraries nearby'}
                </div>
                <div>Know of one? Add it to the map!</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  ...filteredLibraries.map(l => ({ ...l, __osm: false })),
                  ...filteredOsm.map(o => ({ ...o, __osm: true })),
                ]
                  .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))
                  .map(item => item.__osm ? (
                    <div
                      key={`osm:${item.osm_id}`}
                      onClick={() => setSelectedOsm(item)}
                      style={{ ...s.myDropRow, cursor: 'pointer', borderStyle: 'dashed' }}
                    >
                      <div style={{ width: 48, height: 48, borderRadius: 8, background: '#f5ede3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📖</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
                          {item.name || 'Little Free Library'}
                        </div>
                        <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>
                          📍 {item.location_name || 'From OpenStreetMap'}
                        </div>
                        <div style={{ fontSize: 11, color: OSM_PIN_COLOR, marginTop: 2, fontStyle: 'italic' }}>
                          Tap to adopt · OpenStreetMap
                        </div>
                      </div>
                      {item.distanceKm != null && (
                        <span style={{ fontSize: 12, color: theme.textSubtle }}>{formatDistance(item.distanceKm)}</span>
                      )}
                    </div>
                  ) : (
                    <div
                      key={item.id}
                      onClick={() => setSelectedLibrary(item)}
                      style={{ ...s.myDropRow, cursor: 'pointer' }}
                    >
                      {item.photo_url && (
                        <img src={item.photo_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
                          {item.name || 'Little Library'}
                        </div>
                        <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>
                          📍 {item.location_name}
                        </div>
                        {item.latest_scan && (
                          <div style={{ fontSize: 11, color: theme.textSubtle, marginTop: 2 }}>
                            📷 {item.latest_scan.books_found?.length || 0} books spotted · {timeAgo(item.latest_scan.created_at)}
                          </div>
                        )}
                      </div>
                      {item.distanceKm != null && (
                        <span style={{ fontSize: 12, color: theme.textSubtle }}>{formatDistance(item.distanceKm)}</span>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {/* Library detail panel */}
            {selectedLibrary && (
              <div
                style={s.detailOverlay}
                onClick={e => { if (e.target === e.currentTarget) setSelectedLibrary(null) }}
              >
                <div style={s.detailCard}>
                  <button onClick={() => setSelectedLibrary(null)} style={s.detailClose}>✕</button>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ ...s.detailTitle, marginBottom: 4 }}>
                      📚 {selectedLibrary.name || 'Little Library'}
                    </div>
                    <div style={{ fontSize: 13, color: theme.textSubtle }}>
                      📍 {selectedLibrary.location_name}
                      {selectedLibrary.distanceKm != null && ` · ${formatDistance(selectedLibrary.distanceKm)}`}
                    </div>
                    <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>
                      Added {timeAgo(selectedLibrary.created_at)}
                    </div>
                  </div>

                  {selectedLibrary.photo_url && (
                    <img src={selectedLibrary.photo_url} alt="Little Library" style={{ ...s.detailPhoto, marginBottom: 14 }} />
                  )}

                  {/* Latest scan */}
                  {selectedLibrary.latest_scan ? (
                    <div style={{ background: theme.bgSubtle || theme.bgCard, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
                        📷 Latest Inventory · {timeAgo(selectedLibrary.latest_scan.created_at)}
                      </div>
                      {selectedLibrary.latest_scan.photo_url && (
                        <img src={selectedLibrary.latest_scan.photo_url} alt="Library contents" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
                      )}
                      {selectedLibrary.latest_scan.books_found?.length > 0 ? (
                        <div style={{ maxHeight: 160, overflow: 'auto' }}>
                          {selectedLibrary.latest_scan.books_found.map((b, i) => (
                            <div key={i} style={{ fontSize: 13, color: theme.text, marginBottom: 3 }}>
                              <strong>{b.title}</strong>
                              {b.author && <span style={{ color: theme.textSubtle }}> by {b.author}</span>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: theme.textSubtle }}>No books identified in last scan</div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: theme.textSubtle, fontStyle: 'italic', marginBottom: 14, textAlign: 'center' }}>
                      No inventory scans yet — be the first!
                    </div>
                  )}

                  <button
                    onClick={() => { setShowScanLibrary(selectedLibrary); setSelectedLibrary(null) }}
                    style={{ width: '100%', padding: '12px', background: '#2a9d8f', color: 'white', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                  >
                    📷 Update Inventory
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* My Drops tab */}
        {tab === 'my-drops' && (
          <div>
            {myDrops.length === 0 ? (
              <div style={s.empty}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📚</div>
                <div style={{ fontWeight: 600, color: theme.text, marginBottom: 6 }}>No book drops yet</div>
                <div>Open a book and tap "Free Book Drop" to get started!</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {myDrops.map(drop => (
                  <div key={drop.id} style={s.myDropRow}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
                        {drop.books?.title}
                      </div>
                      <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 2 }}>
                        📍 {drop.location_name} · {timeAgo(drop.created_at)}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                      background: drop.status === 'available' ? 'rgba(90,122,90,0.12)' : 'rgba(184,134,11,0.12)',
                      color: drop.status === 'available' ? '#5a7a5a' : '#b8860b',
                    }}>
                      {drop.status === 'available' ? 'Available' :
                       drop.status === 'claimed' ? `Claimed by ${drop.claimer?.username || 'someone'}` :
                       drop.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* OSM library detail */}
        {selectedOsm && (
          <div
            style={s.detailOverlay}
            onClick={e => { if (e.target === e.currentTarget) setSelectedOsm(null) }}
          >
            <div style={s.detailCard}>
              <button onClick={() => setSelectedOsm(null)} style={s.detailClose}>✕</button>
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...s.detailTitle, marginBottom: 4 }}>
                  📖 {selectedOsm.name || 'Little Free Library'}
                </div>
                {selectedOsm.location_name && (
                  <div style={{ fontSize: 13, color: theme.textSubtle }}>📍 {selectedOsm.location_name}</div>
                )}
                {selectedOsm.distanceKm != null && (
                  <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 2 }}>
                    {formatDistance(selectedOsm.distanceKm)} from you
                  </div>
                )}
                {selectedOsm.operator && (
                  <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 2 }}>Operated by {selectedOsm.operator}</div>
                )}
                <div style={{ fontSize: 11, color: OSM_PIN_COLOR, marginTop: 8, fontStyle: 'italic' }}>
                  Source: OpenStreetMap
                </div>
              </div>
              <button
                onClick={() => {
                  setAdoptInitial({
                    latitude: selectedOsm.latitude,
                    longitude: selectedOsm.longitude,
                    name: selectedOsm.name || '',
                    locationName: selectedOsm.location_name || '',
                    osmId: selectedOsm.osm_id,
                  })
                  setSelectedOsm(null)
                }}
                style={{ width: '100%', padding: '12px', background: '#2a9d8f', color: 'white', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
              >
                📚 Adopt this library
              </button>
            </div>
          </div>
        )}

        {/* Modals */}
        {(showAddLibrary || adoptInitial) && (
          <AddLibraryModal
            session={session}
            initial={adoptInitial}
            onClose={() => { setShowAddLibrary(false); setAdoptInitial(null) }}
            onSuccess={() => { setShowAddLibrary(false); setAdoptInitial(null); fetchLibraries() }}
          />
        )}
        {showScanLibrary && (
          <ScanLibraryModal
            session={session}
            library={showScanLibrary}
            onClose={() => setShowScanLibrary(null)}
            onSuccess={() => { setShowScanLibrary(null); fetchLibraries() }}
          />
        )}
      </div>
    </div>
  )
}

function makeStyles(theme, isMobile) {
  return {
    page:    { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    content: { maxWidth: 960, margin: '0 auto', padding: isMobile ? '16px 16px 80px' : '32px 32px 60px' },

    header:   { marginBottom: 20 },
    h1:       { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 700, color: theme.text, margin: '0 0 4px' },
    subtitle: { fontSize: 14, color: theme.textSubtle, margin: 0 },

    tabRow:    { display: 'flex', gap: 0, marginBottom: 20, borderBottom: `1px solid ${theme.border}` },
    tab:       { padding: '10px 20px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 14, color: theme.textSubtle, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    tabActive: { padding: '10px 20px', background: 'none', border: 'none', borderBottom: `2px solid ${theme.rust}`, fontSize: 14, color: theme.rust, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    tabCount:  { fontSize: 11, background: theme.bgSubtle, borderRadius: 10, padding: '1px 7px', marginLeft: 6, color: theme.textSubtle },

    controls:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
    filterRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    filterLabel: { fontSize: 12, color: theme.textSubtle, fontWeight: 500 },
    pill:       { padding: '5px 12px', borderRadius: 20, border: `1px solid ${theme.border}`, background: theme.bgCard, fontSize: 12, cursor: 'pointer', color: theme.text, fontFamily: "'DM Sans', sans-serif" },
    pillActive: { padding: '5px 12px', borderRadius: 20, border: `1px solid ${theme.rust}`, background: theme.rustLight, fontSize: 12, cursor: 'pointer', color: theme.rust, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" },

    viewToggle:  { display: 'flex', gap: 4 },
    viewBtn:     { padding: '5px 12px', borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.bgCard, fontSize: 12, cursor: 'pointer', color: theme.textSubtle, fontFamily: "'DM Sans', sans-serif" },
    viewBtnActive: { padding: '5px 12px', borderRadius: 6, border: `1px solid ${theme.rust}`, background: theme.rustLight, fontSize: 12, cursor: 'pointer', color: theme.rust, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" },

    mapContainer: { width: '100%', height: isMobile ? 'calc(100vh - 320px)' : 'calc(100vh - 280px)', borderRadius: 12, overflow: 'hidden' },
    mapCount:     { position: 'absolute', top: 10, left: 10, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, color: '#1a1208' },

    grid: { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(150px, 1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 },

    empty: { textAlign: 'center', padding: '60px 20px', background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, color: theme.textSubtle, fontSize: 15 },

    detailOverlay: { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    detailCard:    { background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 16, padding: '24px', width: 420, maxWidth: '92vw', maxHeight: '85vh', overflow: 'auto', position: 'relative' },
    detailClose:   { position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle },
    detailTop:     { display: 'flex', gap: 14, marginBottom: 14 },
    detailCover:   { width: 80, height: 120, objectFit: 'cover', borderRadius: 6, boxShadow: '2px 3px 10px rgba(0,0,0,0.15)' },
    detailTitle:   { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text, lineHeight: 1.2 },
    detailAuthor:  { fontSize: 13, color: theme.textSubtle, marginTop: 4 },
    detailMeta:    { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: theme.textSubtle, marginBottom: 12 },
    detailNote:    { fontSize: 13, color: theme.text, fontStyle: 'italic', padding: '10px 14px', background: theme.bgSubtle, borderRadius: 8, marginBottom: 12 },
    detailPhoto:   { width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, marginBottom: 12 },
    claimBtn:      { width: '100%', padding: '12px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginTop: 8 },

    myDropRow: { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12 },
  }
}
