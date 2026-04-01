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
    const apiKey = Deno.env.get('GOOGLE_BOOKS_API_KEY') || ''

    // ── Google Books API (list / retail price) ────────────────────────────────
    let googleUrl: string
    if (isbn) {
      googleUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1&key=${apiKey}`
    } else {
      const q = `intitle:${encodeURIComponent(title || '')}+inauthor:${encodeURIComponent(author || '')}`
      googleUrl = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&key=${apiKey}`
    }

    let list_price: number | null = null
    let list_price_currency: string | null = null

    try {
      const res = await fetch(googleUrl)
      if (res.ok) {
        const data = await res.json()
        const saleInfo = data?.items?.[0]?.saleInfo

        if (saleInfo) {
          // Prefer listPrice, fall back to retailPrice
          const priceObj = saleInfo.listPrice ?? saleInfo.retailPrice ?? null
          const amount: number | null = priceObj?.amount ?? null
          const currency: string | null = priceObj?.currencyCode ?? saleInfo.currencyCode ?? null

          if (amount && amount > 0) {
            list_price = Math.round(amount * 100) / 100
            list_price_currency = currency
          }
        }
      }
    } catch {
      // Google Books unavailable — continue with null
    }

    if (list_price === null) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        found:               true,
        list_price,
        list_price_currency,
        // Market value fields left null — reserved for future BookScouter integration
        avg_price:    null,
        min_price:    null,
        max_price:    null,
        sample_count: null,
        currency:     list_price_currency || 'USD',
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
