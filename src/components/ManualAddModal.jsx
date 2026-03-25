import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'

const FORMATS  = ['Hardcover', 'Paperback', 'Mass Market Paperback', 'eBook', 'Audiobook', 'Other']
const GENRES   = ['Fiction', 'Non-Fiction', 'Mystery', 'Thriller', 'Science Fiction', 'Fantasy', 'Romance', 'Historical Fiction', 'Horror', 'Biography', 'Memoir', 'Self-Help', 'Business', 'Science', 'History', 'Travel', 'Cooking', 'Art', 'Poetry', 'Graphic Novel', 'Children\'s', 'Young Adult', 'Other']
const STATUSES = [
  { value: 'owned',   label: 'In My Library' },
  { value: 'read',    label: 'Read' },
  { value: 'reading', label: 'Currently Reading' },
  { value: 'want',    label: 'Want to Read' },
]

export default function ManualAddModal({ session, onClose, onAdded = () => {} }) {
  const { theme } = useTheme()
  const fileRef = useRef(null)

  // Cover
  const [coverFile,    setCoverFile]    = useState(null)
  const [coverPreview, setCoverPreview] = useState(null)

  // Basic
  const [title,  setTitle]  = useState('')
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')

  // Identifiers
  const [isbn13, setIsbn13] = useState('')
  const [isbn10, setIsbn10] = useState('')

  // Publishing
  const [publisher, setPublisher] = useState('')
  const [year,      setYear]      = useState('')
  const [pages,     setPages]     = useState('')
  const [format,    setFormat]    = useState('')
  const [language,  setLanguage]  = useState('English')
  const [genre,     setGenre]     = useState('')

  // Series
  const [seriesName,   setSeriesName]   = useState('')
  const [seriesNumber, setSeriesNumber] = useState('')

  // My copy
  const [status, setStatus] = useState('owned')

  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  function pickCover(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  function validate() {
    const e = {}
    if (!title.trim())  e.title  = 'Title is required'
    if (!author.trim()) e.author = 'Author is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    setSaving(true)

    // 1. Upload cover if provided
    let coverUrl = null
    if (coverFile) {
      const ext  = coverFile.name.split('.').pop()
      const path = `manual/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('covers')
        .upload(path, coverFile, { upsert: false, contentType: coverFile.type })
      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage.from('covers').getPublicUrl(path)
        coverUrl = publicUrl
      }
    }

    // 2. Check for existing book (by ISBN or title+author)
    let bookId = null

    if (isbn13.trim()) {
      const { data } = await supabase.from('books').select('id').eq('isbn_13', isbn13.trim()).maybeSingle()
      if (data) bookId = data.id
    }
    if (!bookId && isbn10.trim()) {
      const { data } = await supabase.from('books').select('id').eq('isbn_10', isbn10.trim()).maybeSingle()
      if (data) bookId = data.id
    }
    if (!bookId) {
      const { data } = await supabase.from('books').select('id')
        .eq('title', title.trim()).eq('author', author.trim()).maybeSingle()
      if (data) bookId = data.id
    }

    // 3. Insert or update book
    const bookData = {
      title:           title.trim(),
      author:          author.trim(),
      isbn_13:         isbn13.trim()  || null,
      isbn_10:         isbn10.trim()  || null,
      cover_image_url: coverUrl       || null,
      published_year:  year ? parseInt(year) : null,
      genre:           genre          || null,
      description:     description.trim() || null,
      publisher:       publisher.trim() || null,
      pages:           pages ? parseInt(pages) : null,
      format:          format         || null,
      language:        language.trim() || null,
      series_name:     seriesName.trim()   || null,
      series_number:   seriesNumber.trim() || null,
    }

    if (bookId) {
      // Update cover if we just uploaded one
      if (coverUrl) {
        await supabase.from('books').update({ cover_image_url: coverUrl }).eq('id', bookId)
      }
    } else {
      const { data: newBook, error } = await supabase.from('books').insert(bookData).select().single()
      if (error || !newBook) {
        console.error('Book insert failed:', error)
        setSaving(false)
        return
      }
      bookId = newBook.id
    }

    // 4. Add to collection
    await supabase.from('collection_entries').upsert(
      { user_id: session.user.id, book_id: bookId, read_status: status },
      { onConflict: 'user_id,book_id' }
    )

    window.dispatchEvent(new CustomEvent('folio:bookAdded'))
    setSaving(false)
    onAdded()
  }

  const s = makeStyles(theme)

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={s.header}>
          <div style={s.headerTitle}>Add Book Manually</div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>

          {/* ── LEFT: Cover ── */}
          <div style={s.coverCol}>
            <div style={s.coverLabel}>Cover Photo</div>
            <div
              style={{ ...s.coverBox, ...(coverPreview ? {} : s.coverBoxEmpty) }}
              onClick={() => fileRef.current?.click()}
            >
              {coverPreview
                ? <img src={coverPreview} alt="Cover" style={s.coverImg} />
                : (
                  <div style={s.coverPlaceholder}>
                    <div style={s.coverIcon}>📷</div>
                    <div style={s.coverHint}>Click to upload</div>
                    <div style={s.coverHint2}>JPG, PNG, WEBP</div>
                  </div>
                )
              }
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickCover} />
            {coverPreview && (
              <button style={s.clearCover} onClick={() => { setCoverFile(null); setCoverPreview(null) }}>
                Remove photo
              </button>
            )}

            {/* Status */}
            <div style={{ marginTop: 20 }}>
              <div style={s.fieldLabel}>Add to collection as</div>
              <div style={s.statusGrid}>
                {STATUSES.map(st => (
                  <button
                    key={st.value}
                    style={{ ...s.statusBtn, ...(status === st.value ? s.statusBtnActive : {}) }}
                    onClick={() => setStatus(st.value)}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT: Form fields ── */}
          <div style={s.formCol}>

            {/* Basic */}
            <div style={s.formSection}>
              <div style={s.sectionLabel}>Basic Info</div>
              <Field label="Title" required error={errors.title} theme={theme}>
                <input style={s.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Book title" />
              </Field>
              <Field label="Author" required error={errors.author} theme={theme}>
                <input style={s.input} value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author name" />
              </Field>
              <Field label="Description / Synopsis" theme={theme}>
                <textarea style={{ ...s.input, ...s.textarea }} value={description} onChange={e => setDescription(e.target.value)} placeholder="What's the book about?" rows={4} />
              </Field>
            </div>

            {/* Publishing */}
            <div style={s.formSection}>
              <div style={s.sectionLabel}>Publishing</div>
              <div style={s.row2}>
                <Field label="Publisher" theme={theme}>
                  <input style={s.input} value={publisher} onChange={e => setPublisher(e.target.value)} placeholder="Publisher name" />
                </Field>
                <Field label="Year Published" theme={theme}>
                  <input style={s.input} type="number" value={year} onChange={e => setYear(e.target.value)} placeholder="e.g. 2023" min="1000" max="2099" />
                </Field>
              </div>
              <div style={s.row3}>
                <Field label="Format" theme={theme}>
                  <select style={s.input} value={format} onChange={e => setFormat(e.target.value)}>
                    <option value="">— select —</option>
                    {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="Pages" theme={theme}>
                  <input style={s.input} type="number" value={pages} onChange={e => setPages(e.target.value)} placeholder="e.g. 320" min="1" />
                </Field>
                <Field label="Language" theme={theme}>
                  <input style={s.input} value={language} onChange={e => setLanguage(e.target.value)} placeholder="English" />
                </Field>
              </div>
              <Field label="Genre" theme={theme}>
                <select style={s.input} value={genre} onChange={e => setGenre(e.target.value)}>
                  <option value="">— select genre —</option>
                  {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
            </div>

            {/* Identifiers */}
            <div style={s.formSection}>
              <div style={s.sectionLabel}>Identifiers</div>
              <div style={s.row2}>
                <Field label="ISBN-13" theme={theme}>
                  <input style={s.input} value={isbn13} onChange={e => setIsbn13(e.target.value)} placeholder="978-X-XXX-XXXXX-X" maxLength={17} />
                </Field>
                <Field label="ISBN-10" theme={theme}>
                  <input style={s.input} value={isbn10} onChange={e => setIsbn10(e.target.value)} placeholder="X-XXX-XXXXX-X" maxLength={13} />
                </Field>
              </div>
            </div>

            {/* Series */}
            <div style={s.formSection}>
              <div style={s.sectionLabel}>Series</div>
              <div style={s.row2}>
                <Field label="Series Name" theme={theme}>
                  <input style={s.input} value={seriesName} onChange={e => setSeriesName(e.target.value)} placeholder="e.g. Harry Potter" />
                </Field>
                <Field label="Volume / #" theme={theme}>
                  <input style={s.input} value={seriesNumber} onChange={e => setSeriesNumber(e.target.value)} placeholder="e.g. 1" />
                </Field>
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          <button style={s.btnSave} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add to My Library'}
          </button>
        </div>

      </div>
    </div>
  )
}

function Field({ label, required, error, theme, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}{required && <span style={{ color: theme.rust }}> *</span>}
      </label>
      {children}
      {error && <div style={{ fontSize: 11, color: theme.rust, marginTop: 4 }}>{error}</div>}
    </div>
  )
}

function makeStyles(theme) {
  return {
    overlay:  { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.55)', zIndex: 1010, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
    modal:    { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 18, width: '100%', maxWidth: 820, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: theme.shadow },

    header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: `1px solid ${theme.borderLight}`, flexShrink: 0 },
    headerTitle: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: theme.text },
    closeBtn:    { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4 },

    body:    { display: 'flex', gap: 28, padding: '24px', overflowY: 'auto', flex: 1 },

    // Cover column
    coverCol:       { width: 168, flexShrink: 0, display: 'flex', flexDirection: 'column' },
    coverLabel:     { fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    coverBox:       { width: '100%', aspectRatio: '2/3', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', position: 'relative' },
    coverBoxEmpty:  { border: `2px dashed ${theme.border}`, background: theme.bgSubtle, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    coverImg:       { width: '100%', height: '100%', objectFit: 'cover' },
    coverPlaceholder: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 12 },
    coverIcon:      { fontSize: 28, color: theme.textSubtle },
    coverHint:      { fontSize: 12, color: theme.textSubtle, textAlign: 'center', fontWeight: 500 },
    coverHint2:     { fontSize: 10, color: theme.textSubtle, textAlign: 'center' },
    clearCover:     { marginTop: 8, fontSize: 11, color: theme.textSubtle, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' },

    statusGrid:    { display: 'flex', flexDirection: 'column', gap: 6 },
    statusBtn:     { width: '100%', padding: '7px 10px', fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 7, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", background: 'transparent', color: theme.textMuted, textAlign: 'left' },
    statusBtnActive: { background: 'rgba(192,82,30,0.1)', borderColor: theme.rust, color: theme.rust, fontWeight: 600 },

    // Form column
    formCol:     { flex: 1, minWidth: 0 },
    formSection: { marginBottom: 20, paddingBottom: 20, borderBottom: `1px solid ${theme.borderLight}` },
    sectionLabel:{ fontSize: 11, fontWeight: 700, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
    row2:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    row3:        { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },

    fieldLabel:  { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4 },
    input:       { width: '100%', padding: '8px 11px', border: `1px solid ${theme.border}`, borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgSubtle, color: theme.text, boxSizing: 'border-box' },
    textarea:    { resize: 'vertical', minHeight: 80, lineHeight: 1.5 },

    footer:    { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${theme.borderLight}`, flexShrink: 0 },
    btnGhost:  { padding: '8px 16px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textMuted },
    btnSave:   { padding: '8px 20px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  }
}
