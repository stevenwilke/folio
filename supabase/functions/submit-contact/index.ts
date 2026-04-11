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
    const { name, email, subject, message } = await req.json()

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: 'Name, email, and message are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the contact email from site_settings
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: settings } = await supabase
      .from('site_settings')
      .select('contact_email')
      .eq('id', 1)
      .single()

    const contactEmail = settings?.contact_email || 'steven411@gmail.com'

    // Send via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not set')
      return new Response(
        JSON.stringify({ error: 'Email service not configured.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Ex Libris <noreply@exlibrisomnium.com>',
        to: contactEmail,
        reply_to: email,
        subject: `[Ex Libris Contact] ${subject || 'New Message'}`,
        html: `
          <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f5f0e8;">
            <h1 style="color: #1a1208; font-size: 24px;">📬 Contact Form</h1>
            <div style="background: white; border-radius: 12px; padding: 20px; margin: 20px 0;">
              <div style="margin-bottom: 12px;">
                <div style="font-size: 12px; color: #8a7f72; text-transform: uppercase; letter-spacing: 0.5px;">From</div>
                <div style="font-size: 16px; color: #1a1208; font-weight: 600;">${name}</div>
                <div style="font-size: 14px; color: #5a4a3a;">${email}</div>
              </div>
              ${subject ? `
                <div style="margin-bottom: 12px;">
                  <div style="font-size: 12px; color: #8a7f72; text-transform: uppercase; letter-spacing: 0.5px;">Subject</div>
                  <div style="font-size: 16px; color: #1a1208;">${subject}</div>
                </div>
              ` : ''}
              <div>
                <div style="font-size: 12px; color: #8a7f72; text-transform: uppercase; letter-spacing: 0.5px;">Message</div>
                <div style="font-size: 15px; color: #5a4a3a; line-height: 1.6; white-space: pre-wrap; margin-top: 4px;">${message}</div>
              </div>
            </div>
            <p style="color: #9a8a7a; font-size: 12px; font-family: sans-serif;">
              Reply directly to this email to respond to ${name}.
            </p>
          </div>
        `,
      }),
    })

    if (!emailRes.ok) {
      const errBody = await emailRes.text()
      console.error('Resend error:', errBody)
      return new Response(
        JSON.stringify({ error: 'Failed to send message.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Unhandled error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
