/** Fetch used book prices from ThriftBooks (client-side, CORS allowed).
 *  Returns { avg_price, min_price, max_price, sample_count, paperback_avg, hardcover_avg, new_price } or null. */
export async function fetchUsedPrices(isbn, title, author) {
  try {
    const keyword = isbn || [title, author].filter(Boolean).join(' ')
    if (!keyword) return null

    const url = `https://www.thriftbooks.com/browse/?b.search=${encodeURIComponent(keyword)}`
    const res = await fetch(url, { headers: { Accept: 'text/html' } })
    if (!res.ok) return null

    const html = await res.text()

    // ── Prices from JSON-LD ──────────────────────────────────────────────────
    const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
    const usedPrices = []
    const newPrices = []
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
        if (isNew) {
          newPrices.push(price)
        } else {
          usedPrices.push(price)
        }
      } catch { /* skip */ }
    }

    // ── Format-specific prices from HTML ─────────────────────────────────────
    const formatRe = /(Hardcover|Paperback|Mass Market Paperback|Mass Market)[^$]{0,80}\$([0-9,.]+)/gi
    const pbPrices = []
    const hcPrices = []
    let m
    while ((m = formatRe.exec(html))) {
      const price = parseFloat(m[2].replace(/,/g, ''))
      if (!(price > 0) || price > 50000) continue
      if (m[1].toLowerCase().includes('hardcover')) {
        hcPrices.push(price)
      } else {
        pbPrices.push(price)
      }
    }

    if (usedPrices.length === 0 && newPrices.length === 0 && pbPrices.length === 0 && hcPrices.length === 0) return null

    const avg = (arr) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null

    // Use the lowest new price as the "new" retail price (best deal for a new copy)
    const new_price = newPrices.length ? Math.round(Math.min(...newPrices) * 100) / 100 : null

    return {
      avg_price:     avg(usedPrices),
      min_price:     usedPrices.length ? Math.round(Math.min(...usedPrices) * 100) / 100 : null,
      max_price:     usedPrices.length ? Math.round(Math.max(...usedPrices) * 100) / 100 : null,
      sample_count:  usedPrices.length || null,
      paperback_avg: avg(pbPrices),
      hardcover_avg: avg(hcPrices),
      new_price,
    }
  } catch {
    return null
  }
}
