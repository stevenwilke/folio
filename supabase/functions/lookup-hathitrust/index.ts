import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HathiTrust Bibliographic API takes identifiers (ISBN/OCLC/LCCN/recordnumber)
// — there is no free-text search endpoint. Strength is old / rare / academic
// titles that often have OCLC/LCCN but no ISBN.
const ID_TYPES = ['isbn', 'oclc', 'lccn', 'issn', 'recordnumber'] as const
type IdType = typeof ID_TYPES[number]

// MARC language codes for the few we'd actually want to display.
const MARC_LANG: Record<string, string> = {
  eng: 'English', fre: 'French', fra: 'French', ger: 'German', deu: 'German',
  spa: 'Spanish', ita: 'Italian', lat: 'Latin', grc: 'Greek', gre: 'Greek',
  rus: 'Russian', jpn: 'Japanese', chi: 'Chinese', zho: 'Chinese',
  ara: 'Arabic', heb: 'Hebrew', por: 'Portuguese', dut: 'Dutch', nld: 'Dutch',
  swe: 'Swedish', dan: 'Danish', nor: 'Norwegian', pol: 'Polish',
}

// Strip MARC trailing punctuation: " :", " /", ",", "."
function stripMarc(s: string | null | undefined): string | null {
  if (!s) return null
  return s.replace(/\s*[:/,;.]+\s*$/, '').trim() || null
}

// Pull all subfield $X values from a given MARC field tag in the XML blob.
function marcSubfields(xml: string, tag: string, code: string): string[] {
  const fieldRe = new RegExp(
    `<datafield[^>]*tag="${tag}"[^>]*>([\\s\\S]*?)</datafield>`,
    'g',
  )
  const subRe = new RegExp(
    `<subfield[^>]*code="${code}"[^>]*>([\\s\\S]*?)</subfield>`,
    'g',
  )
  const out: string[] = []
  let f: RegExpExecArray | null
  while ((f = fieldRe.exec(xml))) {
    const body = f[1]
    let s: RegExpExecArray | null
    while ((s = subRe.exec(body))) out.push(decodeXml(s[1]))
    subRe.lastIndex = 0
  }
  return out
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function parseMarc(xml: string) {
  // 260$b / 264$b — publisher (264 is the post-2011 RDA replacement for 260)
  const publisher =
    stripMarc(marcSubfields(xml, '264', 'b')[0]) ||
    stripMarc(marcSubfields(xml, '260', 'b')[0])

  // 300$a — physical description ("xiv, 432 p. ;"). Pull the first integer.
  const extent = marcSubfields(xml, '300', 'a')[0]
  let pages: number | null = null
  if (extent) {
    const m = extent.match(/(\d{2,5})\s*p/i) || extent.match(/(\d{2,5})/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > 0 && n < 20000) pages = n
    }
  }

  // 008 control field, positions 35-37 — primary language code
  const ctrl008 = xml.match(
    /<controlfield[^>]*tag="008"[^>]*>([\s\S]*?)<\/controlfield>/,
  )?.[1]
  let language: string | null = null
  if (ctrl008 && ctrl008.length >= 38) {
    const code = ctrl008.slice(35, 38).toLowerCase()
    language = MARC_LANG[code] || null
  }

  // 245$a + $b — title (use as a sanity-check fallback)
  const titleA = stripMarc(marcSubfields(xml, '245', 'a')[0])
  const titleB = stripMarc(marcSubfields(xml, '245', 'b')[0])
  const title = titleA && titleB ? `${titleA}: ${titleB}` : titleA

  // 100$a / 110$a — primary author
  const author = stripMarc(
    marcSubfields(xml, '100', 'a')[0] || marcSubfields(xml, '110', 'a')[0],
  )

  // 650$a — subject headings (used to derive a coarse genre)
  const subjects = marcSubfields(xml, '650', 'a')
    .map((s) => stripMarc(s))
    .filter(Boolean) as string[]

  return { publisher, pages, language, title, author, subjects }
}

function deriveYear(publishDates: string[] | undefined): number | null {
  if (!publishDates?.length) return null
  for (const d of publishDates) {
    const m = String(d).match(/\d{4}/)
    if (m) {
      const y = parseInt(m[0], 10)
      if (y >= 1000 && y <= new Date().getFullYear() + 1) return y
    }
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { isbn, oclc, lccn, issn, recordnumber } = body as Record<string, string | undefined>

    // Pick the first non-empty identifier in priority order.
    const candidates: [IdType, string | undefined][] = [
      ['isbn', isbn],
      ['oclc', oclc],
      ['lccn', lccn],
      ['issn', issn],
      ['recordnumber', recordnumber],
    ]
    const found = candidates.find(([, v]) => v && String(v).trim())
    if (!found) {
      return new Response(
        JSON.stringify({ found: false, error: 'No identifier provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const [idType, idValueRaw] = found
    const idValue = String(idValueRaw).replace(/[-\s]/g, '')

    const url = `https://catalog.hathitrust.org/api/volumes/full/${idType}/${encodeURIComponent(idValue)}.json`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'folio-app (catalog lookup)' },
    })

    if (!res.ok) {
      return new Response(
        JSON.stringify({ found: false, error: `HathiTrust ${res.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const data = await res.json()
    const records = data?.records || {}
    const recordIds = Object.keys(records)
    if (recordIds.length === 0) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // First record is the canonical one.
    const rec = records[recordIds[0]]
    const marc = typeof rec['marc-xml'] === 'string' ? parseMarc(rec['marc-xml']) : {
      publisher: null, pages: null, language: null, title: null, author: null, subjects: [],
    }

    const isbns: string[] = rec.isbns || []
    const isbn_13 = isbns.find((i) => i.replace(/[-\s]/g, '').length === 13)?.replace(/[-\s]/g, '') || null
    const isbn_10 = isbns.find((i) => i.replace(/[-\s]/g, '').length === 10)?.replace(/[-\s]/g, '') || null

    const title = stripMarc(rec.titles?.[0]) || marc.title || null
    const published_year = deriveYear(rec.publishDates)

    return new Response(
      JSON.stringify({
        found: true,
        source: 'hathitrust',
        record_id: recordIds[0],
        record_url: rec.recordURL || `https://catalog.hathitrust.org/Record/${recordIds[0]}`,
        title,
        author: marc.author,
        publisher: marc.publisher,
        published_year,
        pages: marc.pages,
        language: marc.language,
        isbn_13,
        isbn_10,
        oclcs: rec.oclcs || [],
        lccns: rec.lccns || [],
        subjects: marc.subjects,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('lookup-hathitrust error:', err)
    return new Response(
      JSON.stringify({ found: false, error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  }
})
