import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKET = 'book-covers'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { book_id, cover_url } = await req.json()

    if (!book_id || !cover_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'book_id and cover_url are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Create Supabase client with service role key (full storage access)
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase     = createClient(supabaseUrl, serviceKey)

    // Download the cover image
    const imgRes = await fetch(cover_url, {
      headers: { 'User-Agent': 'folio-app/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!imgRes.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to fetch image: ${imgRes.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) {
      return new Response(
        JSON.stringify({ success: false, error: `Not an image: ${contentType}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const ext        = contentType.includes('png') ? 'png' : 'jpg'
    const path       = `${book_id}.${ext}`
    const arrayBuf   = await imgRes.arrayBuffer()
    const bytes      = new Uint8Array(arrayBuf)

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return new Response(
        JSON.stringify({ success: false, error: uploadError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

    // Update the books table with the new self-hosted URL
    const { error: updateError } = await supabase
      .from('books')
      .update({ cover_image_url: publicUrl })
      .eq('id', book_id)

    if (updateError) {
      console.error('Books update error:', updateError)
    }

    return new Response(
      JSON.stringify({ success: true, url: publicUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Unhandled error:', err)
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
