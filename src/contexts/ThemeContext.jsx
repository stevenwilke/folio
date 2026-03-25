import { createContext, useContext, useState, useEffect } from 'react'
import { lightTheme, darkTheme } from '../theme'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem('folio-theme') === 'dark' } catch { return false }
  })

  useEffect(() => {
    localStorage.setItem('folio-theme', isDark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    document.body.style.background = isDark ? darkTheme.bg : lightTheme.bg
  }, [isDark])

  const theme = isDark ? darkTheme : lightTheme
  const toggleTheme = () => setIsDark(d => !d)

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
