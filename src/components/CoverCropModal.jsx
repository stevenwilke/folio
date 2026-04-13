import { useState, useCallback } from 'react'
import Cropper from 'react-easy-crop'
import { useTheme } from '../contexts/ThemeContext'
import getCroppedImg from '../lib/cropImage'

export default function CoverCropModal({ imageSrc, onCrop, onCancel }) {
  const { theme } = useTheme()
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [saving, setSaving] = useState(false)

  const onCropComplete = useCallback((_area, areaPixels) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  async function handleSave() {
    if (!croppedAreaPixels) return
    setSaving(true)
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels)
      await onCrop(blob)
    } catch (err) {
      console.error('Crop failed:', err)
    }
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', flexDirection: 'column',
      backdropFilter: 'blur(6px)',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 18, fontWeight: 700, color: '#fff' }}>
          Crop Cover Image
        </div>
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Cropper area */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={2 / 3}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          cropShape="rect"
          showGrid={false}
          style={{
            containerStyle: { background: '#111' },
            cropAreaStyle: { border: '2px solid rgba(255,255,255,0.6)', borderRadius: 8 },
          }}
        />
      </div>

      {/* Controls */}
      <div style={{
        padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 14,
        borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.5)',
      }}>
        {/* Zoom slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, minWidth: 40 }}>Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            style={{ flex: 1, accentColor: theme.rust }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '9px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.3)',
              color: 'rgba(255,255,255,0.8)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '9px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", cursor: saving ? 'wait' : 'pointer',
              background: theme.sage, border: 'none', color: '#fff',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Cover'}
          </button>
        </div>
      </div>
    </div>
  )
}
