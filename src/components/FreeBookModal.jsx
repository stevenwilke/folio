import { useState, useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const CONDITION_OPTIONS = [
  { value: 'like_new', label: 'Like New' },
  { value: 'very_good', label: 'Very Good' },
  { value: 'good', label: 'Good' },
  { value: 'acceptable', label: 'Acceptable' },
]

export default function FreeBookModal({ session, book, parentDropId, onClose, onSuccess }) {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)

  const [latitude, setLatitude] = useState(null)
  const [longitude, setLongitude] = useState(null)
  const [locationName, setLocationName] = useState('')
  const [condition, setCondition] = useState('good')
  const [note, setNote] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-98.5, 39.8], // US center default
      zoom: 3,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')

    // Try to center on user location
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 13 })
      },
      () => {} // ignore errors
    )

    map.on('click', async (e) => {
      const { lng, lat } = e.lngLat
      setLatitude(lat)
      setLongitude(lng)

      if (markerRef.current) markerRef.current.remove()
      markerRef.current = new mapboxgl.Marker({ color: '#c0521e' })
        .setLngLat([lng, lat])
        .addTo(map)

      // Reverse geocode
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`
        )
        const data = await res.json()
        if (data.features?.[0]) {
          setLocationName(data.features[0].place_name || '')
        }
      } catch { /* ignore */ }
    })

    return () => map.remove()
  }, [])

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!latitude || !longitude || !locationName.trim()) {
      setError('Tap the map to set a location')
      return
    }
    setSubmitting(true)
    setError(null)

    let photoUrl = null
    if (photoFile) {
      const ext = photoFile.name.split('.').pop()
      const path = `${session.user.id}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('drop-photos')
        .upload(path, photoFile, { contentType: photoFile.type, upsert: true })
      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage.from('drop-photos').getPublicUrl(path)
        photoUrl = publicUrl
      }
    }

    const { data, error: insertErr } = await supabase.from('book_drops').insert({
      user_id: session.user.id,
      book_id: book.id,
      latitude,
      longitude,
      location_name: locationName.trim(),
      condition,
      note: note.trim() || null,
      photo_url: photoUrl,
      parent_drop_id: parentDropId || null,
    }).select().single()

    if (insertErr) {
      setError(insertErr.message)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    onSuccess?.(data)
    onClose()
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '8px 12px',
    border: `1px solid ${theme.border}`, borderRadius: 8,
    fontSize: 13, background: theme.bgCard, color: theme.text,
    fontFamily: "'DM Sans', sans-serif", outline: 'none',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 16,
        width: 500, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
        padding: '24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 }}>
            📍 Free This Book
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle }}>✕</button>
        </div>

        <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 12 }}>
          Tap the map to mark where you're leaving <strong style={{ color: theme.text }}>{book.title}</strong>
        </div>

        {/* Map */}
        <div
          ref={mapContainer}
          style={{ width: '100%', height: isMobile ? 200 : 250, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}
        />

        {/* Location name */}
        <input
          value={locationName}
          onChange={e => setLocationName(e.target.value)}
          placeholder="Location name (auto-filled from map)"
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        {/* Condition */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: theme.textSubtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Condition
          </label>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {CONDITION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setCondition(opt.value)}
                style={{
                  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  border: condition === opt.value ? `2px solid ${theme.rust}` : `1px solid ${theme.border}`,
                  background: condition === opt.value ? theme.rustLight : theme.bgCard,
                  color: condition === opt.value ? theme.rust : theme.text,
                  fontFamily: "'DM Sans', sans-serif", fontWeight: condition === opt.value ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional note (e.g., 'On the bench near the fountain')"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', marginBottom: 12 }}
        />

        {/* Photo */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: theme.textSubtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Photo (optional)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <label style={{
              padding: '6px 14px', background: theme.bgCard, border: `1px solid ${theme.border}`,
              borderRadius: 6, fontSize: 12, cursor: 'pointer', color: theme.text,
              fontFamily: "'DM Sans', sans-serif",
            }}>
              📷 Choose Photo
              <input type="file" accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
            </label>
            {photoPreview && (
              <img src={photoPreview} alt="Preview" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
            )}
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: '#d32f2f', marginBottom: 12 }}>{error}</div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: '100%', padding: '10px', background: theme.rust, color: 'white',
            border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
            cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {submitting ? 'Dropping book...' : 'Free This Book'}
        </button>
      </div>
    </div>
  )
}
