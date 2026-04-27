import { supabase } from './supabase'
import { notify } from './notify'

/**
 * Find every active alert on this book whose max_price (if set) is >= the new
 * listing price, and fan out marketplace_alert notifications.
 */
export async function fireMarketAlerts(book, price, sellerId) {
  const { data: alerts } = await supabase
    .from('marketplace_alerts')
    .select('id, user_id, max_price')
    .eq('book_id', book.id)
    .eq('active', true)
  if (!alerts?.length) return

  const matched = alerts.filter(a =>
    a.user_id !== sellerId && (a.max_price == null || Number(price) <= Number(a.max_price))
  )
  if (!matched.length) return

  await Promise.allSettled(matched.map(a => notify(a.user_id, 'marketplace_alert', {
    title: 'Marketplace alert',
    body:  `"${book.title}" was just listed for $${Number(price).toFixed(2)}`,
    link:  `/book/${book.id}`,
    metadata: { book_id: book.id, price },
  })))

  await supabase
    .from('marketplace_alerts')
    .update({ last_fired_at: new Date().toISOString() })
    .in('id', matched.map(m => m.id))
}
