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
    const appId = Deno.env.get('EBAY_APP_ID')
    if (!appId) {
      return new Response(
        JSON.stringify({ found: false, error: 'EBAY_APP_ID not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const { isbn, title, author } = await req.json()

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

    if (!res.ok) {
      throw new Error(`eBay API error: ${res.status}`)
    }

    const data = await res.json()
    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || []

    if (!items.length) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const prices = items
      .map((item: any) => parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || '0'))
      .filter((p: number) => p > 0)

    if (!prices.length) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sort for percentile trimming (remove top + bottom 10% to reduce outliers)
    prices.sort((a: number, b: number) => a - b)
    const trim = Math.floor(prices.length * 0.1)
    const trimmed = prices.slice(trim, prices.length - trim || undefined)
    const usedPrices = trimmed.length >= 3 ? trimmed : prices

    const avg = usedPrices.reduce((a: number, b: number) => a + b, 0) / usedPrices.length

    return new Response(
      JSON.stringify({
        found: true,
        avg_price: Math.round(avg * 100) / 100,
        min_price: Math.round(Math.min(...prices) * 100) / 100,
        max_price: Math.round(Math.max(...prices) * 100) / 100,
        sample_count: prices.length,
        currency: 'USD',
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
