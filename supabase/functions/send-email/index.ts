import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_TEMPLATES: Record<string, (data: Record<string, string>) => { subject: string; html: string }> = {
  friend_request: (data) => ({
    subject: `${data.fromUsername} wants to be your friend on Folio`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f5f0e8;">
        <h1 style="color: #1a1208; font-size: 24px;">📚 Friend Request</h1>
        <p style="color: #5a4a3a; font-size: 16px; line-height: 1.6;">
          <strong>${data.fromUsername}</strong> wants to be your friend on Folio.
        </p>
        <a href="${data.appUrl}/friends" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #c0521e; color: white; text-decoration: none; border-radius: 8px; font-family: sans-serif; font-weight: 600;">
          View Friend Request
        </a>
        <p style="margin-top: 32px; color: #9a8a7a; font-size: 12px; font-family: sans-serif;">
          You're receiving this because you have an account on Folio.
        </p>
      </div>
    `,
  }),

  loan_request: (data) => ({
    subject: `${data.fromUsername} wants to borrow "${data.bookTitle}"`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f5f0e8;">
        <h1 style="color: #1a1208; font-size: 24px;">📖 Loan Request</h1>
        <p style="color: #5a4a3a; font-size: 16px; line-height: 1.6;">
          <strong>${data.fromUsername}</strong> would like to borrow your copy of <em>${data.bookTitle}</em>.
        </p>
        <a href="${data.appUrl}/loans" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #c0521e; color: white; text-decoration: none; border-radius: 8px; font-family: sans-serif; font-weight: 600;">
          View Loan Request
        </a>
        <p style="margin-top: 32px; color: #9a8a7a; font-size: 12px; font-family: sans-serif;">
          You're receiving this because you have an account on Folio.
        </p>
      </div>
    `,
  }),

  loan_accepted: (data) => ({
    subject: `${data.ownerUsername} accepted your loan request for "${data.bookTitle}"`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f5f0e8;">
        <h1 style="color: #1a1208; font-size: 24px;">✅ Loan Accepted!</h1>
        <p style="color: #5a4a3a; font-size: 16px; line-height: 1.6;">
          <strong>${data.ownerUsername}</strong> has accepted your request to borrow <em>${data.bookTitle}</em>.
          Reach out to arrange pickup!
        </p>
        <a href="${data.appUrl}/loans" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #c0521e; color: white; text-decoration: none; border-radius: 8px; font-family: sans-serif; font-weight: 600;">
          View My Loans
        </a>
        <p style="margin-top: 32px; color: #9a8a7a; font-size: 12px; font-family: sans-serif;">
          You're receiving this because you have an account on Folio.
        </p>
      </div>
    `,
  }),

  book_club_post: (data) => ({
    subject: `New message in ${data.clubName} on Folio`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f5f0e8;">
        <h1 style="color: #1a1208; font-size: 24px;">💬 ${data.clubName}</h1>
        <p style="color: #5a4a3a; font-size: 16px; line-height: 1.6;">
          <strong>${data.fromUsername}</strong> posted in your book club:
        </p>
        <blockquote style="margin: 16px 0; padding: 12px 16px; background: white; border-left: 3px solid #c0521e; color: #1a1208; font-size: 14px; border-radius: 0 8px 8px 0;">
          ${data.messagePreview}
        </blockquote>
        <a href="${data.appUrl}/clubs" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #c0521e; color: white; text-decoration: none; border-radius: 8px; font-family: sans-serif; font-weight: 600;">
          View Discussion
        </a>
        <p style="margin-top: 32px; color: #9a8a7a; font-size: 12px; font-family: sans-serif;">
          You're receiving this because you're a member of ${data.clubName} on Folio.
        </p>
      </div>
    `,
  }),

  reading_goal_achieved: (data) => ({
    subject: `🎉 You reached your reading goal on Folio!`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f5f0e8;">
        <h1 style="color: #1a1208; font-size: 24px;">🏆 Goal Achieved!</h1>
        <p style="color: #5a4a3a; font-size: 16px; line-height: 1.6;">
          Congratulations, <strong>${data.username}</strong>! You've read <strong>${data.booksRead} books</strong>
          and hit your goal of ${data.goalBooks} books for ${data.year}.
        </p>
        <a href="${data.appUrl}/stats" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #c0521e; color: white; text-decoration: none; border-radius: 8px; font-family: sans-serif; font-weight: 600;">
          View My Stats
        </a>
        <p style="margin-top: 32px; color: #9a8a7a; font-size: 12px; font-family: sans-serif;">
          You're receiving this because you have an account on Folio.
        </p>
      </div>
    `,
  }),
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to_user_id, type, data } = await req.json()

    if (!to_user_id || !type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to_user_id, type' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const template = EMAIL_TEMPLATES[type]
    if (!template) {
      return new Response(
        JSON.stringify({ error: `Unknown email type: ${type}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Use service role to read user email (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(to_user_id)
    if (userError || !user?.email) {
      return new Response(
        JSON.stringify({ error: 'User not found or has no email' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://folio.app'
    const templateData = { ...data, appUrl }
    const { subject, html } = template(templateData)

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Folio <noreply@folio.app>',
        to: user.email,
        subject,
        html,
      }),
    })

    const result = await emailRes.json()

    if (!emailRes.ok) {
      return new Response(
        JSON.stringify({ error: 'Resend API error', details: result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    return new Response(
      JSON.stringify({ sent: true, id: result.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
