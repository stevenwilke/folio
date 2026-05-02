import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { preflight, serviceClient, escapeHtml, jsonResponse, jsonError, handleError, clientIp, rateLimitByIp } from '../_shared/auth.ts'

// Public contact form — intentionally unauth. Hardened with:
//   - HTML escape on every interpolated field (was raw — admin-inbox HTML
//     injection vector).
//   - Per-field length caps.
//   - Per-IP rate limit (round 10) — caps at 5 submissions/hour from the
//     same IP. Bypassable via IP rotation but raises the bar significantly.

const RATE_LIMIT_PER_HOUR = 5

const MAX_NAME    = 100
const MAX_EMAIL   = 200
const MAX_SUBJECT = 200
const MAX_MESSAGE = 5000

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre

  try {
    const supabase = serviceClient()
    await rateLimitByIp(supabase, clientIp(req), 'submit-contact', RATE_LIMIT_PER_HOUR)

    const body = await req.json()
    const name    = String(body.name    ?? '').trim().slice(0, MAX_NAME)
    const email   = String(body.email   ?? '').trim().slice(0, MAX_EMAIL)
    const subject = String(body.subject ?? '').trim().slice(0, MAX_SUBJECT)
    const message = String(body.message ?? '').trim().slice(0, MAX_MESSAGE)

    if (!name || !email || !message) {
      return jsonError('Name, email, and message are required.', 400, req)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError('Invalid email address.', 400, req)
    }
    const { data: settings } = await supabase
      .from('site_settings')
      .select('contact_email')
      .eq('id', 1)
      .single()

    const contactEmail = settings?.contact_email || 'steven411@gmail.com'

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not set')
      return jsonError('Email service not configured.', 500, req)
    }

    // All caller-supplied fields go through escapeHtml() before interpolation.
    const sName    = escapeHtml(name)
    const sEmail   = escapeHtml(email)
    const sSubject = escapeHtml(subject)
    const sMessage = escapeHtml(message)

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
                <div style="font-size: 16px; color: #1a1208; font-weight: 600;">${sName}</div>
                <div style="font-size: 14px; color: #5a4a3a;">${sEmail}</div>
              </div>
              ${subject ? `
                <div style="margin-bottom: 12px;">
                  <div style="font-size: 12px; color: #8a7f72; text-transform: uppercase; letter-spacing: 0.5px;">Subject</div>
                  <div style="font-size: 16px; color: #1a1208;">${sSubject}</div>
                </div>
              ` : ''}
              <div>
                <div style="font-size: 12px; color: #8a7f72; text-transform: uppercase; letter-spacing: 0.5px;">Message</div>
                <div style="font-size: 15px; color: #5a4a3a; line-height: 1.6; white-space: pre-wrap; margin-top: 4px;">${sMessage}</div>
              </div>
            </div>
            <p style="color: #9a8a7a; font-size: 12px; font-family: sans-serif;">
              Reply directly to this email to respond to ${sName}.
            </p>
          </div>
        `,
      }),
    })

    if (!emailRes.ok) {
      const errBody = await emailRes.text()
      console.error('Resend error:', errBody)
      return jsonError('Failed to send message.', 502, req)
    }

    return jsonResponse({ success: true }, req)
  } catch (err) {
    return handleError(err, req)
  }
})
