import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const STATUS_LABELS = {
  owned:   'In Library',
  read:    'Read',
  reading: 'Reading',
  want:    'Want to Read',
}

const STATUS_COLORS = {
  owned:   { bg: 'rgba(138,127,114,0.15)', color: '#8a7f72' },
  read:    { bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
  reading: { bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  want:    { bg: 'rgba(184,134,11,0.12)',  color: '#b8860b' },
}

async function fetchDescriptionFromOL(book) {
  try {
    if (book.isbn_13 || book.isbn_10) {
      const isbn = book.isbn_13 || book.isbn_10
      const res  = await fetch(`https://openlibrary.org/isbn/${isbn}.json`)
      if (res.ok) {
        const data = await res.json()
        const workKey = data.works?.[0]?.key
        if (workKey) {
          const workRes  = await fetch(`https://openlibrary.org${workKey}.json`)
          if (workRes.ok) {
            const workData = await workRes.json()
            const desc = workData.description
            if (desc) {
              const text = typeof desc === 'object' ? desc.value : desc
              if (isLikelyEnglish(text)) return text
            }
          }
        }
      }
    }
    const query = `${book.title} ${book.author || ''}`.trim()
    const searchRes = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key&limit=3`
    )
    if (!searchRes.ok) return null
    const searchData = await searchRes.json()
    for (const doc of searchData.docs || []) {
      const workRes  = await fetch(`https://openlibrary.org${doc.key}.json`)
      if (!workRes.ok) continue
      const workData = await workRes.json()
      const desc = workData.description
      if (desc) {
        const text = typeof desc === 'object' ? desc.value : desc
        if (text && isLikelyEnglish(text)) return text
      }
    }
    return null
  } catch {
    return null
  }
}

function isLikelyEnglish(text) {
  if (!text || text.length < 10) return false
  const nonLatin = (text.match(/[^\x00-\x7F]/g) || []).length
  return (nonLatin / text.length) < 0.2
}

export default function BookDetail({ bookId, session, onBack }) {
  const [book, setBook]                 = useState(null)
  const [entry, setEntry]               = useState(null)
  const [reviews, setReviews]           = useState([])
  const [communityRating, setCommunityRating] = useState(null)
  const [loading, setLoading]           = useState(true)
  const [fetchingDesc, setFetchingDesc] = useState(false)
  const [tab, setTab]                   = useState('about')
  const [rating, setRating]             = useState(0)
  const [hoverRating, setHoverRating]   = useState(0)
  const [reviewText, setReviewText]     = useState('')
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [listing, setListing]           = useState(null)
  const [showListingModal, setShowListingModal] = useState(false)

  useEffect(() => {
    fetchBook()
    fetchEntry()
    fetchReviews()
    fetchCommunityRating()
    fetchListing()
  }, [bookId])

  async function fetchBook() {
    const { data } = await supabase
      .from('books')
      .select('*')
      .eq('id', bookId)
      .single()
    if (data) {
      setBook(data)
      setLoading(false)
      if (!data.description) {
        setFetchingDesc(true)
        const desc = await fetchDescriptionFromOL(data)
        if (desc) {
          await supabase.from('books').update({ description: desc }).eq('id', data.id)
          setBook(prev => ({ ...prev, description: desc }))
        }
        setFetchingDesc(false)
      }
    } else {
      setLoading(false)
    }
  }

  async function fetchEntry() {
    const { data } = await supabase
      .from('collection_entries')
      .select('*')
      .eq('book_id', bookId)
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (data) {
      setEntry(data)
      setRating(data.user_rating || 0)
      setReviewText(data.review_text || '')
    }
  }

  async function fetchReviews() {
    const { data } = await supabase
      .from('collection_entries')
      .select(`
        id, user_rating, review_text, added_at,
        profiles ( username )
      `)
      .eq('book_id', bookId)
      .not('review_text', 'is', null)
      .order('added_at', { ascending: false })
    setReviews(data || [])
  }

  async function fetchCommunityRating() {
    const { data } = await supabase
      .from('book_ratings')
      .select('avg_rating, rating_count')
      .eq('book_id', bookId)
      .maybeSingle()
    if (data) setCommunityRating(data)
  }

  async function fetchListing() {
    const { data } = await supabase
      .from('listings')
      .select('id, price, condition')
      .eq('seller_id', session.user.id)
      .eq('book_id', bookId)
      .eq('status', 'active')
      .maybeSingle()
    setListing(data || null)
  }

  async function removeListing() {
    if (!listing) return
    await supabase.from('listings').update({ status: 'removed' }).eq('id', listing.id)
    setListing(null)
  }

  async function changeStatus(newStatus) {
    if (entry) {
      const { data } = await supabase
        .from('collection_entries')
        .update({ read_status: newStatus })
        .eq('id', entry.id)
        .select()
        .single()
      if (data) setEntry(data)
      else setEntry({ ...entry, read_status: newStatus })
    } else {
      const { data } = await supabase
        .from('collection_entries')
        .insert({ user_id: session.user.id, book_id: bookId, read_status: newStatus })
        .select()
        .single()
      if (data) {
        setEntry(data)
        setRating(0)
        setReviewText('')
      }
    }
  }

  async function removeFromLibrary() {
    if (!entry) return
    await supabase.from('collection_entries').delete().eq('id', entry.id)
    setEntry(null)
    onBack()
  }

  async function saveHeroRating(n) {
    if (!entry) return
    const newRating = n === rating ? 0 : n
    setRating(newRating)
    await supabase
      .from('collection_entries')
      .update({ user_rating: newRating > 0 ? newRating : null })
      .eq('id', entry.id)
      .eq('user_id', session.user.id)
    // Refresh community rating after user rates
    fetchCommunityRating()
  }

  async function saveReview() {
    if (!entry) return
    setSaving(true)
    setSaved(false)

    const { data, error } = await supabase
      .from('collection_entries')
      .update({
        user_rating:  rating > 0 ? rating : null,
        review_text:  reviewText.trim() || null,
      })
      .eq('id', entry.id)
      .eq('user_id', session.user.id)
      .select()

    setSaving(false)

    if (!error && data && data.length > 0) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      fetchReviews()
      fetchCommunityRating()
    }
  }

  if (loading || !book) {
    return (
      <div style={s.page}>
        <div style={s.topbar}>
          <button style={s.backBtn} onClick={onBack}>← Back to Library</button>
        </div>
        <div style={s.empty}>Loading…</div>
      </div>
    )
  }

  const status = entry?.read_status || null

  // Build a row of filled/half/empty stars for community rating display
  function CommunityStars({ avg }) {
    return (
      <span style={{ color: '#b8860b', fontSize: 14, letterSpacing: 1 }}>
        {[1,2,3,4,5].map(n => {
          if (avg >= n) return <span key={n}>★</span>
          if (avg >= n - 0.5) return <span key={n} style={{ opacity: 0.5 }}>★</span>
          return <span key={n} style={{ color: '#d4c9b0' }}>★</span>
        })}
      </span>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <button style={s.backBtn} onClick={onBack}>← Back to Library</button>
      </div>

      <div style={s.content}>
        {/* Hero */}
        <div style={s.hero}>
          <div style={s.coverWrap}>
            {book.cover_image_url
              ? <img src={book.cover_image_url} alt={book.title} style={s.coverImg} />
              : <FakeCover title={book.title} />
            }
          </div>

          <div style={s.heroInfo}>
            <div style={s.title}>{book.title}</div>
            <div style={s.author}>{book.author}</div>

            {/* Community rating */}
            {communityRating ? (
              <div style={s.communityRatingRow}>
                <CommunityStars avg={parseFloat(communityRating.avg_rating)} />
                <span style={s.communityRatingNum}>{communityRating.avg_rating}</span>
                <span style={s.communityRatingCount}>
                  · {communityRating.rating_count} {communityRating.rating_count === 1 ? 'rating' : 'ratings'} on Folio
                </span>
              </div>
            ) : (
              <div style={{ ...s.communityRatingRow, fontStyle: 'italic' }}>
                <span style={s.communityRatingCount}>No ratings yet — be the first!</span>
              </div>
            )}

            <div style={s.metaRow}>
              {book.published_year && <span style={s.metaPill}>{book.published_year}</span>}
              {book.genre && <span style={s.metaPill}>{book.genre}</span>}
              {book.isbn_13 && <span style={s.metaPill}>ISBN {book.isbn_13}</span>}
            </div>

            {/* Hero star rating — saves immediately on click */}
            <div style={{ marginTop: 16 }}>
              <div style={s.ratingLabel}>Your rating</div>
              <div style={s.stars}>
                {[1,2,3,4,5].map(n => (
                  <span
                    key={n}
                    style={{
                      ...s.star,
                      color: n <= (hoverRating || rating) ? '#b8860b' : '#d4c9b0',
                    }}
                    onClick={() => saveHeroRating(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                  >★</span>
                ))}
                {rating > 0 && (
                  <span style={s.ratingText}>{rating}/5 · saved</span>
                )}
                {!entry && (
                  <span style={{ ...s.ratingText, fontStyle: 'italic' }}>
                    Add to library to rate
                  </span>
                )}
              </div>
            </div>

            {/* Status buttons */}
            <div style={s.statusRow}>
              {Object.entries(STATUS_LABELS).map(([val, label]) => (
                <button
                  key={val}
                  style={{
                    ...s.statusBtn,
                    ...(status === val ? {
                      background: STATUS_COLORS[val].bg,
                      color: STATUS_COLORS[val].color,
                      borderColor: STATUS_COLORS[val].color,
                    } : {}),
                  }}
                  onClick={() => changeStatus(val)}
                >
                  {status === val ? '✓ ' : ''}{label}
                </button>
              ))}
              {entry && (
                <button style={s.removeBtn} onClick={removeFromLibrary}>Remove</button>
              )}
            </div>

            {/* For sale row */}
            {entry?.read_status === 'owned' && (
              <div style={s.forSaleRow}>
                {listing ? (
                  <>
                    <span style={s.forSaleTag}>
                      Listed for ${Number(listing.price).toFixed(2)}
                    </span>
                    <button style={s.removeListingBtn} onClick={removeListing}>
                      Remove listing
                    </button>
                  </>
                ) : (
                  <button style={s.listForSaleBtn} onClick={() => setShowListingModal(true)}>
                    List for Sale
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Listing modal */}
        {showListingModal && book && (
          <ListingModal
            session={session}
            book={book}
            onClose={() => setShowListingModal(false)}
            onSuccess={(newListing) => { setListing(newListing); setShowListingModal(false) }}
          />
        )}

        {/* Tabs */}
        <div style={s.tabs}>
          {['about', 'reviews', 'your review'].map(t => (
            <div
              key={t}
              style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'reviews' && reviews.length > 0 && (
                <span style={s.reviewCount}>{reviews.length}</span>
              )}
            </div>
          ))}
        </div>

        {/* About */}
        {tab === 'about' && (
          <div style={s.tabContent}>
            {fetchingDesc && !book.description && (
              <p style={s.descriptionMuted}>Fetching description…</p>
            )}
            {!fetchingDesc && !book.description && (
              <p style={s.descriptionMuted}>No description available for this book.</p>
            )}
            {book.description && (
              <p style={s.description}>{book.description}</p>
            )}
          </div>
        )}

        {/* Reviews */}
        {tab === 'reviews' && (
          <div style={s.tabContent}>
            {reviews.length === 0 ? (
              <div style={s.empty}>No reviews yet — be the first!</div>
            ) : (
              <div style={s.reviewList}>
                {reviews.map(r => (
                  <div key={r.id} style={s.reviewCard}>
                    <div style={s.reviewHeader}>
                      <div style={s.reviewAvatar}>
                        {r.profiles?.username?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <div style={s.reviewUsername}>{r.profiles?.username || 'Unknown'}</div>
                        <div style={s.reviewDate}>
                          {new Date(r.added_at).toLocaleDateString('en-US', {
                            month: 'long', day: 'numeric', year: 'numeric'
                          })}
                        </div>
                      </div>
                      {r.user_rating && (
                        <div style={s.reviewStars}>
                          {'★'.repeat(r.user_rating)}{'☆'.repeat(5 - r.user_rating)}
                        </div>
                      )}
                    </div>
                    <p style={s.reviewText}>{r.review_text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Your review */}
        {tab === 'your review' && (
          <div style={s.tabContent}>
            {!entry ? (
              <div style={s.empty}>
                Add this book to your library first to write a review.
              </div>
            ) : (
              <div style={{ maxWidth: 560, position: 'relative', zIndex: 10 }}>
                <div style={s.ratingLabel}>Your rating</div>
                <div style={{ ...s.stars, marginBottom: 20 }}>
                  {[1,2,3,4,5].map(n => (
                    <span
                      key={n}
                      style={{
                        ...s.star,
                        fontSize: 30,
                        color: n <= (hoverRating || rating) ? '#b8860b' : '#d4c9b0',
                      }}
                      onClick={() => saveHeroRating(n)}
                      onMouseEnter={() => setHoverRating(n)}
                      onMouseLeave={() => setHoverRating(0)}
                    >★</span>
                  ))}
                  {rating > 0 && (
                    <span style={{ ...s.ratingText, fontSize: 15 }}>{rating}/5</span>
                  )}
                </div>

                <div style={s.ratingLabel}>Your review</div>
                <textarea
                  style={s.textarea}
                  placeholder="What did you think? (optional)"
                  value={reviewText}
                  onChange={e => setReviewText(e.target.value)}
                  rows={5}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, position: 'relative', zIndex: 10 }}>
                  <button
                    style={{ ...s.saveBtn, opacity: saving ? 0.6 : 1 }}
                    onClick={saveReview}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save Review'}
                  </button>
                  {saved && (
                    <span style={{ fontSize: 13, color: '#5a7a5a', fontWeight: 500 }}>
                      ✓ Saved!
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- LISTING MODAL ----
const CONDITION_OPTIONS = [
  { value: 'like_new',   label: 'Like New' },
  { value: 'very_good',  label: 'Very Good' },
  { value: 'good',       label: 'Good' },
  { value: 'acceptable', label: 'Acceptable' },
  { value: 'poor',       label: 'Poor' },
]

function ListingModal({ session, book, onClose, onSuccess }) {
  const [price, setPrice]           = useState('')
  const [condition, setCondition]   = useState('good')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)

  async function submit() {
    const p = parseFloat(price)
    if (!price || isNaN(p) || p < 0) { setError('Please enter a valid price.'); return }
    setSubmitting(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('listings')
      .insert({
        seller_id:   session.user.id,
        book_id:     book.id,
        price:       p,
        condition,
        description: description.trim() || null,
        status:      'active',
      })
      .select('id, price, condition')
      .single()
    if (err) {
      setError('Could not create listing. Please try again.')
      setSubmitting(false)
    } else {
      onSuccess(data)
    }
  }

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '22px 24px 0' }}>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: '#1a1208' }}>List for Sale</div>
            <div style={{ fontSize: 13, color: '#8a7f72', marginTop: 3 }}>{book.title}</div>
          </div>
          <button style={s.modalCloseBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '20px 24px 24px' }}>
          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>Price (USD)</label>
            <div style={s.priceWrap}>
              <span style={s.priceDollar}>$</span>
              <input
                style={s.priceInput}
                type="number" min="0" step="0.01" placeholder="0.00"
                value={price} onChange={e => setPrice(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>Condition</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CONDITION_OPTIONS.map(opt => (
                <button key={opt.value}
                  style={{ padding: '6px 12px', fontSize: 12, borderRadius: 20, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                    background: condition === opt.value ? '#c0521e' : 'transparent',
                    color: condition === opt.value ? 'white' : '#3a3028',
                    border: condition === opt.value ? '1px solid #c0521e' : '1px solid #d4c9b0',
                  }}
                  onClick={() => setCondition(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div style={s.fieldGroup}>
            <label style={s.fieldLabel}>Condition Notes (optional)</label>
            <textarea
              style={s.modalTextarea}
              placeholder="Describe any wear, marks, or notable details…"
              value={description} onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error && <div style={{ color: '#c0521e', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.saveBtn} onClick={submit} disabled={submitting}>
              {submitting ? 'Listing…' : 'List for Sale'}
            </button>
            <button style={{ ...s.saveBtn, background: 'transparent', border: '1px solid #d4c9b0', color: '#1a1208' }} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- FAKE COVER ----
function FakeCover({ title }) {
  const colors = ['#7b4f3a','#4a6b8a','#5a7a5a','#2c3e50','#8b2500','#b8860b','#3d5a5a','#c0521e']
  const color  = colors[title.charCodeAt(0) % colors.length]
  const color2 = colors[(title.charCodeAt(0) + 3) % colors.length]
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 8,
      background: `linear-gradient(135deg, ${color}, ${color2})`,
      display: 'flex', alignItems: 'flex-end',
      padding: '12px 12px 12px 18px',
      position: 'relative', overflow: 'hidden',
      boxShadow: '4px 6px 20px rgba(26,18,8,0.22)',
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 9, background: 'rgba(0,0,0,0.2)' }} />
      <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.5)', lineHeight: 1.3, position: 'relative', zIndex: 1 }}>{title}</span>
    </div>
  )
}

// ---- STYLES ----
const s = {
  page:                { minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif" },
  topbar:              { position: 'sticky', top: 0, zIndex: 10, background: 'rgba(245,240,232,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #d4c9b0', padding: '14px 32px' },
  backBtn:             { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: '#c0521e', fontFamily: "'DM Sans', sans-serif", padding: 0, fontWeight: 500 },
  content:             { padding: '32px 32px', maxWidth: 820, margin: '0 auto' },
  hero:                { display: 'flex', gap: 32, marginBottom: 36 },
  coverWrap:           { width: 160, height: 240, flexShrink: 0 },
  coverImg:            { width: 160, height: 240, objectFit: 'cover', borderRadius: 8, boxShadow: '4px 6px 20px rgba(26,18,8,0.22)' },
  heroInfo:            { flex: 1 },
  title:               { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 700, lineHeight: 1.2, color: '#1a1208' },
  author:              { fontSize: 16, color: '#8a7f72', marginTop: 6 },
  communityRatingRow:  { display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 },
  communityRatingNum:  { fontSize: 15, fontWeight: 700, color: '#1a1208' },
  communityRatingCount:{ fontSize: 13, color: '#8a7f72' },
  metaRow:             { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  metaPill:            { fontSize: 12, padding: '3px 10px', borderRadius: 20, background: '#e8dfc8', color: '#8a7f72' },
  ratingLabel:         { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8a7f72', marginBottom: 6 },
  stars:               { display: 'flex', alignItems: 'center', gap: 2 },
  star:                { fontSize: 22, cursor: 'pointer', transition: 'color 0.1s', userSelect: 'none' },
  ratingText:          { fontSize: 13, color: '#8a7f72', marginLeft: 8 },
  statusRow:           { display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' },
  statusBtn:           { padding: '7px 14px', borderRadius: 8, border: '1px solid #d4c9b0', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#1a1208', transition: 'all 0.15s' },
  removeBtn:           { padding: '7px 14px', borderRadius: 8, border: '1px solid #d4c9b0', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#c0521e' },
  tabs:                { display: 'flex', borderBottom: '1px solid #d4c9b0', marginBottom: 24 },
  tab:                 { padding: '10px 20px', fontSize: 14, cursor: 'pointer', color: '#8a7f72', borderBottom: '2px solid transparent', marginBottom: -1, transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6 },
  tabActive:           { color: '#c0521e', borderBottom: '2px solid #c0521e', fontWeight: 500 },
  reviewCount:         { fontSize: 11, background: '#e8dfc8', color: '#8a7f72', padding: '1px 6px', borderRadius: 20 },
  tabContent:          { maxWidth: 680, position: 'relative', zIndex: 1 },
  description:         { fontSize: 14, lineHeight: 1.9, color: '#1a1208' },
  descriptionMuted:    { fontSize: 14, color: '#8a7f72', fontStyle: 'italic' },
  empty:               { color: '#8a7f72', fontSize: 14, padding: '32px 0' },
  reviewList:          { display: 'flex', flexDirection: 'column', gap: 20 },
  reviewCard:          { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 12, padding: '16px 20px' },
  reviewHeader:        { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  reviewAvatar:        { width: 32, height: 32, borderRadius: '50%', background: '#c0521e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500, color: 'white', flexShrink: 0 },
  reviewUsername:      { fontSize: 14, fontWeight: 500, color: '#1a1208' },
  reviewDate:          { fontSize: 12, color: '#8a7f72', marginTop: 1 },
  reviewStars:         { marginLeft: 'auto', color: '#b8860b', fontSize: 13 },
  reviewText:          { fontSize: 14, lineHeight: 1.7, color: '#1a1208', margin: 0 },
  textarea:            { width: '100%', padding: '10px 14px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: 'white', color: '#1a1208', lineHeight: 1.6 },
  saveBtn:             { padding: '8px 20px', background: '#c0521e', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

  forSaleRow:      { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 },
  listForSaleBtn:  { padding: '7px 16px', background: 'transparent', border: '1px solid #5a7a5a', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#5a7a5a' },
  forSaleTag:      { fontSize: 13, fontWeight: 600, color: '#5a7a5a', background: 'rgba(90,122,90,0.1)', padding: '4px 12px', borderRadius: 20 },
  removeListingBtn:{ padding: '4px 10px', background: 'transparent', border: '1px solid #d4c9b0', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#8a7f72' },
  modalOverlay:    { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modalBox:        { background: '#fdfaf4', border: '1px solid #d4c9b0', borderRadius: 16, width: 420, maxWidth: '92vw' },
  modalCloseBtn:   { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#8a7f72', padding: 4, flexShrink: 0 },
  fieldGroup:      { marginBottom: 18 },
  fieldLabel:      { display: 'block', fontSize: 11, fontWeight: 600, color: '#3a3028', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  priceWrap:       { display: 'flex', alignItems: 'center', border: '1px solid #d4c9b0', borderRadius: 8, overflow: 'hidden', background: 'white', width: 140 },
  priceDollar:     { padding: '9px 10px 9px 14px', fontSize: 15, color: '#8a7f72', background: '#f5f0e8', borderRight: '1px solid #d4c9b0' },
  priceInput:      { flex: 1, padding: '9px 12px', border: 'none', outline: 'none', fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: '#1a1208', background: 'white' },
  modalTextarea:   { width: '100%', padding: '10px 12px', border: '1px solid #d4c9b0', borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: 'white', color: '#1a1208', boxSizing: 'border-box' },
}