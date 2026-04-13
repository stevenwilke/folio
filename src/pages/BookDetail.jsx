import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { extractGenreFromGoogleCategories } from '../lib/genres'
import { useTheme } from '../contexts/ThemeContext'
import { getCoverUrl } from '../lib/coverUrl'
import { uploadCoverToStorage } from '../lib/enrichBook'
import BookTagsManager from '../components/BookTagsManager'
import { fetchUsedPrices } from '../lib/fetchUsedPrices'
import { isFiction, computeReadingSpeeds, estimateReadingTime, formatTimer, checkSessionIdle } from '../lib/readingSpeed'
import { useIsMobile } from '../hooks/useIsMobile'
import CoverCropModal from '../components/CoverCropModal'
import RatingDistribution from '../components/RatingDistribution'
import QuoteCard from '../components/QuoteCard'

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
    // Try OL title+author search
    const params = new URLSearchParams({ fields: 'key', limit: '3' })
    params.set('title', book.title)
    if (book.author) params.set('author', book.author.split(',')[0].trim())
    const searchRes = await fetch(`https://openlibrary.org/search.json?${params}`)
    if (searchRes.ok) {
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
    }
    return null
  } catch {
    return null
  }
}

/** Fetch book metadata from Google Books via our edge function (uses API key server-side). */
async function fetchFromGoogleBooks(book) {
  try {
    const isbn = book.isbn_13 || book.isbn_10
    const { data, error } = await supabase.functions.invoke('get-book-metadata', {
      body: { isbn: isbn || null, title: book.title, author: book.author || null },
    })
    if (error || !data?.found) return null
    return {
      desc:       data.description && isLikelyEnglish(data.description) ? data.description : null,
      cover:      data.cover       || null,
      isbn_13:    data.isbn_13     || null,
      isbn_10:    data.isbn_10     || null,
      categories: data.categories  || [],
    }
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
  const [coverImgError, setCoverImgError]   = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [showCoverLightbox, setShowCoverLightbox] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState(null)
  const coverFileInputRef = useRef(null)
  const [tab, setTab]                   = useState('about')
  const [rating, setRating]             = useState(0)
  const [hoverRating, setHoverRating]   = useState(0)
  const [reviewText, setReviewText]     = useState('')
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [listing, setListing]           = useState(null)
  const [showListingModal, setShowListingModal] = useState(false)
  const [showLendModal,    setShowLendModal]    = useState(false)
  const [showRecommendModal, setShowRecommendModal] = useState(false)
  const [alsoEnjoyed, setAlsoEnjoyed] = useState([])
  const [quotes, setQuotes]           = useState([])
  const [newQuoteText, setNewQuoteText]     = useState('')
  const [newQuotePage, setNewQuotePage]     = useState('')
  const [newQuoteNote, setNewQuoteNote]     = useState('')
  const [savingQuote, setSavingQuote]       = useState(false)
  const [priceAlert, setPriceAlert] = useState(null) // { oldPrice, newPrice, pctChange }
  const [valuation, setValuation]       = useState(null)
  const [valuationLoading, setValuationLoading] = useState(true)
  const [friendStats, setFriendStats]   = useState(null)   // null = loading, [] = none
  const [currentPage, setCurrentPage]   = useState(0)
  const savePageTimer = useRef(null)
  const [removeConfirm, setRemoveConfirm] = useState(false)

  // Reading timer state
  const [activeSession, setActiveSession] = useState(null)
  const [timerDisplay, setTimerDisplay]   = useState('0:00')
  const [readingSpeeds, setReadingSpeeds] = useState(null)
  const [showStopModal, setShowStopModal] = useState(false)
  const [endPageInput, setEndPageInput]   = useState('')
  const timerRef = useRef(null)

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
    fetchQuotes()
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

      // Enrich missing fields in the background (description, cover, genre, ISBN)
      const needsDesc  = !data.description
      const needsCover = !data.cover_image_url
      const needsGenre = !data.genre

      if (needsDesc || needsCover || needsGenre || !data.isbn_13) {
        setFetchingDesc(needsDesc)

        // Try Open Library first for description (free, no key)
        let desc  = needsDesc  ? await fetchDescriptionFromOL(data) : null
        let cover = null
        let genre = null

        // Call Google Books edge function if we still need anything
        let gbIsbn13 = null, gbIsbn10 = null
        if ((needsDesc && !desc) || needsCover || needsGenre || !data.isbn_13) {
          const gb = await fetchFromGoogleBooks(data)
          if (gb) {
            if (needsDesc  && !desc  && gb.desc)   desc  = gb.desc
            if (needsCover && !cover && gb.cover)  cover = gb.cover
            if (needsGenre && gb.categories?.length) {
              genre = extractGenreFromGoogleCategories(gb.categories)
            }
            if (!data.isbn_13 && gb.isbn_13) gbIsbn13 = gb.isbn_13
            if (!data.isbn_10 && gb.isbn_10) gbIsbn10 = gb.isbn_10
          }
        }

        const updates = {}
        if (desc)     updates.description     = desc
        if (cover)    updates.cover_image_url = cover
        if (genre)    updates.genre           = genre
        if (gbIsbn13) updates.isbn_13         = gbIsbn13
        if (gbIsbn10) updates.isbn_10         = gbIsbn10

        if (Object.keys(updates).length > 0) {
          await supabase.from('books').update(updates).eq('id', data.id)
          setBook(prev => ({ ...prev, ...updates }))
          // Notify Library so it can update the card immediately (no re-fetch needed)
          if (updates.cover_image_url) {
            window.dispatchEvent(new CustomEvent('exlibris:coverUpdated', {
              detail: { bookId: data.id, coverUrl: updates.cover_image_url }
            }))
          }
          // If we just found an ISBN, trigger valuation fetch now
          if (gbIsbn13 || gbIsbn10) loadValuation({ ...data, ...updates })
        }

        setFetchingDesc(false)
      }

      loadValuation(data)
      fetchJournal(data)
      fetchReadingSessions()
      fetchActiveSession()
      fetchAlsoEnjoyed(data.id)
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
      .select('avg_rating, rating_count, stars_1, stars_2, stars_3, stars_4, stars_5')
      .eq('book_id', activeBookId)
      .maybeSingle()
    if (data) setCommunityRating(data)
  }

  async function fetchQuotes() {
    const { data } = await supabase
      .from('book_quotes')
      .select('*, profiles:user_id(username)')
      .eq('book_id', activeBookId)
      .order('created_at', { ascending: false })
    setQuotes(data || [])
  }

  async function saveQuote() {
    if (!newQuoteText.trim() || !session) return
    setSavingQuote(true)
    await supabase.from('book_quotes').insert({
      user_id: session.user.id,
      book_id: activeBookId,
      quote_text: newQuoteText.trim(),
      page_number: newQuotePage ? parseInt(newQuotePage) : null,
      note: newQuoteNote.trim() || null,
    })
    setNewQuoteText('')
    setNewQuotePage('')
    setNewQuoteNote('')
    setSavingQuote(false)
    fetchQuotes()
  }

  async function deleteQuote(id) {
    await supabase.from('book_quotes').delete().eq('id', id)
    fetchQuotes()
  }

  async function shareQuoteToFeed(quote) {
    await supabase.from('reading_posts').insert({
      user_id: session.user.id,
      book_id: activeBookId,
      content: `"${quote.quote_text}"${quote.page_number ? ` (p.${quote.page_number})` : ''}`,
      post_type: 'quote',
      quote_id: quote.id,
    })
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

    if (cached && cacheAge < 24 && cached.avg_price != null) {
      setValuation(cached)
      setValuationLoading(false)
      return
    }

    const isbn = bookData.isbn_13 || bookData.isbn_10 || null

    // Fetch retail price from Edge Function + used prices from ThriftBooks in parallel
    try {
      const [retailResult, usedResult] = await Promise.allSettled([
        supabase.functions.invoke('get-book-valuation', {
          body: { isbn, title: bookData.title, author: bookData.author },
        }),
        fetchUsedPrices(isbn, bookData.title, bookData.author),
      ])

      const data = retailResult.status === 'fulfilled' ? retailResult.value.data : null
      const used = usedResult.status === 'fulfilled' ? usedResult.value : null
      // Prefer client-side ThriftBooks data; fall back to edge function data
      const usedData = used?.avg_price != null ? used : (data?.avg_price != null ? data : null)

      const found = data?.found || usedData

      if (!found) {
        // Don't overwrite existing prices with null — only write if no cache exists
        if (!cached?.avg_price && !cached?.list_price) {
          await supabase.from('valuations').upsert(
            { book_id: bookData.id, fetched_at: new Date().toISOString() },
            { onConflict: 'book_id' }
          )
        }
        setValuation(false)
      } else {
        const row = {
          book_id:             bookData.id,
          currency:            data?.currency        || 'USD',
          list_price:          data?.list_price ?? used?.new_price ?? null,
          list_price_currency: data?.list_price_currency ?? (used?.new_price ? 'USD' : null),
          fetched_at:          new Date().toISOString(),
        }
        if (usedData?.avg_price != null) {
          row.avg_price     = usedData.avg_price
          row.min_price     = usedData.min_price     ?? null
          row.max_price     = usedData.max_price     ?? null
          row.sample_count  = usedData.sample_count  ?? null
          row.paperback_avg = usedData.paperback_avg ?? null
          row.hardcover_avg = usedData.hardcover_avg ?? null
        }
        await supabase.from('valuations').upsert(row, { onConflict: 'book_id' })
        setValuation(row)

        // Price alert detection — only if the new price is materially different
        if (cached?.list_price && row.list_price) {
          const oldP = Number(cached.list_price)
          const newP = Number(row.list_price)
          if (oldP !== newP) {
            const pct = Math.round(((newP - oldP) / oldP) * 100)
            if (Math.abs(pct) >= 20 && Math.abs(newP - oldP) >= 5) {
              setPriceAlert({ oldPrice: oldP.toFixed(2), newPrice: newP.toFixed(2), pctChange: pct })
            }
          }
        }
      }
    } catch {
      setValuation(false)
    }
    setValuationLoading(false)
  }

  // ── Reading Timer ────────────────────────────────────────────────────────
  async function fetchReadingSessions() {
    const { data } = await supabase
      .from('reading_sessions')
      .select('started_at, ended_at, pages_read, is_fiction')
      .eq('user_id', session.user.id)
      .eq('status', 'completed')
      .not('pages_read', 'is', null)
    if (data?.length) setReadingSpeeds(computeReadingSpeeds(data))
  }

  async function fetchAlsoEnjoyed(bookId) {
    try {
      // Find users who own this book
      const { data: owners } = await supabase
        .from('collection_entries')
        .select('user_id')
        .eq('book_id', bookId)
        .limit(50)
      const ownerIds = (owners || []).map(o => o.user_id).filter(id => id !== session.user.id)
      if (!ownerIds.length) return

      // Find their other highly-rated books
      const { data: entries } = await supabase
        .from('collection_entries')
        .select('book_id, user_rating, books(id, title, author, cover_image_url)')
        .in('user_id', ownerIds)
        .neq('book_id', bookId)
        .gte('user_rating', 4)
        .limit(100)

      // Exclude books the current user already owns
      const { data: myBooks } = await supabase
        .from('collection_entries')
        .select('book_id')
        .eq('user_id', session.user.id)
      const myBookIds = new Set((myBooks || []).map(b => b.book_id))

      // Group by book, count owners, sort
      const bookMap = {}
      for (const e of (entries || [])) {
        if (!e.books || myBookIds.has(e.book_id)) continue
        if (!bookMap[e.book_id]) bookMap[e.book_id] = { ...e.books, count: 0, totalRating: 0 }
        bookMap[e.book_id].count++
        if (e.user_rating) bookMap[e.book_id].totalRating += e.user_rating
      }

      const results = Object.values(bookMap)
        .sort((a, b) => b.count - a.count || (b.totalRating / b.count) - (a.totalRating / a.count))
        .slice(0, 8)
      setAlsoEnjoyed(results)
    } catch { /* ignore */ }
  }

  async function fetchActiveSession() {
    const { data } = await supabase
      .from('reading_sessions')
      .select('id, book_id, started_at, start_page')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .maybeSingle()
    setActiveSession(data || null)

    // Check for stale session
    if (data && checkSessionIdle(data.started_at).isIdle) {
      setShowStopModal(true)
      setEndPageInput(String(currentPage || data.start_page || ''))
    }
  }

  // Timer tick
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!activeSession || activeSession.book_id !== activeBookId) {
      setTimerDisplay('0:00')
      return
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(activeSession.started_at).getTime()) / 1000)
      setTimerDisplay(formatTimer(elapsed))
    }
    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => clearInterval(timerRef.current)
  }, [activeSession, activeBookId])

  async function startReadingTimer() {
    if (!book) return
    const { data, error } = await supabase.from('reading_sessions').insert({
      user_id:    session.user.id,
      book_id:    book.id,
      start_page: currentPage || 0,
      is_fiction:  isFiction(book.genre),
      status:     'active',
    }).select().single()
    if (!error && data) setActiveSession(data)
  }

  function requestStopTimer() {
    setEndPageInput(String(currentPage || activeSession?.start_page || ''))
    setShowStopModal(true)
  }

  async function confirmStopTimer() {
    if (!activeSession) return
    const endPage = parseInt(endPageInput) || 0
    const pagesRead = Math.max(0, endPage - (activeSession.start_page || 0))
    await supabase.from('reading_sessions')
      .update({
        ended_at:   new Date().toISOString(),
        end_page:   endPage,
        pages_read: pagesRead,
        status:     'completed',
      })
      .eq('id', activeSession.id)

    // Sync current page
    if (endPage > 0 && entry) {
      await supabase.from('collection_entries')
        .update({ current_page: endPage })
        .eq('id', entry.id)
      setCurrentPage(endPage)
    }

    // Auto-post reading session to feed (if significant)
    if (pagesRead >= 10 && book) {
      const durationMin = Math.round((Date.now() - new Date(activeSession.started_at).getTime()) / 60000)
      const durLabel = durationMin >= 60
        ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
        : `${durationMin} min`
      await supabase.from('reading_posts').insert({
        user_id: session.user.id,
        book_id: book.id,
        content: `📖 Read ${pagesRead} pages of ${book.title} in ${durLabel}`,
      }).catch(() => {}) // silent fail
    }

    setActiveSession(null)
    setShowStopModal(false)
    fetchReadingSessions() // refresh speeds
  }

  async function discardSession() {
    if (!activeSession) return
    await supabase.from('reading_sessions')
      .update({ status: 'discarded' })
      .eq('id', activeSession.id)
    setActiveSession(null)
    setShowStopModal(false)
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
    // Determine has_read: 'read' always true, 'owned' preserves existing, others false
    let newHasRead = false
    if (newStatus === 'read') newHasRead = true
    else if (newStatus === 'owned') newHasRead = entry?.has_read || false

    if (entry) {
      const { data } = await supabase
        .from('collection_entries')
        .update({ read_status: newStatus, has_read: newHasRead })
        .eq('id', entry.id)
        .select()
        .single()
      if (data) setEntry(data)
      else setEntry({ ...entry, read_status: newStatus, has_read: newHasRead })
    } else {
      const { data } = await supabase
        .from('collection_entries')
        .insert({ user_id: session.user.id, book_id: activeBookId, read_status: newStatus, has_read: newHasRead })
        .select()
        .single()
      if (data) {
        setEntry(data)
        setRating(0)
        setReviewText('')
      }
    }
  }

  async function toggleHasRead() {
    if (!entry) return
    const newVal = !entry.has_read
    const { data } = await supabase
      .from('collection_entries')
      .update({ has_read: newVal })
      .eq('id', entry.id)
      .select()
      .single()
    if (data) setEntry(data)
    else setEntry({ ...entry, has_read: newVal })
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

  function handleCoverUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !book) return
    // Read as data URL and open crop modal instead of uploading immediately
    const reader = new FileReader()
    reader.onload = ev => setCropImageSrc(ev.target.result)
    reader.readAsDataURL(file)
    if (coverFileInputRef.current) coverFileInputRef.current.value = ''
  }

  async function uploadCroppedCover(blob) {
    if (!book) return
    setCropImageSrc(null)
    setCoverUploading(true)
    try {
      const path = `${book.id}.jpg`
      const { error: uploadErr } = await supabase.storage
        .from('book-covers')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (!uploadErr) {
        const { data } = supabase.storage.from('book-covers').getPublicUrl(path)
        const url = data.publicUrl + '?t=' + Date.now()  // cache-bust
        await supabase.from('books').update({ cover_image_url: url }).eq('id', book.id)
        setBook(prev => ({ ...prev, cover_image_url: url }))
        setCoverImgError(false)
      }
    } catch { /* silent fail */ }
    setCoverUploading(false)
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
      // If page reaches or exceeds total pages, auto-mark as read (keep in library)
      if (book.pages && p >= book.pages) {
        await supabase
          .from('collection_entries')
          .update({ current_page: book.pages, read_status: 'owned', has_read: true })
          .eq('id', entry.id)
          .eq('user_id', session.user.id)
        setEntry(prev => ({ ...prev, read_status: 'owned', has_read: true }))
        return
      }
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
    tabContent:          { maxWidth: 680, position: 'relative', zIndex: 1, minHeight: 200 },
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
  const hasRead = entry?.has_read || false

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
          {/* Cover with upload overlay */}
          <div style={{ ...s.coverWrap, position: 'relative' }}
            onMouseEnter={e => { const btn = e.currentTarget.querySelector('[data-upload-btn]'); if (btn) btn.style.opacity = '1' }}
            onMouseLeave={e => { const btn = e.currentTarget.querySelector('[data-upload-btn]'); if (btn) btn.style.opacity = '0' }}>
            {(() => {
              const url = getCoverUrl(book)
              return (url && !coverImgError)
                ? <img src={url} alt={book.title} style={{ ...s.coverImg, cursor: 'zoom-in' }} onClick={() => setShowCoverLightbox(true)} onError={() => setCoverImgError(true)} />
                : <FakeCover title={book.title} />
            })()}
            {/* Upload button overlay */}
            <input ref={coverFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverUpload} />
            <button
              data-upload-btn
              onClick={() => coverFileInputRef.current?.click()}
              disabled={coverUploading}
              title="Upload a custom cover"
              style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.65)', border: 'none', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', color: 'white', fontSize: 15, opacity: 0, transition: 'opacity 0.2s', lineHeight: 1, backdropFilter: 'blur(4px)' }}>
              {coverUploading ? '⏳' : '📷'}
            </button>
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
              <>
                <div style={s.communityRatingRow}>
                  <CommunityStars avg={parseFloat(communityRating.avg_rating)} />
                  <span style={s.communityRatingNum}>{communityRating.avg_rating}</span>
                  <span style={s.communityRatingCount}>
                    · {communityRating.rating_count} {communityRating.rating_count === 1 ? 'rating' : 'ratings'} on Ex Libris
                  </span>
                </div>
                {communityRating.rating_count >= 2 && (
                  <RatingDistribution
                    stars_1={communityRating.stars_1}
                    stars_2={communityRating.stars_2}
                    stars_3={communityRating.stars_3}
                    stars_4={communityRating.stars_4}
                    stars_5={communityRating.stars_5}
                    rating_count={communityRating.rating_count}
                  />
                )}
              </>
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
              {(() => {
                if (!book.pages || !readingSpeeds) return null
                const est = estimateReadingTime(book.pages, entry?.read_status === 'reading' ? currentPage : 0, book.genre, readingSpeeds)
                if (!est) return null
                return <span style={{ ...s.metaPill, background: 'rgba(90,122,90,0.1)', color: theme.sage }}>
                  ⏱ ~{est.label}{entry?.read_status === 'reading' ? ' left' : ''}
                </span>
              })()}
            </div>

            {/* Valuation */}
            {(valuationLoading || valuation) && <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: theme.textSubtle, marginTop: 14, marginBottom: 4 }}>Values</div>}
            {priceAlert && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(90,122,90,0.1)', borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                <span>📈</span>
                <span style={{ color: theme.sage, fontWeight: 600 }}>Price up!</span>
                <span style={{ color: theme.textSubtle, textDecoration: 'line-through' }}>${priceAlert.oldPrice}</span>
                <span style={{ color: theme.sage, fontWeight: 700 }}>→ ${priceAlert.newPrice}</span>
                <span style={{ fontSize: 11, color: theme.sage }}>+{priceAlert.pctChange}%</span>
                <button onClick={() => setPriceAlert(null)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: theme.textSubtle, padding: 0 }}>×</button>
              </div>
            )}
            <div style={s.valuationRow}>
              {valuationLoading ? (
                <span style={s.valuationMuted}>Fetching prices…</span>
              ) : (
                <>
                  {valuation?.list_price != null && (
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={s.valuationPrice}>${Number(valuation.list_price).toFixed(2)}</span>
                      <span style={s.valuationSub}>
                        Retail{valuation.list_price_currency && valuation.list_price_currency !== 'USD' ? ` (${valuation.list_price_currency})` : ''}
                      </span>
                    </span>
                  )}
                  {valuation?.paperback_avg != null && (
                    <>
                      {valuation?.list_price != null && <span style={s.valuationDivider}>·</span>}
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={s.valuationMarket}>${Number(valuation.paperback_avg).toFixed(2)}</span>
                        <span style={s.valuationSub}>Used Paperback</span>
                      </span>
                    </>
                  )}
                  {valuation?.hardcover_avg != null && (
                    <>
                      <span style={s.valuationDivider}>·</span>
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={s.valuationMarket}>${Number(valuation.hardcover_avg).toFixed(2)}</span>
                        <span style={s.valuationSub}>Used Hardcover</span>
                      </span>
                    </>
                  )}
                  {valuation?.avg_price != null && !valuation?.paperback_avg && !valuation?.hardcover_avg && (
                    <>
                      {valuation?.list_price != null && <span style={s.valuationDivider}>·</span>}
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={s.valuationMarket}>${Number(valuation.avg_price).toFixed(2)}</span>
                        <span style={s.valuationSub}>Used avg</span>
                      </span>
                    </>
                  )}
                  {/* Estimated used value when no actual used price exists */}
                  {valuation?.avg_price == null && !valuation?.paperback_avg && !valuation?.hardcover_avg && valuation?.list_price != null && (
                    <>
                      <span style={s.valuationDivider}>·</span>
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ ...s.valuationMarket, fontStyle: 'italic', opacity: 0.75 }}>~${(Number(valuation.list_price) * 0.35).toFixed(2)}</span>
                        <span style={{ ...s.valuationSub, fontStyle: 'italic' }}>Est. used</span>
                      </span>
                    </>
                  )}
                  {(valuation?.list_price != null || valuation?.avg_price != null || valuation?.paperback_avg != null) && <span style={s.valuationDivider}>·</span>}
                  <a
                    href={
                      (book.isbn_13 || book.isbn_10)
                        ? `https://bookshop.org/a/122832/${book.isbn_13 || book.isbn_10}`
                        : `https://bookshop.org/search?keywords=${encodeURIComponent(book.title)}`
                    }
                    target="_blank" rel="noopener noreferrer"
                    style={{ ...s.valuationSub, color: theme.rust, textDecoration: 'none', fontStyle: 'italic' }}
                  >
                    Buy new →
                  </a>
                  <span style={s.valuationDivider}>·</span>
                  <a
                    href={`https://www.thriftbooks.com/browse/?b.search=${encodeURIComponent(book.isbn_13 || book.isbn_10 || book.title)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ ...s.valuationSub, color: theme.rust, textDecoration: 'none', fontStyle: 'italic' }}
                  >
                    Find used →
                  </a>
                  <span style={s.valuationDivider}>·</span>
                  <a
                    href={
                      (book.isbn_13 || book.isbn_10)
                        ? `https://www.abebooks.com/servlet/SearchResults?isbn=${book.isbn_13 || book.isbn_10}&cm_sp=snippet-_-srp1-_-isbn1`
                        : `https://www.abebooks.com/servlet/SearchResults?tn=${encodeURIComponent(book.title)}&an=${encodeURIComponent(book.author || '')}`
                    }
                    target="_blank" rel="noopener noreferrer"
                    style={{ ...s.valuationSub, color: theme.rust, textDecoration: 'none', fontStyle: 'italic' }}
                  >
                    Rare & collectible →
                  </a>
                </>
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
            {/* "Mark as read" toggle for owned books */}
            {status === 'owned' && (
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={toggleHasRead}
                  style={{
                    padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    fontFamily: "'DM Sans', sans-serif", cursor: 'pointer', transition: 'all 0.15s',
                    border: `1px solid ${hasRead ? '#5a7a5a' : theme.border}`,
                    background: hasRead ? 'rgba(90,122,90,0.15)' : 'transparent',
                    color: hasRead ? '#5a7a5a' : theme.textMuted,
                  }}
                >
                  {hasRead ? '✓ Read' : 'Mark as read'}
                </button>
              </div>
            )}

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
                <button style={s.lendOutBtn} onClick={() => setShowRecommendModal(true)}>
                  💌 Recommend
                </button>
              </div>
            )}

            {/* Reading progress + timer */}
            {entry?.read_status === 'reading' && (
              <div style={{ marginTop: 16 }}>
                <div style={s.ratingLabel}>Reading Progress</div>

                {/* Reading Timer */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  {activeSession && activeSession.book_id === activeBookId ? (
                    <>
                      <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: theme.sage, minWidth: 60 }}>{timerDisplay}</span>
                      <button
                        onClick={requestStopTimer}
                        style={{ padding: '5px 14px', background: theme.rust, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        Stop Reading
                      </button>
                    </>
                  ) : activeSession ? (
                    <span style={{ fontSize: 12, color: theme.textSubtle, fontStyle: 'italic' }}>Timer running on another book</span>
                  ) : (
                    <button
                      onClick={startReadingTimer}
                      style={{ padding: '5px 14px', background: theme.sage, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                    >
                      ⏱ Start Reading
                    </button>
                  )}
                </div>
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
                <button
                  style={{
                    marginTop: 10, padding: '7px 16px', background: theme.sage,
                    color: '#fff', border: 'none', borderRadius: 8, fontSize: 13,
                    fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                  }}
                  onClick={async () => {
                    await supabase.from('collection_entries')
                      .update({ read_status: 'owned', has_read: true, current_page: book.pages || currentPage || null })
                      .eq('id', entry.id).eq('user_id', session.user.id)
                    setEntry(prev => ({ ...prev, read_status: 'owned', has_read: true }))
                  }}
                >
                  ✓ Mark as Finished
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Listing modal */}
        {showListingModal && book && (
          <ListingModal
            session={session}
            book={book}
            valuation={valuation || null}
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

        {/* Recommend to friend modal */}
        {showRecommendModal && book && (
          <RecommendModal
            session={session}
            book={book}
            theme={theme}
            onClose={() => setShowRecommendModal(false)}
          />
        )}

        {/* Stop reading session modal */}
        {showStopModal && activeSession && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ background: theme.bgCard, borderRadius: 16, padding: 28, maxWidth: 380, width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}>
              <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 4 }}>Reading Session</div>
              <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, color: theme.sage, margin: '12px 0' }}>{timerDisplay}</div>
              {checkSessionIdle(activeSession.started_at).isIdle && (
                <div style={{ fontSize: 13, color: theme.rust, marginBottom: 12, fontStyle: 'italic' }}>
                  This session has been running for {checkSessionIdle(activeSession.started_at).elapsedMin} minutes. Adjust the page count if you stopped reading earlier.
                </div>
              )}
              <label style={{ fontSize: 13, fontWeight: 600, color: theme.textSubtle, display: 'block', marginBottom: 4 }}>What page are you on now?</label>
              <input
                type="number"
                min={activeSession.start_page || 0}
                max={book?.pages || undefined}
                value={endPageInput}
                onChange={e => setEndPageInput(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 15, fontFamily: "'DM Sans', sans-serif", boxSizing: 'border-box', marginBottom: 6 }}
                autoFocus
              />
              {activeSession.start_page != null && parseInt(endPageInput) > activeSession.start_page && (
                <div style={{ fontSize: 12, color: theme.textSubtle, marginBottom: 12 }}>
                  {parseInt(endPageInput) - activeSession.start_page} pages read this session
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  onClick={confirmStopTimer}
                  style={{ flex: 1, padding: '9px 16px', background: theme.sage, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  Save Session
                </button>
                <button
                  onClick={discardSession}
                  style={{ padding: '9px 16px', background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontWeight: 600, color: theme.textSubtle, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
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
          {['about', 'details', 'reviews', 'your review', 'quotes'].map(t => (
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

        {/* Details */}
        {tab === 'details' && (
          <div style={s.tabContent}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 20px', fontSize: 14, lineHeight: 1.6 }}>
              {book.author && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Author</span><span style={{ color: theme.text, cursor: 'pointer' }} onClick={() => navigate(`/author/${encodeURIComponent(book.author)}`)}>{book.author}</span></>}
              {book.published_year && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Published</span><span style={{ color: theme.text }}>{book.published_year}</span></>}
              {book.publisher && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Publisher</span><span style={{ color: theme.text }}>{book.publisher}</span></>}
              {book.format && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Format</span><span style={{ color: theme.text }}>{book.format}</span></>}
              {book.pages && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Pages</span><span style={{ color: theme.text }}>{book.pages}</span></>}
              {book.language && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Language</span><span style={{ color: theme.text }}>{book.language}</span></>}
              {book.genre && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Genre</span><span style={{ color: theme.text }}>{book.genre}</span></>}
              {book.isbn_13 && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>ISBN-13</span><span style={{ color: theme.text, fontFamily: 'monospace', fontSize: 13 }}>{book.isbn_13}</span></>}
              {book.isbn_10 && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>ISBN-10</span><span style={{ color: theme.text, fontFamily: 'monospace', fontSize: 13 }}>{book.isbn_10}</span></>}
              {book.series_name && <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Series</span><span style={{ color: theme.text }}>{book.series_name}{book.series_number ? ` #${book.series_number}` : ''}</span></>}
            </div>

            {/* Pricing / Market Data */}
            {valuation && (
              <div style={{ marginTop: 28 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 14 }}>Market Data</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 20px', fontSize: 14, lineHeight: 1.6 }}>
                  {valuation.list_price != null && (
                    <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Retail Price</span>
                    <span style={{ color: theme.sage, fontWeight: 700 }}>
                      ${Number(valuation.list_price).toFixed(2)}
                      {valuation.list_price_currency && valuation.list_price_currency !== 'USD' ? ` ${valuation.list_price_currency}` : ''}
                    </span></>
                  )}
                  {valuation.avg_price != null && (
                    <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Avg Used Price</span>
                    <span style={{ color: theme.text }}>${Number(valuation.avg_price).toFixed(2)}</span></>
                  )}
                  {valuation.min_price != null && valuation.max_price != null && (
                    <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Price Range</span>
                    <span style={{ color: theme.text }}>${Number(valuation.min_price).toFixed(2)} – ${Number(valuation.max_price).toFixed(2)}</span></>
                  )}
                  {valuation.sample_count != null && (
                    <><span style={{ color: theme.textSubtle, fontWeight: 600 }}>Based On</span>
                    <span style={{ color: theme.text }}>{valuation.sample_count} listing{valuation.sample_count !== 1 ? 's' : ''}</span></>
                  )}
                </div>
              </div>
            )}

            {/* Readers Also Enjoyed */}
            {alsoEnjoyed.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 14 }}>Readers Also Enjoyed</div>
                <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
                  {alsoEnjoyed.map(b => (
                    <div
                      key={b.id}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, cursor: 'pointer', width: 80 }}
                      onClick={() => onBack ? onBack() : navigate(`/?book=${b.id}`)}
                    >
                      {b.cover_image_url
                        ? <img src={b.cover_image_url} style={{ width: 60, height: 80, objectFit: 'cover', borderRadius: 5, boxShadow: '2px 3px 10px rgba(26,18,8,0.18)' }} alt="" />
                        : <div style={{ width: 60, height: 80, borderRadius: 5, background: theme.rust, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', padding: 4, textAlign: 'center' }}>{b.title}</div>
                      }
                      <span style={{ fontSize: 10, color: theme.text, textAlign: 'center', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', width: '100%' }}>{b.title}</span>
                      {b.count > 1 && <span style={{ fontSize: 9, color: theme.textSubtle }}>{b.count} readers</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* External Links */}
            <div style={{ marginTop: 28 }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 14 }}>Find This Book</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a
                  href={(book.isbn_13 || book.isbn_10) ? `https://bookshop.org/a/122832/${book.isbn_13 || book.isbn_10}` : `https://bookshop.org/search?keywords=${encodeURIComponent(book.title)}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ padding: '8px 16px', borderRadius: 8, background: theme.bgCard, border: `1px solid ${theme.border}`, fontSize: 13, color: theme.rust, textDecoration: 'none', fontWeight: 600 }}
                >Buy new →</a>
                <a
                  href={`https://www.thriftbooks.com/browse/?b.search=${encodeURIComponent(book.isbn_13 || book.isbn_10 || book.title)}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ padding: '8px 16px', borderRadius: 8, background: theme.bgCard, border: `1px solid ${theme.border}`, fontSize: 13, color: theme.text, textDecoration: 'none', fontWeight: 600 }}
                >Find used →</a>
                <a
                  href={(book.isbn_13 || book.isbn_10) ? `https://www.abebooks.com/servlet/SearchResults?isbn=${book.isbn_13 || book.isbn_10}` : `https://www.abebooks.com/servlet/SearchResults?tn=${encodeURIComponent(book.title)}&an=${encodeURIComponent(book.author || '')}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(184,134,11,0.08)', border: '1px solid rgba(184,134,11,0.2)', fontSize: 13, color: '#9a7200', textDecoration: 'none', fontWeight: 600 }}
                >Rare & collectible →</a>
                {(book.isbn_13 || book.isbn_10) && (
                  <a
                    href={`https://openlibrary.org/isbn/${book.isbn_13 || book.isbn_10}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ padding: '8px 16px', borderRadius: 8, background: theme.bgCard, border: `1px solid ${theme.border}`, fontSize: 13, color: theme.textSubtle, textDecoration: 'none', fontWeight: 600 }}
                  >Open Library →</a>
                )}
              </div>
            </div>
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

        {/* Quotes */}
        {tab === 'quotes' && (
          <div style={s.tabContent}>
            {/* Add quote form */}
            {entry && (
              <div style={{ marginBottom: 20, padding: '16px 18px', background: theme.bgSubtle, borderRadius: 10 }}>
                <textarea
                  placeholder="Enter a memorable quote..."
                  value={newQuoteText}
                  onChange={e => setNewQuoteText(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    fontFamily: 'Georgia, serif', fontSize: 14, fontStyle: 'italic',
                    background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8,
                    padding: '10px 12px', color: theme.text, outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Page #"
                    value={newQuotePage}
                    onChange={e => setNewQuotePage(e.target.value)}
                    style={{
                      width: 70, padding: '6px 8px', fontSize: 12, borderRadius: 6,
                      border: `1px solid ${theme.border}`, background: theme.bgCard, color: theme.text,
                      fontFamily: "'DM Sans', sans-serif", outline: 'none',
                    }}
                  />
                  <input
                    placeholder="Add a note (optional)"
                    value={newQuoteNote}
                    onChange={e => setNewQuoteNote(e.target.value)}
                    style={{
                      flex: 1, padding: '6px 8px', fontSize: 12, borderRadius: 6,
                      border: `1px solid ${theme.border}`, background: theme.bgCard, color: theme.text,
                      fontFamily: "'DM Sans', sans-serif", outline: 'none',
                    }}
                  />
                  <button
                    disabled={!newQuoteText.trim() || savingQuote}
                    onClick={saveQuote}
                    style={{
                      padding: '6px 14px', background: theme.rust, color: 'white',
                      border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: newQuoteText.trim() ? 'pointer' : 'default',
                      opacity: newQuoteText.trim() ? 1 : 0.5,
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    {savingQuote ? 'Saving…' : 'Save Quote'}
                  </button>
                </div>
              </div>
            )}

            {/* Quote list */}
            {quotes.length === 0 ? (
              <div style={{ fontSize: 14, color: theme.textSubtle, textAlign: 'center', padding: '30px 0' }}>
                No quotes saved yet. Be the first to add one!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {quotes.map(q => (
                  <QuoteCard
                    key={q.id}
                    quoteText={q.quote_text}
                    bookTitle={book.title}
                    bookAuthor={book.author}
                    pageNumber={q.page_number}
                    note={q.note}
                    username={q.profiles?.username}
                    createdAt={q.created_at}
                    onShare={session ? () => shareQuoteToFeed(q) : null}
                    onDelete={q.user_id === session?.user?.id ? () => deleteQuote(q.id) : null}
                  />
                ))}
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

        {/* Cover crop modal */}
        {cropImageSrc && (
          <CoverCropModal
            imageSrc={cropImageSrc}
            onCrop={uploadCroppedCover}
            onCancel={() => setCropImageSrc(null)}
          />
        )}

        {/* Cover lightbox */}
        {showCoverLightbox && (() => {
          const url = getCoverUrl(book)
          return url ? (
            <div
              onClick={() => setShowCoverLightbox(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', backdropFilter: 'blur(6px)' }}>
              <img src={url} alt={book.title} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 10, boxShadow: '0 12px 60px rgba(0,0,0,0.5)' }} />
            </div>
          ) : null
        })()}
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

function ListingModal({ session, book, valuation: valProp, onClose, onSuccess }) {
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
            {valProp?.avg_price != null && (
              <div
                onClick={() => setPrice(Number(valProp.avg_price).toFixed(2))}
                style={{ marginTop: 6, fontSize: 12, color: theme.sage, cursor: 'pointer' }}
              >
                💡 Suggested: <strong>${Number(valProp.avg_price).toFixed(2)}</strong>
                <span style={{ color: theme.textSubtle }}> (used market avg)</span>
              </div>
            )}
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
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
      const friendIds = (fs || []).map(f =>
        f.requester_id === session.user.id ? f.addressee_id : f.requester_id
      )
      if (!friendIds.length) { setFriends([]); return }
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', friendIds)
      setFriends(profiles || [])
      if (profiles?.length) setFriendId(profiles[0].id)
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
        requester_id:    friendId,
        owner_id:        session.user.id,
        book_id:         book.id,
        status:          'pending',
        owner_initiated: true,
        message:         message.trim() || null,
        due_date:        returnDate || null,
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
  const navigate = useNavigate()
  if (stats === null) return <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '8px 0', fontSize: 13, flexWrap: 'wrap' }}><span style={{ color: theme.textSubtle, fontStyle: 'italic' }}>Checking friends…</span></div>
  if (!stats.length) return <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '8px 0', fontSize: 13, flexWrap: 'wrap' }}><span style={{ color: theme.textSubtle, fontStyle: 'italic' }}>👥 No friends have this book yet</span></div>

  const withRating = stats.filter(s => s.user_rating)
  const avg = withRating.length
    ? (withRating.reduce((sum, s) => sum + s.user_rating, 0) / withRating.length).toFixed(1)
    : null

  const groups = { read: [], reading: [], want: [], owned: [] }
  for (const s of stats) {
    const name = s.profiles?.username
    if (!name) continue
    const st = s.read_status || 'owned'
    if (groups[st]) groups[st].push(name)
    else groups.owned.push(name)
  }

  function formatNames(names) {
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]} and ${names[1]}`
    return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 > 1 ? 's' : ''}`
  }

  const parts = []
  if (groups.read.length) parts.push({ names: groups.read, verb: 'read this' })
  if (groups.reading.length) parts.push({ names: groups.reading, verb: groups.reading.length === 1 ? 'is reading this' : 'are reading this' })
  if (groups.want.length) parts.push({ names: groups.want, verb: groups.want.length === 1 ? 'wants to read this' : 'want to read this' })
  if (groups.owned.length) parts.push({ names: groups.owned, verb: groups.owned.length === 1 ? 'has this' : 'have this' })

  return (
    <div style={{ margin: '8px 0', fontSize: 13 }}>
      {parts.map((part, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
          {i === 0 && <span style={{ fontSize: 15 }}>👥</span>}
          {i > 0 && <span style={{ width: 19 }} />}
          <span style={{ color: theme.textMuted }}>
            {part.names.map((name, j) => (
              <span key={name}>
                {j > 0 && (j === part.names.length - 1 ? ' and ' : ', ')}
                <strong
                  style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }}
                  onClick={() => navigate(`/profile/${name}`)}
                >{name}</strong>
              </span>
            ))}
            {' '}{part.verb}
          </span>
          {i === 0 && avg && <span style={{ color: theme.gold, fontWeight: 600 }}> · avg ★{avg}</span>}
        </div>
      ))}
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

function RecommendModal({ session, book, theme, onClose }) {
  const [friends,    setFriends]    = useState([])
  const [friendId,   setFriendId]   = useState('')
  const [note,       setNote]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')

  useEffect(() => {
    async function loadFriends() {
      const { data: fs } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`)
      const ids = (fs || []).map(f =>
        f.requester_id === session.user.id ? f.addressee_id : f.requester_id
      )
      if (!ids.length) { setFriends([]); return }
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', ids)
      setFriends(profiles || [])
      if (profiles?.length) setFriendId(profiles[0].id)
    }
    loadFriends()
  }, [])

  async function submit() {
    if (!friendId) { setError('Please select a friend.'); return }
    setSubmitting(true)
    setError('')
    const { error: err } = await supabase
      .from('book_recommendations')
      .upsert({
        sender_id:    session.user.id,
        recipient_id: friendId,
        book_id:      book.id,
        note:         note.trim() || null,
        read:         false,
        dismissed:    false,
        created_at:   new Date().toISOString(),
      }, { onConflict: 'sender_id,recipient_id,book_id' })
    if (err) {
      setError('Could not send recommendation.')
      setSubmitting(false)
    } else {
      setDone(true)
    }
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(26,18,8,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const box     = { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: 400, maxWidth: '92vw', overflow: 'hidden' }
  const head    = { padding: '18px 20px 14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
  const bd      = { padding: '20px 20px 24px' }
  const lbl     = { display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSubtle, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }
  const sel     = { width: '100%', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bgCard, color: theme.text, outline: 'none' }
  const ta      = { width: '100%', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: theme.bgCard, color: theme.text, outline: 'none', resize: 'vertical', minHeight: 72, lineHeight: 1.5, boxSizing: 'border-box' }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={box}>
        <div style={head}>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: theme.text }}>💌 Recommend</div>
            <div style={{ fontSize: 13, color: theme.textSubtle, marginTop: 2 }}>{book.title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: theme.textSubtle, lineHeight: 1 }}>×</button>
        </div>
        <div style={bd}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>💌</div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 8 }}>Recommendation sent!</div>
              <div style={{ fontSize: 13, color: theme.textSubtle }}>Your friend will see it in their notifications.</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 18 }}>
                <label style={lbl}>Send to</label>
                {friends.length === 0 ? (
                  <div style={{ fontSize: 13, color: theme.textSubtle, fontStyle: 'italic' }}>No friends yet. Add friends to recommend books!</div>
                ) : (
                  <select style={sel} value={friendId} onChange={e => setFriendId(e.target.value)}>
                    {friends.map(f => <option key={f.id} value={f.id}>{f.username || 'User'}</option>)}
                  </select>
                )}
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={lbl}>Why should they read this? (optional)</label>
                <textarea style={ta} value={note} onChange={e => setNote(e.target.value)} placeholder="One of my all-time favorites..." />
              </div>
              {error && <div style={{ color: theme.rust, fontSize: 13, marginBottom: 12 }}>{error}</div>}
              <button style={{ padding: '9px 22px', background: theme.sage, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }} onClick={submit} disabled={submitting || !friends.length}>
                {submitting ? 'Sending…' : 'Send Recommendation'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
