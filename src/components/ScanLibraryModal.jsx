import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'

export default function ScanLibraryModal({ session, library, onClose, onSuccess }) {
  const { theme } = useTheme()
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [note, setNote] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setScanResult(null)
    setError(null)
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  // Resize image to keep base64 under edge function limits
  function resizeImage(file, maxDim = 800) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
        resolve(dataUrl.split(',')[1])
      }
      img.src = URL.createObjectURL(file)
    })
  }

  async function handleScan() {
    if (!photoFile) {
      setError('Please choose a photo first')
      return
    }
    setScanning(true)
    setError(null)

    try {
      const base64 = await resizeImage(photoFile)
      const { data, error: fnErr } = await supabase.functions.invoke('scan-little-library', {
        body: { imageBase64: base64, mimeType: 'image/jpeg' },
      })

      if (fnErr || data?.error) {
        setError(data?.error || fnErr?.message || 'Could not scan books')
      } else {
        setScanResult(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  async function handleSave() {
    if (!scanResult) return
    setSaving(true)
    setError(null)

    let photoUrl = null
    if (photoFile) {
      const ext = photoFile.name.split('.').pop()
      const path = `${session.user.id}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('library-photos')
        .upload(path, photoFile, { contentType: photoFile.type, upsert: true })
      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage.from('library-photos').getPublicUrl(path)
        photoUrl = publicUrl
      }
    }

    const { error: insertErr } = await supabase.from('little_library_scans').insert({
      library_id: library.id,
      user_id: session.user.id,
      photo_url: photoUrl,
      books_found: scanResult.books || [],
      note: note.trim() || null,
    })

    if (insertErr) {
      setError(insertErr.message)
      setSaving(false)
      return
    }

    setSaving(false)
    onSuccess?.()
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 16,
        width: 500, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
        padding: '24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 }}>
            📷 Scan Library Contents
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle }}>✕</button>
        </div>

        <div style={{ fontSize: 13, color: theme.textSubtle, marginBottom: 16 }}>
          Take a photo of the books inside <strong style={{ color: theme.text }}>{library.name || library.location_name}</strong> and AI will identify them.
        </div>

        {/* Photo upload */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{
              padding: '8px 16px', background: theme.bgCard, border: `1px solid ${theme.border}`,
              borderRadius: 8, fontSize: 13, cursor: 'pointer', color: theme.text,
              fontFamily: "'DM Sans', sans-serif",
            }}>
              📷 {photoPreview ? 'Change Photo' : 'Choose Photo'}
              <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
            </label>
            {photoPreview && !scanResult && (
              <button
                onClick={handleScan}
                disabled={scanning}
                style={{
                  padding: '8px 16px', background: '#2a9d8f', color: 'white',
                  border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: scanning ? 'default' : 'pointer', opacity: scanning ? 0.6 : 1,
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {scanning ? '🔍 Scanning...' : '🔍 Identify Books'}
              </button>
            )}
          </div>
        </div>

        {/* Photo preview */}
        {photoPreview && (
          <div style={{ marginBottom: 16 }}>
            <img src={photoPreview} alt="Library contents" style={{
              width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 8,
            }} />
          </div>
        )}

        {/* Scan results */}
        {scanResult && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: theme.text, marginBottom: 8, fontSize: 14 }}>
              ✅ Found {scanResult.books?.length || 0} identifiable books ({scanResult.total_visible || '?'} visible total)
            </div>
            {scanResult.books?.length > 0 && (
              <div style={{
                background: theme.bgSubtle || theme.bgCard, borderRadius: 8, padding: 12,
                maxHeight: 200, overflow: 'auto',
              }}>
                {scanResult.books.map((b, i) => (
                  <div key={i} style={{ fontSize: 13, color: theme.text, marginBottom: 4 }}>
                    <strong>{b.title}</strong>
                    {b.author && <span style={{ color: theme.textSubtle }}> by {b.author}</span>}
                  </div>
                ))}
              </div>
            )}
            {scanResult.notes && (
              <div style={{ fontSize: 12, color: theme.textSubtle, fontStyle: 'italic', marginTop: 8 }}>
                {scanResult.notes}
              </div>
            )}
          </div>
        )}

        {/* Note */}
        {scanResult && (
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note about the library (e.g. 'Well-stocked today!')"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', marginBottom: 16 }}
          />
        )}

        {error && (
          <div style={{ fontSize: 12, color: '#d32f2f', marginBottom: 12 }}>{error}</div>
        )}

        {/* Save button */}
        {scanResult && (
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: '100%', padding: '10px', background: '#2a9d8f', color: 'white',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {saving ? 'Saving...' : 'Save Inventory Update'}
          </button>
        )}
      </div>
    </div>
  )
}
