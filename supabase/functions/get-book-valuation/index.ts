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

    // ── ThriftBooks used prices (server-side, no CORS issues) ───────────────
    let avg_price: number | null = null
    let min_price: number | null = null
    let max_price: number | null = null
    let sample_count: number | null = null
    let paperback_avg: number | null = null
    let hardcover_avg: number | null = null

    try {
      const keyword = isbn || [title, author].filter(Boolean).join(' ')
      if (keyword) {
        const tbUrl = `https://www.thriftbooks.com/browse/?b.search=${encodeURIComponent(keyword)}`
        const tbRes = await fetch(tbUrl, {
          headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; ExLibris/1.0)' },
          redirect: 'follow',
        })
        if (tbRes.ok) {
          const html = await tbRes.text()

          // Parse JSON-LD blocks for used/new prices
          const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
          const usedPrices: number[] = []
          for (const block of (ldBlocks || [])) {
            try {
              const json = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '')
              const data = JSON.parse(json)
              if (data?.['@type'] !== 'Book' || !data?.offers?.price) continue
              const price = Number(data.offers.price)
              if (!(price > 0) || price > 50000) continue
              const offerIsbn = data.offers?.gtin13 || ''
              if (isbn && offerIsbn && offerIsbn !== isbn) continue
              const isNew = data.offers.itemCondition?.includes('New')
              if (!isNew) usedPrices.push(price)
            } catch { /* skip */ }
          }

          // Parse format-specific prices from HTML
          const formatRe = /(Hardcover|Paperback|Mass Market Paperback|Mass Market)[^$]{0,80}\$([0-9,.]+)/gi
          const pbPrices: number[] = []
          const hcPrices: number[] = []
          let m: RegExpExecArray | null
          while ((m = formatRe.exec(html))) {
            const price = parseFloat(m[2].replace(/,/g, ''))
            if (!(price > 0) || price > 50000) continue
            if (m[1].toLowerCase().includes('hardcover')) hcPrices.push(price)
            else pbPrices.push(price)
          }

          const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null

          if (usedPrices.length > 0) {
            avg_price = avg(usedPrices)
            min_price = Math.round(Math.min(...usedPrices) * 100) / 100
            max_price = Math.round(Math.max(...usedPrices) * 100) / 100
            sample_count = usedPrices.length
          }
          paperback_avg = avg(pbPrices)
          hardcover_avg = avg(hcPrices)

          console.log(`ThriftBooks "${keyword}": ${usedPrices.length} used prices, avg=${avg_price}`)
        }
      }
    } catch (err) {
      console.error('ThriftBooks fetch error:', err)
    }

    // ── AbeBooks used prices (good for rare / antiquarian books) ──────────────
    let abe_used_price: number | null = null
    let abe_new_price: number | null = null
    let abe_used_condition: string | null = null
    let abe_used_results: number | null = null

    try {
      // Try ISBN first, then author+title
      const abePayloads: Record<string, string>[] = []
      if (isbn) {
        abePayloads.push({
          action: 'getPricingDataByISBN',
          isbn,
          container: `pricingService-${isbn}`,
        })
      }
      if (title) {
        abePayloads.push({
          action: 'getPricingDataForAuthorTitleStandardAddToBasket',
          an: author || '',
          tn: title,
          container: 'oe-search-all',
        })
      }

      for (const payload of abePayloads) {
        if (abe_used_price !== null) break
        try {
          const abeRes = await fetch('https://www.abebooks.com/servlet/DWRestService/pricingservice', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (compatible; ExLibris/1.0)',
            },
            body: Object.entries(payload).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'),
          })
          if (abeRes.ok) {
            const abeData = await abeRes.json()

            // Parse best used price
            const bestUsed = abeData?.pricingInfoForBestUsed
            if (bestUsed?.bestPriceInPurchaseCurrencyValueOnly) {
              const price = parseFloat(bestUsed.bestPriceInPurchaseCurrencyValueOnly)
              if (price > 0) {
                abe_used_price = Math.round(price * 100) / 100
                abe_used_condition = bestUsed.bookCondition || null
                abe_used_results = bestUsed.totalResults || null
              }
            }

            // Parse best new price
            const bestNew = abeData?.pricingInfoForBestNew
            if (bestNew?.bestPriceInPurchaseCurrencyValueOnly) {
              const price = parseFloat(bestNew.bestPriceInPurchaseCurrencyValueOnly)
              if (price > 0) abe_new_price = Math.round(price * 100) / 100
            }

            console.log(`AbeBooks "${payload.isbn || payload.tn}": used=${abe_used_price}, new=${abe_new_price}, results=${abe_used_results}`)
          }
        } catch (abeErr) {
          console.error('AbeBooks request error:', abeErr)
        }
      }
    } catch (err) {
      console.error('AbeBooks fetch error:', err)
    }

    // If ThriftBooks didn't find used prices but AbeBooks did, use AbeBooks as primary
    if (avg_price === null && abe_used_price !== null) {
      avg_price = abe_used_price
    }

    const found = list_price !== null || avg_price !== null || abe_used_price !== null
    if (!found) {
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
        avg_price,
        min_price,
        max_price,
        sample_count,
        paperback_avg,
        hardcover_avg,
        abe_used_price,
        abe_new_price,
        abe_used_condition,
        abe_used_results,
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
