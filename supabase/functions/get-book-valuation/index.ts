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

    if (!apiKey) {
      console.error('GOOGLE_BOOKS_API_KEY is not set')
    }

    // ── Google Books API (list / retail price) ────────────────────────────────
    // Try ISBN first, then fall back to title+author
    const queries: string[] = []
    if (isbn) queries.push(`q=isbn:${encodeURIComponent(isbn)}`)
    if (title) {
      const q = [
        title  ? `intitle:${encodeURIComponent(title)}`  : '',
        author ? `inauthor:${encodeURIComponent(author)}` : '',
      ].filter(Boolean).join('+')
      queries.push(`q=${q}`)
    }

    let list_price: number | null = null
    let list_price_currency: string | null = null
    let saleability: string | null = null

    for (const query of queries) {
      if (list_price !== null) break
      try {
        // Request more results so we can skip ebooks and find print edition pricing
        const url = `https://www.googleapis.com/books/v1/volumes?${query}&maxResults=5${apiKey ? `&key=${apiKey}` : ''}`
        const res = await fetch(url)
        const data = await res.json()

        if (!res.ok) {
          console.error(`Google Books API error ${res.status}:`, JSON.stringify(data).slice(0, 300))
          continue
        }

        console.log(`Google Books query "${query}": totalItems=${data.totalItems}`)

        // Prefer non-ebook (print) prices over ebook prices
        let ebookPrice: number | null = null
        let ebookCurrency: string | null = null

        for (const item of data?.items || []) {
          const saleInfo = item?.saleInfo
          if (!saleInfo) continue
          saleability = saleInfo.saleability ?? saleability

          if (saleInfo.saleability === 'FOR_SALE' || saleInfo.saleability === 'FOR_PREORDER') {
            const priceObj = saleInfo.listPrice ?? saleInfo.retailPrice ?? null
            const amount: number | null = priceObj?.amount ?? null
            const currency: string | null = priceObj?.currencyCode ?? null

            if (amount && amount > 0) {
              if (saleInfo.isEbook) {
                // Save ebook price as fallback, but keep looking for print
                if (ebookPrice === null) {
                  ebookPrice = Math.round(amount * 100) / 100
                  ebookCurrency = currency
                  console.log(`Found ebook price: ${currency} ${amount} (saving as fallback)`)
                }
              } else {
                // Print edition — use this immediately
                list_price = Math.round(amount * 100) / 100
                list_price_currency = currency
                console.log(`Found print price: ${currency} ${amount}`)
                break
              }
            }
          }
        }

        // If no print price found, fall back to ebook price
        if (list_price === null && ebookPrice !== null) {
          list_price = ebookPrice
          list_price_currency = ebookCurrency
          console.log(`Using ebook price as fallback: ${ebookCurrency} ${ebookPrice}`)
        }
      } catch (err) {
        console.error('Google Books fetch error:', err)
      }
    }

    if (list_price === null) {
      return new Response(
        JSON.stringify({ found: false, saleability }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        found:               true,
        list_price,
        list_price_currency,
        avg_price:    null,
        min_price:    null,
        max_price:    null,
        sample_count: null,
        currency:     list_price_currency || 'USD',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Unhandled error:', err)
    return new Response(
      JSON.stringify({ found: false, error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
