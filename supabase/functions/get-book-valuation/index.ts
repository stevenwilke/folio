import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { isbn, title, author } = await req.json()

    // ── Source 1: Google Books API (list / retail price) ──────────────────────
    async function fetchGoogleBooksPrice(): Promise<{
      list_price: number | null
      list_price_currency: string | null
    }> {
      try {
        let googleUrl: string
        if (isbn) {
          googleUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1`
        } else {
          const q = `intitle:${encodeURIComponent(title || '')}+inauthor:${encodeURIComponent(author || '')}`
          googleUrl = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`
        }

        const res = await fetch(googleUrl)
        if (!res.ok) return { list_price: null, list_price_currency: null }

        const data = await res.json()
        const saleInfo = data?.items?.[0]?.saleInfo

        if (!saleInfo) return { list_price: null, list_price_currency: null }

        // Prefer listPrice, fall back to retailPrice
        const priceObj = saleInfo.listPrice ?? saleInfo.retailPrice ?? null
        const amount: number | null = priceObj?.amount ?? null
        const currency: string | null = priceObj?.currencyCode ?? saleInfo.currencyCode ?? null

        if (!amount || amount <= 0) return { list_price: null, list_price_currency: null }

        return { list_price: Math.round(amount * 100) / 100, list_price_currency: currency }
      } catch {
        return { list_price: null, list_price_currency: null }
      }
    }

    // ── Source 2: eBay Finding API (completed sold listings) ──────────────────
    async function fetchEbayMarketValue(): Promise<{
      avg_price: number | null
      min_price: number | null
      max_price: number | null
      sample_count: number | null
    }> {
      const appId = Deno.env.get('EBAY_APP_ID')
      if (!appId) return { avg_price: null, min_price: null, max_price: null, sample_count: null }

      try {
        // Prefer ISBN search (more precise), fall back to title + author
        const keywords = isbn ? isbn : `${title} ${author || ''}`.trim()

        // eBay Finding API — completed (sold) listings, Books category (267)
        const params = new URLSearchParams({
          'OPERATION-NAME': 'findCompletedItems',
          'SERVICE-VERSION': '1.0.0',
          'SECURITY-APPNAME': appId,
          'RESPONSE-DATA-FORMAT': 'JSON',
          'keywords': keywords,
          'categoryId': '267',
          'itemFilter(0).name': 'SoldItemsOnly',
          'itemFilter(0).value': 'true',
          'itemFilter(1).name': 'EndTimeFrom',
          'itemFilter(1).value': new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
          'sortOrder': 'EndTimeSoonest',
          'paginationInput.entriesPerPage': '50',
        })

        const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params}`
        const res = await fetch(url)

        if (!res.ok) return { avg_price: null, min_price: null, max_price: null, sample_count: null }

        const data = await res.json()
        const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || []

        if (!items.length) return { avg_price: null, min_price: null, max_price: null, sample_count: null }

        const prices: number[] = items
          .map((item: any) => parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || '0'))
          .filter((p: number) => p > 0)

        if (!prices.length) return { avg_price: null, min_price: null, max_price: null, sample_count: null }

        // Sort for percentile trimming (remove top + bottom 10% to reduce outliers)
        prices.sort((a: number, b: number) => a - b)
        const trim = Math.floor(prices.length * 0.1)
        const trimmed = prices.slice(trim, prices.length - trim || undefined)
        const usedPrices = trimmed.length >= 3 ? trimmed : prices

        const avg = usedPrices.reduce((a: number, b: number) => a + b, 0) / usedPrices.length

        return {
          avg_price:    Math.round(avg * 100) / 100,
          min_price:    Math.round(Math.min(...prices) * 100) / 100,
          max_price:    Math.round(Math.max(...prices) * 100) / 100,
          sample_count: prices.length,
        }
      } catch {
        return { avg_price: null, min_price: null, max_price: null, sample_count: null }
      }
    }

    // ── Fetch both sources in parallel ────────────────────────────────────────
    const [googleResult, ebayResult] = await Promise.allSettled([
      fetchGoogleBooksPrice(),
      fetchEbayMarketValue(),
    ])

    const google = googleResult.status === 'fulfilled'
      ? googleResult.value
      : { list_price: null, list_price_currency: null }

    const ebay = ebayResult.status === 'fulfilled'
      ? ebayResult.value
      : { avg_price: null, min_price: null, max_price: null, sample_count: null }

    const found = google.list_price !== null || ebay.avg_price !== null

    if (!found) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        found: true,
        list_price:          google.list_price,
        list_price_currency: google.list_price_currency,
        avg_price:           ebay.avg_price,
        min_price:           ebay.min_price,
        max_price:           ebay.max_price,
        sample_count:        ebay.sample_count,
        currency:            'USD',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ found: false, error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
