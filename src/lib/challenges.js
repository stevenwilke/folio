// Challenge progress computation

export function computeChallengeProgress(challenge, entries, sessions) {
  const now = new Date()
  const year = challenge.year
  const month = challenge.month // 1-12 or null

  // Filter entries/sessions to the challenge's time window
  const startDate = month
    ? new Date(year, month - 1, 1)
    : new Date(year, 0, 1)
  const endDate = month
    ? new Date(year, month, 0, 23, 59, 59)
    : new Date(year, 11, 31, 23, 59, 59)

  switch (challenge.challenge_type) {
    case 'books_count': {
      const booksRead = entries.filter(e => {
        if (!e.has_read && e.read_status !== 'read') return false
        const d = new Date(e.updated_at)
        return d >= startDate && d <= endDate
      }).length
      return { currentValue: booksRead, isComplete: booksRead >= challenge.target_value }
    }

    case 'pages_count': {
      const pagesRead = sessions
        .filter(s => {
          if (s.status !== 'completed' || !s.pages_read) return false
          const d = new Date(s.ended_at)
          return d >= startDate && d <= endDate
        })
        .reduce((sum, s) => sum + s.pages_read, 0)
      return { currentValue: pagesRead, isComplete: pagesRead >= challenge.target_value }
    }

    case 'genre_diversity': {
      const genres = new Set()
      entries.forEach(e => {
        if (!e.has_read && e.read_status !== 'read') return
        const d = new Date(e.updated_at)
        if (d >= startDate && d <= endDate && e.books?.genre) {
          genres.add(e.books.genre)
        }
      })
      return { currentValue: genres.size, isComplete: genres.size >= challenge.target_value }
    }

    case 'streak_days': {
      const sessionDates = new Set(
        sessions
          .filter(s => s.status === 'completed' && s.ended_at)
          .map(s => s.ended_at.slice(0, 10))
      )
      let streak = 0
      let check = now.toISOString().slice(0, 10)
      while (sessionDates.has(check)) {
        streak++
        const d = new Date(check)
        d.setDate(d.getDate() - 1)
        check = d.toISOString().slice(0, 10)
      }
      // Also check starting from yesterday
      if (streak === 0) {
        const yesterday = new Date(now)
        yesterday.setDate(yesterday.getDate() - 1)
        check = yesterday.toISOString().slice(0, 10)
        while (sessionDates.has(check)) {
          streak++
          const d = new Date(check)
          d.setDate(d.getDate() - 1)
          check = d.toISOString().slice(0, 10)
        }
      }
      return { currentValue: streak, isComplete: streak >= challenge.target_value }
    }

    default:
      return { currentValue: challenge.current_value, isComplete: challenge.current_value >= challenge.target_value }
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export function generateMonthlyChallenges(entries, sessions) {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const monthName = MONTH_NAMES[month - 1]

  // Calculate past monthly averages for calibration
  const monthlyBooks = {}
  entries.forEach(e => {
    if (!e.has_read && e.read_status !== 'read') return
    const d = new Date(e.updated_at)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    monthlyBooks[key] = (monthlyBooks[key] || 0) + 1
  })
  const avgBooks = Object.values(monthlyBooks).length
    ? Math.round(Object.values(monthlyBooks).reduce((a, b) => a + b, 0) / Object.values(monthlyBooks).length)
    : 2

  const monthlyPages = {}
  sessions.forEach(s => {
    if (s.status !== 'completed' || !s.pages_read || !s.ended_at) return
    const d = new Date(s.ended_at)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    monthlyPages[key] = (monthlyPages[key] || 0) + s.pages_read
  })
  const avgPages = Object.values(monthlyPages).length
    ? Math.round(Object.values(monthlyPages).reduce((a, b) => a + b, 0) / Object.values(monthlyPages).length)
    : 300

  return [
    {
      title: `Read ${avgBooks + 1} books in ${monthName}`,
      description: `Push past your monthly average of ${avgBooks} books`,
      challenge_type: 'books_count',
      target_value: avgBooks + 1,
      month,
      year,
      is_system: true,
    },
    {
      title: `Read ${Math.ceil(avgPages * 1.2)} pages in ${monthName}`,
      description: 'Beat your average monthly page count by 20%',
      challenge_type: 'pages_count',
      target_value: Math.ceil(avgPages * 1.2),
      month,
      year,
      is_system: true,
    },
    {
      title: '7-day reading streak',
      description: 'Read every day for a week straight',
      challenge_type: 'streak_days',
      target_value: 7,
      month,
      year,
      is_system: true,
    },
  ]
}
