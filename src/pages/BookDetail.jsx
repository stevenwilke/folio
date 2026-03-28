import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'
import BookTagsManager from '../components/BookTagsManager'
import { useIsMobile } from '../hooks/useIsMobile'

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
  const { theme }  = useTheme()
  const isMobile   = useIsMobile()
  const navigate   = useNavigate()
  const [activeBookId, setActiveBookId] = useState(bookId)
  const [book, setBook]                 = useState(null)
  const [entry, setEntry]               = useState(null)
  const [reviews, setReviews]           = useState([])
  const [communityRating, setCommunityRating] = useState(null)
  const [loading, setLoading]           = useState(true)
  const [fetchingDesc, setFetchingDesc] = useState(false)
  const [coverImgError, setCoverImgError] = useState(false)
  const [tab, setTab]                   = useState('about')
  const [rating, setRating]             = useState(0)
  const [hoverRating, setHoverRating]   = useState(0)
  const [reviewText, setReviewText]     = useState('')
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [listing, setListing]           = useState(null)
  const [showListingModal, setShowListingModal] = useState(false)
  const [showLendModal,    setShowLendModal]    = useState(false)
  const [valuation, setValuation]       = useState(null)
  const [valuationLoading, setValuationLoading] = useState(true)
  const [friendStats, setFriendStats]   = useState(null)   // null = loading, [] = none
  const [currentPage, setCurrentPage]   = useState(0)
  const savePageTimer = useRef(null)
  const [removeConfirm, setRemoveConfirm] = useState(false)

  // Journal state
  const [journalEntries, setJournalEntries] = useState([])
  const [newJournalEntry, setNewJournalEntry] = useState('')
  const [savingJournal, setSavingJournal] = useState(false)

  // Series state
  const [seriesBooks, setSeriesBooks] = useState([])
  const [seriesOwned, setSeriesOwned] = useState({}) // book_id → read_status

  // When the prop bookId changes (parent navigates to a new book), sync activeBookId
  useEffect(() => { setActiveBookId(bookId) }, [bookId])

  useEffect(() => {
    // Reset all state for new book
    setBook(null)
    setEntry(null)
    setReviews([])
    setCommunityRating(null)
    setLoading(true)
    setTab('about')
    setRating(0)
    setHoverRating(0)
    setReviewText('')
    setSaved(false)
    setListing(null)
    setShowListingModal(false)
    setShowLendModal(false)
    setValuation(null)
    setValuationLoading(true)
    setFriendStats(null)
    setCurrentPage(0)
    setRemoveConfirm(false)
    setJournalEntries([])
    setNewJournalEntry('')
    setSeriesBooks([])
    setSeriesOwned({})
    setCoverImgError(false)

    fetchBook()
    fetchEntry()
    fetchReviews()
    fetchCommunityRating()
    fetchListing()
    fetchFriendStats()
  }, [activeBookId])

  // Listen for in-page series navigation
  useEffect(() => {
    function handleSeriesNav(e) {
      if (e.detail?.bookId) setActiveBookId(e.detail.bookId)
    }
    window.addEventListener('exlibris:navigateBook', handleSeriesNav)
    return () => window.removeEventListener('exlibris:navigateBook', handleSeriesNav)
  }, [])

  async function fetchFriendStats() {
    setFriendStats(null)
    const { data: fs } = await supabase
      .from('friendships').select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
    const friendIds = (fs || []).map(f => f.requester_id === session.user.id ? f.addressee_id : f.requester_id)
    if (!friendIds.length) { setFriendStats([]); return }
    const { data } = await supabase
      .from('collection_entries')
      .select('user_rating, read_status, profiles(username)')
      .eq('book_id', activeBookId)
      .in('user_id', friendIds)
    setFriendStats(data || [])
  }

  async function fetchBook() {
    const { data } = await supabase
      .from('books')
      .select('*')
      .eq('id', activeBookId)
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
      loadValuation(data)
      fetchJournal(data)
      if (data.series_name) fetchSeries(data)
    } else {
      setLoading(false)
    }
  }

  async function fetchJournal(bookData) {
    if (!session || !bookData) return
    const { data } = await supabase
      .from('journal_entries')
      .select('id, content, created_at')
      .eq('user_id', session.user.id)
      .eq('book_id', bookData.id)
      .order('created_at', { ascending: false })
    setJournalEntries(data || [])
  }

  async function saveJournalEntry() {
    if (!newJournalEntry.trim() || !book) return
    setSavingJournal(true)
    await supabase.from('journal_entries').insert({
      user_id: session.user.id,
      book_id: book.id,
      content: newJournalEntry.trim(),
    })
    setNewJournalEntry('')
    await fetchJournal(book)
    setSavingJournal(false)
  }

  async function deleteJournalEntry(id) {
    if (!window.confirm('Delete this journal entry? This cannot be undone.')) return
    await supabase.from('journal_entries').delete().eq('id', id).eq('user_id', session.user.id)
    setJournalEntries(prev => prev.filter(e => e.id !== id))
  }

  async function fetchSeries(bookData) {
    const { data: sb } = await supabase
      .from('books')
      .select('id, title, series_number, cover_image_url, isbn_13, isbn_10')
      .eq('series_name', bookData.series_name)
      .order('series_number', { ascending: true })
    if (!sb || sb.length === 0) return
    setSeriesBooks(sb)
    if (session) {
      const { data: owned } = await supabase
        .from('collection_entries')
        .select('book_id, read_status')
        .eq('user_id', session.user.id)
        .in('book_id', sb.map(b => b.id))
      const map = {}
      for (const row of owned || []) map[row.book_id] = row.read_status
      setSeriesOwned(map)
    }
  }

  async function fetchEntry() {
    const { data } = await supabase
      .from('collection_entries')
      .select('*')
      .eq('book_id', activeBookId)
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (data) {
      setEntry(data)
      setRating(data.user_rating || 0)
      setReviewText(data.review_text || '')
      setCurrentPage(data.current_page || 0)
    }
  }

  async function fetchReviews() {
    const { data } = await supabase
      .from('collection_entries')
      .select(`
        id, user_rating, review_text, added_at,
        profiles ( username )
      `)
      .eq('book_id', activeBookId)
      .not('review_text', 'is', null)
      .order('added_at', { ascending: false })
    setReviews(data || [])
  }

  async function fetchCommunityRating() {
    const { data } = await supabase
      .from('book_ratings')
      .select('avg_rating, rating_count')
      .eq('book_id', activeBookId)
      .maybeSingle()
    if (data) setCommunityRating(data)
  }

  async function loadValuation(bookData) {
    setValuationLoading(true)
    // Check cache first
    const { data: cached } = await supabase
      .from('valuations')
      .select('*')
      .eq('book_id', bookData.id)
      .maybeSingle()

    const cacheAge = cached
      ? (Date.now() - new Date(cached.fetched_at).getTime()) / (1000 * 60 * 60)
      : Infinity

    if (cached && cacheAge < 24) {
      // Use cache if at least one price field is present
      setValuation((cached.avg_price || cached.list_price) ? cached : false)
      setValuationLoading(false)
      return
    }

    // Fetch fresh from Edge Function
    try {
      const { data, error } = await supabase.functions.invoke('get-book-valuation', {
        body: {
          isbn:   bookData.isbn_13 || bookData.isbn_10 || null,
          title:  bookData.title,
          author: bookData.author,
        },
      })

      if (error || !data?.found) {
        // Cache the miss so we don't keep retrying
        await supabase.from('valuations').upsert(
          { book_id: bookData.id, avg_price: null, fetched_at: new Date().toISOString() },
          { onConflict: 'book_id' }
        )
        setValuation(false)
      } else {
        // NOTE: Run in Supabase if list_price column doesn't exist:
        // alter table valuations add column if not exists list_price numeric;
        // alter table valuations add column if not exists list_price_currency text;
        const row = {
          book_id:             bookData.id,
          avg_price:           data.avg_price    ?? null,
          min_price:           data.min_price    ?? null,
          max_price:           data.max_price    ?? null,
          sample_count:        data.sample_count ?? null,
          currency:            data.currency     || 'USD',
          list_price:          data.list_price          ?? null,
          list_price_currency: data.list_price_currency ?? null,
          fetched_at:          new Date().toISOString(),
        }
        await supabase.from('valuations').upsert(row, { onConflict: 'book_id' })
        setValuation(row)
      }
    } catch {
      setValuation(false)
    }
    setValuationLoading(false)
  }

  async function fetchListing() {
    const { data } = await supabase
      .from('listings')
      .select('id, price, condition')
      .eq('seller_id', session.user.id)
      .eq('book_id', activeBookId)
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
        .insert({ user_id: session.user.id, book_id: activeBookId, read_status: newStatus })
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
    if (!removeConfirm) {
      setRemoveConfirm(true)
      setTimeout(() => setRemoveConfirm(false), 3000)
      return
    }
    await supabase
      .from('collection_entries')
      .delete()
      .eq('id', entry.id)
      .eq('user_id', session.user.id)
    window.dispatchEvent(new CustomEvent('exlibris:bookRemoved'))
    window.location.href = '/'
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

  function saveProgress(page) {
    if (!entry) return
    const p = Math.max(0, parseInt(page) || 0)
    setCurrentPage(p)
    clearTimeout(savePageTimer.current)
    savePageTimer.current = setTimeout(async () => {
      await supabase
        .from('collection_entries')
        .update({ current_page: p > 0 ? p : null })
        .eq('id', entry.id)
        .eq('user_id', session.user.id)
    }, 600)
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

  const s = {
    page:                { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif" },
    topbar:              { position: 'sticky', top: 0, zIndex: 10, background: theme.bg, backdropFilter: 'blur(8px)', borderBottom: `1px solid ${theme.border}`, padding: isMobile ? '12px 16px' : '14px 32px' },
    backBtn:             { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: theme.rust, fontFamily: "'DM Sans', sans-serif", padding: 0, fontWeight: 500 },
    content:             { padding: isMobile ? '16px 16px 100px' : '32px 32px 60px', maxWidth: 820, margin: '0 auto' },
    hero:                { display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 32, marginBottom: isMobile ? 20 : 36, alignItems: isMobile ? 'center' : 'flex-start' },
    coverWrap:           { width: isMobile ? 140 : 160, height: isMobile ? 210 : 240, flexShrink: 0 },
    coverImg:            { width: isMobile ? 140 : 160, height: isMobile ? 210 : 240, objectFit: 'cover', borderRadius: 8, boxShadow: '4px 6px 20px rgba(26,18,8,0.22)' },
    heroInfo:            { flex: 1, width: isMobile ? '100%' : 'auto' },
    title:               { fontFamily: 'Georgia, serif', fontSize: isMobile ? 22 : 28, fontWeight: 700, lineHeight: 1.2, color: theme.text, textAlign: isMobile ? 'center' : 'left' },
    author:              { fontSize: isMobile ? 14 : 16, color: theme.textSubtle, marginTop: 6, textAlign: isMobile ? 'center' : 'left' },
    communityRatingRow:  { display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 },
    communityRatingNum:  { fontSize: 15, fontWeight: 700, color: theme.text },
    communityRatingCount:{ fontSize: 13, color: theme.textSubtle },
    metaRow:             { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
    metaPill:            { fontSize: 12, padding: '3px 10px', borderRadius: 20, background: theme.bgSubtle, color: theme.textSubtle },
    ratingLabel:         { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: theme.textSubtle, marginBottom: 6 },
    stars:               { display: 'flex', alignItems: 'center', gap: 2 },
    star:                { fontSize: 22, cursor: 'pointer', transition: 'color 0.1s', userSelect: 'none' },
    ratingText:          { fontSize: 13, color: theme.textSubtle, marginLeft: 8 },
    statusRow:           { display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' },
    statusBtn:           { padding: '7px 14px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.text, transition: 'all 0.15s' },
    removeBtn:           { padding: '7px 14px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.rust },
    removeFromCollectionBtn:        { padding: '6px 14px', borderRadius: 8, border: '1px solid #f5c6c6', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#c0392b', transition: 'all 0.15s' },
    removeFromCollectionBtnConfirm: { borderColor: '#c0392b', background: 'rgba(192,57,43,0.07)', fontWeight: 500 },
    tabs:                { display: 'flex', borderBottom: `1px solid ${theme.border}`, marginBottom: 24 },
    tab:                 { padding: '10px 20px', fontSize: 14, cursor: 'pointer', color: theme.textSubtle, borderBottom: '2px solid transparent', marginBottom: -1, transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6 },
    tabActive:           { color: theme.rust, borderBottom: `2px solid ${theme.rust}`, fontWeight: 500 },
    reviewCount:         { fontSize: 11, background: theme.bgSubtle, color: theme.textSubtle, padding: '1px 6px', borderRadius: 20 },
    tabContent:          { maxWidth: 680, position: 'relative', zIndex: 1 },
    description:         { fontSize: 14, lineHeight: 1.9, color: theme.text },
    descriptionMuted:    { fontSize: 14, color: theme.textSubtle, fontStyle: 'italic' },
    empty:               { color: theme.textSubtle, fontSize: 14, padding: '32px 0' },
    reviewList:          { display: 'flex', flexDirection: 'column', gap: 20 },
    reviewCard:          { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '16px 20px' },
    reviewHeader:        { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
    reviewAvatar:        { width: 32, height: 32, borderRadius: '50%', background: theme.rust, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500, color: 'white', flexShrink: 0 },
    reviewUsername:      { fontSize: 14, fontWeight: 500, color: theme.text },
    reviewDate:          { fontSize: 12, color: theme.textSubtle, marginTop: 1 },
    reviewStars:         { marginLeft: 'auto', color: theme.gold, fontSize: 13 },
    reviewText:          { fontSize: 14, lineHeight: 1.7, color: theme.text, margin: 0 },
    textarea:            { width: '100%', padding: '10px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: theme.bgCard, color: theme.text, lineHeight: 1.6 },
    saveBtn:             { padding: '8px 20px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

    valuationRow:        { display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 14, flexWrap: 'wrap' },
    valuationPrice:      { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.sage },
    valuationMarket:     { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: theme.rust },
    valuationSub:        { fontSize: 12, color: theme.textSubtle },
    valuationDivider:    { fontSize: 16, color: theme.textSubtle, margin: '0 4px' },
    valuationMuted:      { fontSize: 12, color: theme.textSubtle, fontStyle: 'italic' },

    forSaleRow:      { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 },
    listForSaleBtn:  { padding: '7px 16px', background: 'transparent', border: `1px solid ${theme.sage}`, borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.sage },
    lendOutBtn:      { padding: '7px 16px', background: 'transparent', border: `1px solid ${theme.gold}`, borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.gold },
    forSaleTag:      { fontSize: 13, fontWeight: 600, color: theme.sage, background: theme.sageLight, padding: '4px 12px', borderRadius: 20 },
    removeListingBtn:{ padding: '4px 10px', background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: theme.textSubtle },
    progressBarBg:   { flex: 1, height: 6, background: theme.bgSubtle, borderRadius: 3, overflow: 'hidden' },
    progressBarFill: { height: '100%', background: theme.rust, borderRadius: 3, transition: 'width 0.3s' },
    progressPct:     { fontSize: 13, fontWeight: 600, color: theme.rust, minWidth: 36 },
    pageInput:       { width: 72, padding: '5px 9px', border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: theme.bgCard, color: theme.text, textAlign: 'center' },
    modalOverlay:    { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modalBox:        { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 420, maxWidth: '92vw' },
    modalCloseBtn:   { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4, flexShrink: 0 },
    fieldGroup:      { marginBottom: 18 },
    fieldLabel:      { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    priceWrap:       { display: 'flex', alignItems: 'center', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', background: theme.bgCard, width: 140 },
    priceDollar:     { padding: '9px 10px 9px 14px', fontSize: 15, color: theme.textSubtle, background: theme.bg, borderRight: `1px solid ${theme.border}` },
    priceInput:      { flex: 1, padding: '9px 12px', border: 'none', outline: 'none', fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: theme.text, background: theme.bgCard },
    modalTextarea:   { width: '100%', padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },

    // Journal
    journalSection:  { marginTop: 32, background: theme.bgSubtle, borderRadius: '0 10px 10px 0', padding: '20px 20px 20px 20px', borderLeft: `3px solid ${theme.gold}` },
    journalHeader:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    journalTitle:    { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 17, fontWeight: 700, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 },
    journalPrivate:  { fontSize: 11, color: theme.textSubtle, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 20, padding: '2px 8px' },
    journalTextarea: { width: '100%', padding: '10px 14px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: theme.bgCard, color: theme.text, lineHeight: 1.6, boxSizing: 'border-box' },
    journalSaveBtn:  { marginTop: 8, padding: '7px 18px', background: theme.gold, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    journalEntry:    { marginTop: 16 },
    journalDateSep:  { fontSize: 11, color: theme.textSubtle, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 },
    journalDateLine: { flex: 1, height: 1, background: theme.border },
    journalText:     { fontSize: 14, lineHeight: 1.75, color: theme.text, margin: 0 },
    journalDeleteBtn:{ background: 'none', border: 'none', fontSize: 11, color: theme.textSubtle, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: '2px 6px', borderRadius: 4, float: 'right' },

    // Series
    seriesSection:   { background: theme.bgSubtle, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '18px 20px', marginBottom: 28 },
    seriesHeading:   { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 4 },
    seriesMeta:      { fontSize: 13, color: theme.textSubtle, marginBottom: 12 },
    seriesBarBg:     { height: 6, background: theme.bgCard, borderRadius: 3, overflow: 'hidden', marginBottom: 14 },
    seriesBarFill:   { height: '100%', background: theme.sage, borderRadius: 3, transition: 'width 0.3s' },
    seriesScroll:    { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 },
    seriesCoverWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, cursor: 'pointer' },
    seriesCoverImg:  { width: 60, height: 80, objectFit: 'cover', borderRadius: 5, boxShadow: '2px 3px 10px rgba(26,18,8,0.18)' },
    seriesCoverFake: { width: 60, height: 80, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'rgba(255,255,255,0.85)', padding: 4, textAlign: 'center', boxShadow: '2px 3px 10px rgba(26,18,8,0.18)' },
    seriesStatusIcon:{ fontSize: 14 },
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
      <span style={{ color: theme.gold, fontSize: 14, letterSpacing: 1 }}>
        {[1,2,3,4,5].map(n => {
          if (avg >= n) return <span key={n}>★</span>
          if (avg >= n - 0.5) return <span key={n} style={{ opacity: 0.5 }}>★</span>
          return <span key={n} style={{ color: theme.border }}>★</span>
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
            {(() => {
              const url = getCoverUrl(book)
              return (url && !coverImgError)
                ? <img src={url} alt={book.title} style={s.coverImg} onError={() => setCoverImgError(true)} />
                : <FakeCover title={book.title} />
            })()}
          </div>

          <div style={s.heroInfo}>
            <div style={s.title}>{book.title}</div>
            <div style={s.author}>
              {book.author
                ? <span
                    style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
                    onClick={() => navigate(`/author/${encodeURIComponent(book.author)}`)}
                    title={`See all books by ${book.author}`}
                    onMouseEnter={e => e.currentTarget.style.color = '#c0521e'}
                    onMouseLeave={e => e.currentTarget.style.color = 'inherit'}
                  >
                    {book.author}
                  </span>
                : null
              }
            </div>

            {/* Community rating */}
            {communityRating ? (
              <div style={s.communityRatingRow}>
                <CommunityStars avg={parseFloat(communityRating.avg_rating)} />
                <span style={s.communityRatingNum}>{communityRating.avg_rating}</span>
                <span style={s.communityRatingCount}>
                  · {communityRating.rating_count} {communityRating.rating_count === 1 ? 'rating' : 'ratings'} on Ex Libris
                </span>
              </div>
            ) : (
              <div style={{ ...s.communityRatingRow, fontStyle: 'italic' }}>
                <span style={s.communityRatingCount}>No ratings yet — be the first!</span>
              </div>
            )}

            {/* Friend stats */}
            <FriendStatsRow stats={friendStats} />

            <div style={s.metaRow}>
              {book.published_year && <span style={s.metaPill}>{book.published_year}</span>}
              {book.genre && <span style={s.metaPill}>{book.genre}</span>}
              {book.isbn_13 && <span style={s.metaPill}>ISBN {book.isbn_13}</span>}
            </div>

            {/* Valuation */}
            <div style={s.valuationRow}>
              {valuationLoading ? (
                <span style={s.valuationMuted}>Fetching prices…</span>
              ) : valuation ? (
                <>
                  {valuation.list_price != null && (
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={s.valuationPrice}>${Number(valuation.list_price).toFixed(2)}</span>
                      <span style={s.valuationSub}>
                        List price{valuation.list_price_currency ? ` (${valuation.list_price_currency})` : ''}
                      </span>
                    </span>
                  )}
                  {valuation.list_price != null && valuation.avg_price != null && (
                    <span style={s.valuationDivider}>·</span>
                  )}
                  {valuation.avg_price != null && (
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={s.valuationMarket}>~${Number(valuation.avg_price).toFixed(2)}</span>
                      <span style={s.valuationSub}>
                        avg of {valuation.sample_count} eBay sales (90 days)
                      </span>
                    </span>
                  )}
                </>
              ) : (
                <span style={s.valuationMuted}>No pricing data found</span>
              )}
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
                      color: n <= (hoverRating || rating) ? theme.gold : theme.border,
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
            </div>

            {/* Remove from collection */}
            {entry && (
              <div style={{ marginTop: 10 }}>
                <button
                  style={{
                    ...s.removeFromCollectionBtn,
                    ...(removeConfirm ? s.removeFromCollectionBtnConfirm : {}),
                  }}
                  onClick={removeFromLibrary}
                >
                  {removeConfirm ? 'Are you sure? Click to confirm' : 'Remove from collection'}
                </button>
              </div>
            )}

            {/* For sale / lend row */}
            {entry && (
              <div style={{ ...s.forSaleRow, flexWrap: 'wrap', gap: 8 }}>
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
                    🏷️ List for Sale
                  </button>
                )}
                <button style={s.lendOutBtn} onClick={() => setShowLendModal(true)}>
                  🤝 Lend Out
                </button>
              </div>
            )}

            {/* Reading progress */}
            {entry?.read_status === 'reading' && (
              <div style={{ marginTop: 16 }}>
                <div style={s.ratingLabel}>Reading Progress</div>
                {book.pages ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={s.progressBarBg}>
                      <div style={{
                        ...s.progressBarFill,
                        width: `${Math.min(100, Math.round((currentPage / book.pages) * 100))}%`
                      }} />
                    </div>
                    <span style={s.progressPct}>
                      {currentPage > 0
                        ? `${Math.min(100, Math.round((currentPage / book.pages) * 100))}%`
                        : '0%'}
                    </span>
                  </div>
                ) : null}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: book.pages ? 8 : 0 }}>
                  <input
                    type="number"
                    min="0"
                    max={book.pages || undefined}
                    value={currentPage || ''}
                    onChange={e => saveProgress(e.target.value)}
                    placeholder="Current page"
                    style={s.pageInput}
                  />
                  {book.pages
                    ? <span style={{ fontSize: 13, color: theme.textSubtle }}>of {book.pages} pages</span>
                    : <span style={{ fontSize: 13, color: theme.textSubtle }}>page</span>
                  }
                </div>
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

        {/* Lend out modal */}
        {showLendModal && book && (
          <LendOutModal
            session={session}
            book={book}
            theme={theme}
            onClose={() => setShowLendModal(false)}
          />
        )}

        {/* Series section — shown above tabs when series_name is set */}
        {book.series_name && seriesBooks.length > 0 && (() => {
          const total = seriesBooks.length
          const readCount = seriesBooks.filter(b => seriesOwned[b.id] === 'read').length
          const pct = total > 0 ? Math.round((readCount / total) * 100) : 0
          const currentIdx = seriesBooks.findIndex(b => b.id === book.id)
          const bookNum = book.series_number || (currentIdx >= 0 ? currentIdx + 1 : null)
          return (
            <div style={s.seriesSection}>
              <div style={s.seriesHeading}>
                {book.series_name} series
              </div>
              <div style={s.seriesMeta}>
                {bookNum && `Book ${bookNum} of ${total} · `}
                {readCount > 0
                  ? `You've read ${readCount} of ${total} (${pct}%)`
                  : `${total} book${total !== 1 ? 's' : ''} in series`}
              </div>
              {readCount > 0 && (
                <div style={s.seriesBarBg}>
                  <div style={{ ...s.seriesBarFill, width: `${pct}%` }} />
                </div>
              )}
              <div style={s.seriesScroll}>
                {seriesBooks.map(sb => {
                  const coverUrl = getCoverUrl(sb)
                  const ownedStatus = seriesOwned[sb.id]
                  const isCurrent = sb.id === book.id
                  let icon = '○'
                  let iconColor = '#8a7f72'
                  if (isCurrent) { icon = '●'; iconColor = '#c0521e' }
                  else if (ownedStatus === 'read') { icon = '✓'; iconColor = '#5a7a5a' }
                  else if (ownedStatus === 'reading') { icon = '📖'; iconColor = '#b8860b' }
                  return (
                    <div
                      key={sb.id}
                      style={{
                        ...s.seriesCoverWrap,
                        opacity: isCurrent ? 1 : 0.85,
                      }}
                      onClick={() => {
                        if (!isCurrent) {
                          window.dispatchEvent(new CustomEvent('exlibris:navigateBook', { detail: { bookId: sb.id } }))
                        }
                      }}
                      title={sb.title}
                    >
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt={sb.title}
                          style={{
                            ...s.seriesCoverImg,
                            outline: isCurrent ? `2px solid ${theme.rust}` : 'none',
                            outlineOffset: 2,
                          }}
                          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
                        />
                      ) : null}
                      <div style={{
                        ...s.seriesCoverFake,
                        background: `linear-gradient(135deg, #7b4f3a, #4a6b8a)`,
                        display: coverUrl ? 'none' : 'flex',
                        outline: isCurrent ? `2px solid ${theme.rust}` : 'none',
                        outlineOffset: 2,
                      }}>
                        {sb.title}
                      </div>
                      <span style={{ ...s.seriesStatusIcon, color: iconColor }}>{icon}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

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
                        color: n <= (hoverRating || rating) ? theme.gold : theme.border,
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
                    <span style={{ fontSize: 13, color: theme.sage, fontWeight: 500 }}>
                      ✓ Saved!
                    </span>
                  )}
                </div>

                {/* Reading Journal — shown in the review tab if book is in collection */}
                <div style={{ ...s.journalSection, marginTop: 36 }}>
                  <div style={s.journalHeader}>
                    <div style={s.journalTitle}>
                      Reading Journal
                    </div>
                    <span style={s.journalPrivate}>private</span>
                  </div>
                  <textarea
                    style={s.journalTextarea}
                    placeholder="Write a journal entry…"
                    value={newJournalEntry}
                    onChange={e => setNewJournalEntry(e.target.value)}
                    rows={4}
                  />
                  <button
                    style={{ ...s.journalSaveBtn, opacity: savingJournal || !newJournalEntry.trim() ? 0.6 : 1 }}
                    onClick={saveJournalEntry}
                    disabled={savingJournal || !newJournalEntry.trim()}
                  >
                    {savingJournal ? 'Saving…' : 'Save Entry'}
                  </button>

                  {journalEntries.map(je => (
                    <div key={je.id} style={s.journalEntry}>
                      <div style={s.journalDateSep}>
                        <span>
                          {new Date(je.created_at).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                        </span>
                        <div style={s.journalDateLine} />
                      </div>
                      <button
                        style={s.journalDeleteBtn}
                        onClick={() => deleteJournalEntry(je.id)}
                        title="Delete entry"
                      >
                        delete
                      </button>
                      <p style={s.journalText}>{je.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* My Tags */}
        {session && book?.id && (
          <div style={{ marginTop: 28, marginBottom: isMobile ? 40 : 0 }}>
            <BookTagsManager
              bookId={book.id}
              userId={session.user.id}
              theme={theme}
            />
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
  const { theme } = useTheme()
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

  const s = {
    modalOverlay:  { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modalBox:      { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 420, maxWidth: '92vw' },
    modalCloseBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: theme.textSubtle, padding: 4, flexShrink: 0 },
    fieldGroup:    { marginBottom: 18 },
    fieldLabel:    { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    priceWrap:     { display: 'flex', alignItems: 'center', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', background: theme.bgCard, width: 140 },
    priceDollar:   { padding: '9px 10px 9px 14px', fontSize: 15, color: theme.textSubtle, background: theme.bg, borderRight: `1px solid ${theme.border}` },
    priceInput:    { flex: 1, padding: '9px 12px', border: 'none', outline: 'none', fontSize: 15, fontFamily: "'DM Sans', sans-serif", color: theme.text, background: theme.bgCard },
    modalTextarea: { width: '100%', padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', background: theme.bgCard, color: theme.text, boxSizing: 'border-box' },
    saveBtn:       { padding: '8px 20px', background: theme.rust, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  }

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '22px 24px 0' }}>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text }}>List for Sale</div>
            <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 3 }}>{book.title}</div>
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
                    background: condition === opt.value ? theme.rust : 'transparent',
                    color: condition === opt.value ? 'white' : theme.textMuted,
                    border: condition === opt.value ? `1px solid ${theme.rust}` : `1px solid ${theme.border}`,
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
          {error && <div style={{ color: theme.rust, fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.saveBtn} onClick={submit} disabled={submitting}>
              {submitting ? 'Listing…' : 'List for Sale'}
            </button>
            <button style={{ ...s.saveBtn, background: 'transparent', border: `1px solid ${theme.border}`, color: theme.text }} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- LEND OUT MODAL ----
function LendOutModal({ session, book, theme, onClose }) {
  const [friends,       setFriends]       = useState([])
  const [friendId,      setFriendId]      = useState('')
  const [message,       setMessage]       = useState('')
  const [returnDate,    setReturnDate]    = useState('')
  const [submitting,    setSubmitting]    = useState(false)
  const [done,          setDone]          = useState(false)
  const [error,         setError]         = useState('')

  useEffect(() => {
    async function loadFriends() {
      const { data: fs } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id, profiles!friendships_requester_id_fkey(id,username), profiles!friendships_addressee_id_fkey(id,username)')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
      const list = (fs || []).map(f => {
        const isRequester = f.requester_id === session.user.id
        const p = isRequester
          ? f['profiles!friendships_addressee_id_fkey']
          : f['profiles!friendships_requester_id_fkey']
        return p
      }).filter(Boolean)
      setFriends(list)
      if (list.length) setFriendId(list[0].id)
    }
    loadFriends()
  }, [])

  async function submit() {
    if (!friendId) { setError('Please select a friend.'); return }
    setSubmitting(true)
    setError('')
    const { error: err } = await supabase
      .from('borrow_requests')
      .insert({
        requester_id: friendId,
        owner_id:     session.user.id,
        book_id:      book.id,
        status:       'pending',
        message:      message.trim() || `${session.user.email?.split('@')[0] || 'Someone'} wants to lend you this book!`,
        return_date:  returnDate || null,
      })
    if (err) {
      setError('Could not send request. Please try again.')
      setSubmitting(false)
    } else {
      setDone(true)
    }
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const box     = { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 400, maxWidth: '92vw', padding: 0, overflow: 'hidden' }
  const head    = { padding: '18px 20px 14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
  const body    = { padding: '20px 20px 24px' }
  const label   = { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSubtle, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }
  const select  = { width: '100%', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bgCard, color: theme.text, outline: 'none' }
  const input   = { width: '100%', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bgCard, color: theme.text, outline: 'none', boxSizing: 'border-box' }
  const textarea= { ...input, resize: 'vertical', minHeight: 72, lineHeight: 1.5 }
  const btnPrim = { padding: '9px 22px', background: theme.gold, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }
  const btnSec  = { padding: '9px 16px', background: 'transparent', color: theme.textSubtle, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={box}>
        <div style={head}>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text }}>🤝 Lend Out</div>
            <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 2 }}>{book.title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: theme.textSubtle, lineHeight: 1 }}>×</button>
        </div>

        <div style={body}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 8 }}>Offer sent!</div>
              <div style={{ fontSize: 14, color: theme.textSubtle, marginBottom: 20 }}>
                Your friend will see the borrow request in their Loans page.
              </div>
              <button style={btnPrim} onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              {friends.length === 0 ? (
                <div style={{ fontSize: 14, color: theme.textSubtle, textAlign: 'center', padding: '20px 0' }}>
                  Add friends first to lend books to them.
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <label style={label}>Lend to</label>
                    <select
                      value={friendId}
                      onChange={e => setFriendId(e.target.value)}
                      style={select}
                    >
                      {friends.map(f => (
                        <option key={f.id} value={f.id}>{f.username}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={label}>Return by (optional)</label>
                    <input
                      type="date"
                      value={returnDate}
                      onChange={e => setReturnDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                      style={input}
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label style={label}>Message (optional)</label>
                    <textarea
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      placeholder="I think you'd love this one!"
                      style={textarea}
                    />
                  </div>

                  {error && <div style={{ fontSize: 13, color: '#c0521e', marginBottom: 12 }}>{error}</div>}

                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button style={btnSec} onClick={onClose}>Cancel</button>
                    <button style={btnPrim} onClick={submit} disabled={submitting}>
                      {submitting ? 'Sending…' : 'Send Offer'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- FRIEND STATS ROW ----
function FriendStatsRow({ stats }) {
  const { theme } = useTheme()
  if (stats === null) return <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '8px 0', fontSize: 13, flexWrap: 'wrap' }}><span style={{ color: theme.textSubtle, fontStyle: 'italic' }}>Checking friends…</span></div>
  if (!stats.length) return <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '8px 0', fontSize: 13, flexWrap: 'wrap' }}><span style={{ color: theme.textSubtle, fontStyle: 'italic' }}>👥 No friends have read this yet</span></div>
  const withRating = stats.filter(s => s.user_rating)
  const avg = withRating.length
    ? (withRating.reduce((sum, s) => sum + s.user_rating, 0) / withRating.length).toFixed(1)
    : null
  const names = stats.map(s => s.profiles?.username).filter(Boolean)
  const display = names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 > 1 ? 's' : ''}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '8px 0', fontSize: 13, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 15 }}>👥</span>
      <span style={{ color: theme.textMuted }}><strong>{display}</strong> {stats.length === 1 ? 'has' : 'have'} read this</span>
      {avg && <span style={{ color: theme.gold, fontWeight: 600 }}> · avg ★{avg}</span>}
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
