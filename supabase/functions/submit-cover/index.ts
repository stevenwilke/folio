import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Authenticate the calling user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { bookId, storagePath } = await req.json()
    if (!bookId || !storagePath) {
      return new Response(
        JSON.stringify({ error: 'Missing bookId or storagePath' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify book exists and has no cover
    const { data: book, error: bookError } = await supabaseAdmin
      .from('books')
      .select('id, title, author, cover_image_url')
      .eq('id', bookId)
      .single()

    if (bookError || !book) {
      return new Response(
        JSON.stringify({ error: 'Book not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (book.cover_image_url) {
      return new Response(
        JSON.stringify({ error: 'This book already has a cover' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Insert pending cover row (unique partial index prevents duplicate pending submissions)
    const { data: pending, error: insertError } = await supabaseAdmin
      .from('pending_covers')
      .insert({ book_id: bookId, user_id: user.id, storage_path: storagePath })
      .select('id, review_token')
      .single()

    if (insertError) {
      // Unique constraint violation — a submission is already pending for this book
      if (insertError.code === '23505') {
        return new Response(
          JSON.stringify({ error: 'A cover is already pending review for this book' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      throw insertError
    }

    // Build URLs
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const coverPublicUrl = `${supabaseUrl}/storage/v1/object/public/book-covers/${storagePath}`
    const functionBase  = `${supabaseUrl}/functions/v1/review-cover`
    const approveUrl    = `${functionBase}?action=approve&token=${pending.review_token}`
    const rejectUrl     = `${functionBase}?action=reject&token=${pending.review_token}`

    // Send review email via Resend
    const resendKey  = Deno.env.get('RESEND_API_KEY')
    const adminEmail = Deno.env.get('ADMIN_EMAIL')
    const fromEmail  = Deno.env.get('FROM_EMAIL') ?? 'Folio <noreply@getfolio.app>'

    if (resendKey && adminEmail) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: adminEmail,
          subject: `[Folio] Cover submission: "${book.title}"`,
          html: `
            <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1208; background: #f5f0e8; padding: 32px; border-radius: 12px;">
              <h2 style="font-family: Georgia, serif; margin: 0 0 4px;">New Book Cover Submission</h2>
              <p style="color: #8a7f72; margin: 0 0 24px; font-size: 14px;">Submitted by ${user.email}</p>

              <p style="margin: 0 0 6px;"><strong>Book:</strong> ${book.title}</p>
              <p style="margin: 0 0 24px;"><strong>Author:</strong> ${book.author ?? 'Unknown'}</p>

              <img src="${coverPublicUrl}" alt="Submitted cover"
                style="display: block; max-width: 180px; border-radius: 6px; box-shadow: 2px 3px 12px rgba(0,0,0,0.2); margin-bottom: 28px;" />

              <div style="display: flex; gap: 12px;">
                <a href="${approveUrl}"
                  style="display: inline-block; background: #5a7a5a; color: white; padding: 12px 28px;
                         text-decoration: none; border-radius: 8px; font-weight: 600; margin-right: 12px;">
                  ✓ Approve
                </a>
                <a href="${rejectUrl}"
                  style="display: inline-block; background: #c0521e; color: white; padding: 12px 28px;
                         text-decoration: none; border-radius: 8px; font-weight: 600;">
                  ✗ Reject
                </a>
              </div>
            </div>
          `,
        }),
      })
    }

    return new Response(
      JSON.stringify({ success: true, pendingId: pending.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('submit-cover error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
