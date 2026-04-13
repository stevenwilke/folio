import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { haversineKm, formatDistance } from '../lib/geo'

const STATUS_LABELS = {
  available: 'Available',
  claimed: 'Claimed',
  collected: 'Collected',
  expired: 'Expired',
}

const STATUS_COLORS = {
  available: '#5a7a5a',
  claimed:   '#b8860b',
  collected: '#c0521e',
  expired:   '#8a7f72',
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BookJourney({ bookId }) {
  const { theme } = useTheme()
  const [drops, setDrops] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!bookId) return
    (async () => {
      const { data } = await supabase
        .from('book_drops')
        .select('*, profiles:user_id(username, avatar_url), claimer:claimed_by(username)')
        .eq('book_id', bookId)
        .order('created_at', { ascending: true })
      setDrops(data || [])
      setLoading(false)
    })()
  }, [bookId])

  if (loading || drops.length === 0) return null

  // Calculate total distance
  let totalKm = 0
  for (let i = 1; i < drops.length; i++) {
    totalKm += haversineKm(
      drops[i - 1].latitude, drops[i - 1].longitude,
      drops[i].latitude, drops[i].longitude
    )
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>🗺️</span>
        <div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text }}>
            Book Journey
          </div>
          <div style={{ fontSize: 12, color: theme.textSubtle }}>
            {drops.length} location{drops.length !== 1 ? 's' : ''}
            {totalKm > 0 && ` · Traveled ${formatDistance(totalKm)}`}
          </div>
        </div>
      </div>

      <div style={{ paddingLeft: 18, borderLeft: `2px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {drops.map((drop, i) => {
          const distFromPrev = i > 0
            ? haversineKm(drops[i - 1].latitude, drops[i - 1].longitude, drop.latitude, drop.longitude)
            : null

          return (
            <div key={drop.id} style={{ position: 'relative', paddingBottom: i < drops.length - 1 ? 20 : 0 }}>
              {/* Dot */}
              <div style={{
                position: 'absolute', left: -24, top: 2,
                width: 12, height: 12, borderRadius: '50%',
                background: STATUS_COLORS[drop.status] || theme.textSubtle,
                border: `2px solid ${theme.bg}`,
              }} />

              {/* Distance from previous */}
              {distFromPrev != null && distFromPrev > 0 && (
                <div style={{ fontSize: 10, color: theme.textSubtle, marginBottom: 4, fontStyle: 'italic' }}>
                  ↳ {formatDistance(distFromPrev)} from previous
                </div>
              )}

              <div style={{
                background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10,
                padding: '10px 14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
                    📍 {drop.location_name}
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                    background: `${STATUS_COLORS[drop.status]}18`,
                    color: STATUS_COLORS[drop.status],
                  }}>
                    {STATUS_LABELS[drop.status]}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 4 }}>
                  Freed by {drop.profiles?.username || 'unknown'} · {timeAgo(drop.created_at)}
                </div>
                {drop.claimer?.username && (
                  <div style={{ fontSize: 12, color: theme.gold, marginTop: 2 }}>
                    Claimed by {drop.claimer.username}
                  </div>
                )}
                {drop.note && (
                  <div style={{ fontSize: 12, color: theme.textSubtle, marginTop: 4, fontStyle: 'italic' }}>
                    "{drop.note}"
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
