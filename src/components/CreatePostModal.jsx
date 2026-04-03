import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'

export default function CreatePostModal({ session, onClose, onPosted, books = [] }) {
  const { theme, isDark } = useTheme()
  const [content, setContent]               = useState('')
  const [selectedBook, setSelectedBook]     = useState(null)
  const [bookSearch, setBookSearch]         = useState('')
  const [showBookPicker, setShowBookPicker] = useState(false)
  const [imageFile, setImageFile]           = useState(null)
  const [imagePreview, setImagePreview]     = useState(null)
  const [posting, setPosting]               = useState(false)
  const [postError, setPostError]           = useState('')
  const fileInputRef    = useRef(null)
  const bookPickerRef   = useRef(null)

  const bg     = isDark ? '#1c1610' : '#fdfaf4'
  const card   = isDark ? '#2a2218' : '#ffffff'
  const border = isDark ? '#3a3028' : '#e8dfc8'
  const text   = isDark ? '#f0e8d8' : '#1a1208'
  const muted  = isDark ? '#9a8f82' : '#8a7f72'
  const accent = '#c0521e'

  // Close the book picker on outside click
  useEffect(() => {
    if (!showBookPicker) return
    function handleClickOutside(e) {
      if (bookPickerRef.current && !bookPickerRef.current.contains(e.target)) {
        setShowBookPicker(false)
        setBookSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showBookPicker])

  const filteredBooks = books
    .filter(b => !bookSearch || b.title?.toLowerCase().includes(bookSearch.toLowerCase()) || b.author?.toLowerCase().includes(bookSearch.toLowerCase()))
    .slice(0, 8)

  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = ev => setImagePreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  function removeImage() {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canPost = !posting && (content.trim().length > 0 || imageFile !== null)

  async function handlePost() {
    if (!canPost) return
    setPosting(true)
    setPostError('')

    let imageUrl = null
    if (imageFile) {
      try {
        const ext  = imageFile.name.split('.').pop() || 'jpg'
        const path = `${session.user.id}/${Date.now()}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('post-images')
          .upload(path, imageFile, { contentType: imageFile.type, upsert: true })
        if (!uploadErr) {
          const { data } = supabase.storage.from('post-images').getPublicUrl(path)
          imageUrl = data.publicUrl
        }
      } catch { /* continue without image */ }
    }

    // Simple insert — no complex join that could silently fail
    const { data: inserted, error } = await supabase
      .from('reading_posts')
      .insert({
        user_id:   session.user.id,
        book_id:   selectedBook?.id || null,
        content:   content.trim() || null,
        image_url: imageUrl,
      })
      .select('id, created_at')
      .single()

    setPosting(false)

    if (error) {
      setPostError('Something went wrong — please try again.')
      return
    }

    // Build the post shape that PostCard expects, without needing a round-trip join
    const newPost = {
      id:           inserted.id,
      user_id:      session.user.id,
      created_at:   inserted.created_at,
      content:      content.trim() || null,
      image_url:    imageUrl,
      profiles:     null,          // Feed will show avatar from userId match
      books:        selectedBook   // already has { id, title, author, cover_image_url, … }
                      ? { id: selectedBook.id, title: selectedBook.title, author: selectedBook.author, cover_image_url: selectedBook.cover_image_url || null, isbn_13: selectedBook.isbn_13 || null, isbn_10: selectedBook.isbn_10 || null }
                      : null,
      post_likes:   [],
      post_comments:[],
    }

    onPosted?.(newPost)
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* ── Modal box — NO overflow:hidden so the book picker dropdown can escape ── */}
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 20, width: '100%', maxWidth: 520, boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}>

        {/* ── Header ── */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '20px 20px 0 0', background: bg }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: text }}>
            Share a Reading Update
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 22, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* ── Text body ── */}
        <div style={{ padding: '16px 20px 0' }}>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="What are you reading? Share your thoughts, a favourite quote, or how it made you feel…"
            rows={4}
            autoFocus
            style={{ width: '100%', padding: '10px 0', border: 'none', borderBottom: `1px solid ${border}`, fontSize: 15, fontFamily: "'DM Sans', sans-serif", resize: 'none', outline: 'none', background: 'transparent', color: text, lineHeight: 1.65, boxSizing: 'border-box' }}
          />
        </div>

        {/* ── Tagged book ── */}
        {selectedBook ? (
          <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 48, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: border }}>
              {(() => {
                const url = getCoverUrl(selectedBook)
                return url
                  ? <img src={url} alt={selectedBook.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📖</div>
              })()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: text }}>{selectedBook.title}</div>
              {selectedBook.author && <div style={{ fontSize: 12, color: muted }}>{selectedBook.author}</div>}
            </div>
            <button onClick={() => setSelectedBook(null)}
              style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer', color: muted, padding: '3px 8px', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
              Remove
            </button>
          </div>
        ) : showBookPicker ? (
          /* Book search — rendered ABOVE image so dropdown opens downward into visible space */
          <div ref={bookPickerRef} style={{ padding: '12px 20px 0' }}>
            <div style={{ position: 'relative' }}>
              <input
                value={bookSearch}
                onChange={e => setBookSearch(e.target.value)}
                placeholder="Search your collection…"
                autoFocus
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: card, color: text, boxSizing: 'border-box' }}
              />
              {/* Dropdown — position:fixed so it's never clipped by any ancestor */}
              {filteredBooks.length > 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', background: bg, border: `1px solid ${border}`, borderRadius: 10, zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
                  {filteredBooks.map(b => (
                    <div key={b.id}
                      onMouseDown={e => {
                        // Use mousedown (fires before blur) so the click registers
                        e.preventDefault()
                        setSelectedBook(b)
                        setBookSearch('')
                        setShowBookPicker(false)
                      }}
                      style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, color: text, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span>📖</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 600 }}>{b.title}</span>
                        {b.author && <span style={{ color: muted }}> · {b.author}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* ── Image preview ── */}
        {imagePreview && (
          <div style={{ padding: '12px 20px 0', position: 'relative' }}>
            <img src={imagePreview} alt="preview" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 12, display: 'block' }} />
            <button onClick={removeImage}
              style={{ position: 'absolute', top: 20, right: 28, background: 'rgba(0,0,0,0.65)', border: 'none', borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* ── Error message ── */}
        {postError && (
          <div style={{ padding: '10px 20px 0', fontSize: 13, color: '#c0392b', fontFamily: "'DM Sans', sans-serif" }}>
            ⚠️ {postError}
          </div>
        )}

        {/* ── Footer toolbar ── */}
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${border}`, marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, borderRadius: '0 0 20px 20px', background: bg }}>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />

          <button onClick={() => fileInputRef.current?.click()}
            style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: imageFile ? accent : muted, display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'DM Sans', sans-serif", fontWeight: imageFile ? 600 : 400 }}>
            📷 Photo
          </button>

          {!selectedBook && (
            <button onClick={() => setShowBookPicker(v => !v)}
              style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: showBookPicker ? accent : muted, display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'DM Sans', sans-serif", fontWeight: showBookPicker ? 600 : 400 }}>
              📖 Tag Book
            </button>
          )}

          <div style={{ flex: 1 }} />

          <button
            onClick={handlePost}
            disabled={!canPost}
            style={{ padding: '8px 22px', background: canPost ? accent : (isDark ? '#3a3028' : '#e8dfc8'), color: canPost ? 'white' : muted, border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: canPost ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.2s' }}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
