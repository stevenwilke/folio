import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const url    = new URL(req.url)
  const action = url.searchParams.get('action')
  const token  = url.searchParams.get('token')

  if (!token || !action || !['approve', 'reject'].includes(action)) {
    return html('Invalid Link', 'This link is invalid or malformed.', false)
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Look up the pending submission by its one-time review token
  const { data: pending, error } = await supabaseAdmin
    .from('pending_covers')
    .select('id, book_id, storage_path, status')
    .eq('review_token', token)
    .single()

  if (error || !pending) {
    return html('Not Found', 'This review link is invalid or has already been used.', false)
  }

  if (pending.status !== 'pending') {
    return html(
      'Already Reviewed',
      `This cover was already ${pending.status}.`,
      pending.status === 'approved'
    )
  }

  const now = new Date().toISOString()

  if (action === 'approve') {
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
    const publicUrl    = `${supabaseUrl}/storage/v1/object/public/book-covers/${pending.storage_path}`

    // Write the cover URL to the shared books table — visible to all users
    await supabaseAdmin
      .from('books')
      .update({ cover_image_url: publicUrl })
      .eq('id', pending.book_id)

    await supabaseAdmin
      .from('pending_covers')
      .update({ status: 'approved', reviewed_at: now })
      .eq('id', pending.id)

    return html(
      'Cover Approved ✓',
      'The book cover is now live and visible to all users.',
      true
    )
  } else {
    // Reject: remove the uploaded file and mark rejected
    await supabaseAdmin.storage
      .from('book-covers')
      .remove([pending.storage_path])

    await supabaseAdmin
      .from('pending_covers')
      .update({ status: 'rejected', reviewed_at: now })
      .eq('id', pending.id)

    return html(
      'Cover Rejected',
      'The submission has been rejected and the file removed.',
      false
    )
  }
})

function html(title: string, message: string, success: boolean): Response {
  const accent = success ? '#5a7a5a' : '#c0521e'
  const icon   = success ? '✓' : '✗'
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Folio</title>
</head>
<body style="margin:0;background:#f5f0e8;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif;">
  <div style="background:#fdfaf4;border:1px solid #d4c9b0;border-radius:16px;padding:48px 40px;max-width:440px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(26,18,8,0.1);">
    <div style="font-size:52px;margin-bottom:16px;">${icon}</div>
    <h1 style="font-family:Georgia,serif;color:${accent};margin:0 0 12px;font-size:24px;">${title}</h1>
    <p style="color:#6b5f52;font-size:15px;line-height:1.6;margin:0;">${message}</p>
  </div>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
