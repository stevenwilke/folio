// Run this SQL in Supabase:
// create table book_tags (
//   id uuid primary key default gen_random_uuid(),
//   user_id uuid references auth.users not null,
//   book_id uuid references books(id) not null,
//   tag text not null,
//   created_at timestamptz default now(),
//   unique(user_id, book_id, tag)
// );
// alter table book_tags enable row level security;
// create policy "Users manage own tags" on book_tags for all using (auth.uid() = user_id);

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const SUGGESTIONS = ['favorites', 'to-buy', 'book club', 'summer reads', 'classics', 'gift ideas']

const TAG_COLORS = [
  { bg: 'rgba(192,82,30,0.12)',   color: '#c0521e' },
  { bg: 'rgba(90,122,90,0.15)',   color: '#5a7a5a' },
  { bg: 'rgba(184,134,11,0.12)', color: '#b8860b' },
  { bg: 'rgba(74,107,138,0.15)', color: '#4a6b8a' },
  { bg: 'rgba(138,127,114,0.15)', color: '#8a7f72' },
  { bg: 'rgba(139,37,0,0.12)',    color: '#8b2500' },
]

function tagColor(tag) {
  return TAG_COLORS[tag.charCodeAt(0) % TAG_COLORS.length]
}

const MAX_TAGS = 10

export default function BookTagsManager({ bookId, userId, theme }) {
  const [tags, setTags]       = useState([])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (bookId && userId) fetchTags()
  }, [bookId, userId])

  async function fetchTags() {
    setLoading(true)
    const { data } = await supabase
      .from('book_tags')
      .select('tag')
      .eq('user_id', userId)
      .eq('book_id', bookId)
      .order('created_at', { ascending: true })
    setTags((data || []).map(r => r.tag))
    setLoading(false)
  }

  async function addTag(raw) {
    const tag = raw.trim().toLowerCase()
    if (!tag) return
    if (tags.includes(tag)) {
      setError('Tag already added.')
      return
    }
    if (tags.length >= MAX_TAGS) {
      setError(`Maximum ${MAX_TAGS} tags per book.`)
      return
    }
    setError('')
    const { error: err } = await supabase
      .from('book_tags')
      .insert({ user_id: userId, book_id: bookId, tag })
    if (err) {
      setError('Could not add tag. Please try again.')
    } else {
      setInput('')
      await fetchTags()
    }
  }

  async function removeTag(tag) {
    setError('')
    await supabase
      .from('book_tags')
      .delete()
      .eq('user_id', userId)
      .eq('book_id', bookId)
      .eq('tag', tag)
    setTags(prev => prev.filter(t => t !== tag))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(input)
    }
  }

  const suggestions = SUGGESTIONS.filter(s => !tags.includes(s))

  const s = {
    section: {
      marginTop: 28,
      padding: '18px 20px',
      background: theme.bgSubtle,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
    },
    heading: {
      fontFamily: "'DM Sans', sans-serif",
      fontSize: 13,
      fontWeight: 700,
      color: theme.text,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    },
    pillRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 12,
    },
    pill: (tag) => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px 3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 500,
      fontFamily: "'DM Sans', sans-serif",
      background: tagColor(tag).bg,
      color: tagColor(tag).color,
      border: `1px solid ${tagColor(tag).color}33`,
    }),
    pillX: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      fontSize: 13,
      lineHeight: 1,
      padding: '0 0 0 2px',
      color: 'inherit',
      opacity: 0.7,
      fontFamily: 'inherit',
    },
    inputRow: {
      display: 'flex',
      gap: 6,
      marginBottom: 10,
    },
    input: {
      flex: 1,
      padding: '6px 12px',
      border: `1px solid ${theme.border}`,
      borderRadius: 8,
      fontSize: 13,
      fontFamily: "'DM Sans', sans-serif",
      outline: 'none',
      background: theme.bgCard,
      color: theme.text,
    },
    addBtn: {
      padding: '6px 14px',
      background: theme.rust,
      color: 'white',
      border: 'none',
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: "'DM Sans', sans-serif",
    },
    suggestLabel: {
      fontSize: 11,
      color: theme.textSubtle,
      marginBottom: 6,
      fontFamily: "'DM Sans', sans-serif",
    },
    suggestRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
    },
    suggestChip: {
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontFamily: "'DM Sans', sans-serif",
      background: 'transparent',
      border: `1px solid ${theme.border}`,
      color: theme.textSubtle,
      cursor: 'pointer',
    },
    error: {
      fontSize: 12,
      color: '#c0392b',
      marginBottom: 8,
      fontFamily: "'DM Sans', sans-serif",
    },
    loadingText: {
      fontSize: 13,
      color: theme.textSubtle,
      fontStyle: 'italic',
      fontFamily: "'DM Sans', sans-serif",
    },
  }

  return (
    <div style={s.section}>
      <div style={s.heading}>
        <span>🏷️</span> My Tags
      </div>

      {loading ? (
        <div style={s.loadingText}>Loading tags…</div>
      ) : (
        <>
          {/* Existing tag pills */}
          {tags.length > 0 && (
            <div style={s.pillRow}>
              {tags.map(tag => (
                <span key={tag} style={s.pill(tag)}>
                  {tag}
                  <button
                    style={s.pillX}
                    onClick={() => removeTag(tag)}
                    title={`Remove "${tag}"`}
                    aria-label={`Remove tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Error message */}
          {error && <div style={s.error}>{error}</div>}

          {/* Input row */}
          {tags.length < MAX_TAGS && (
            <div style={s.inputRow}>
              <input
                type="text"
                value={input}
                onChange={e => { setInput(e.target.value); setError('') }}
                onKeyDown={handleKeyDown}
                placeholder="Add a tag…"
                style={s.input}
                maxLength={40}
              />
              <button
                style={{ ...s.addBtn, opacity: input.trim() ? 1 : 0.5 }}
                onClick={() => addTag(input)}
                disabled={!input.trim()}
              >
                Add
              </button>
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && tags.length < MAX_TAGS && (
            <>
              <div style={s.suggestLabel}>Suggestions:</div>
              <div style={s.suggestRow}>
                {suggestions.map(suggestion => (
                  <button
                    key={suggestion}
                    style={s.suggestChip}
                    onClick={() => addTag(suggestion)}
                  >
                    + {suggestion}
                  </button>
                ))}
              </div>
            </>
          )}

          {tags.length >= MAX_TAGS && (
            <div style={s.error}>
              Maximum of {MAX_TAGS} tags reached.
            </div>
          )}
        </>
      )}
    </div>
  )
}
