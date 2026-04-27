import { supabase } from './supabase'
import { notify } from './notify'

const POST_TYPE_LABELS = {
  update:       'Update',
  giveaway:     'Giveaway',
  announcement: 'Announcement',
  new_book:     'New Book',
}

/**
 * Insert an author_posts row and notify all followers.
 *
 * @param {object} args
 * @param {string} args.authorId
 * @param {string} args.authorName       Display name for the notification body.
 * @param {string} args.type             update | giveaway | announcement | new_book
 * @param {string} args.title            Optional.
 * @param {string} args.content          Required.
 * @param {string} args.linkUrl          Optional.
 * @returns {{ data: object|null, error: any }}
 */
export async function createAuthorPost({ authorId, authorName, type, title, content, linkUrl }) {
  const { data, error } = await supabase
    .from('author_posts')
    .insert({
      author_id: authorId,
      type,
      title:    title?.trim() || null,
      content,
      link_url: linkUrl?.trim() || null,
    })
    .select('*')
    .single()

  if (error || !data) return { data: null, error }

  // Fan out to followers in the background — don't block the UI.
  notifyAuthorFollowers(authorId, authorName, type, title, content).catch(err => {
    console.error('[createAuthorPost] follower notify failed:', err)
  })

  return { data, error: null }
}

async function notifyAuthorFollowers(authorId, authorName, type, title, content) {
  const { data: follows } = await supabase
    .from('author_follows')
    .select('user_id')
    .eq('author_id', authorId)
  if (!follows?.length) return

  const typeLabel = POST_TYPE_LABELS[type] || 'Update'
  const preview = (title?.trim() || content || '').slice(0, 140)

  await Promise.allSettled(follows.map(f => notify(f.user_id, 'author_post', {
    title: `${authorName}: ${typeLabel}`,
    body:  preview,
    link:  `/author/${encodeURIComponent(authorName)}`,
    metadata: { author_id: authorId, post_type: type },
  })))
}
