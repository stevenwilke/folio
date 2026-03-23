export const Colors = {
  // Backgrounds
  background: '#f5f0e8',
  card: '#fdfaf4',

  // Accents
  rust: '#c0521e',
  sage: '#5a7a5a',
  gold: '#b8860b',

  // Text
  ink: '#1a1208',
  muted: '#8a7f72',

  // Borders
  border: '#d4c9b0',

  // Status colors
  status: {
    owned: '#5a7a5a',   // sage green — In Library
    read: '#b8860b',    // gold — Read
    reading: '#c0521e', // rust — Reading
    want: '#6b7280',    // gray — Want to Read
  },

  // Status backgrounds (light tints)
  statusBg: {
    owned: '#eef3ee',
    read: '#fef9e7',
    reading: '#fdf0ea',
    want: '#f3f4f6',
  },

  // Utility
  white: '#ffffff',
  black: '#000000',
  error: '#dc2626',
  success: '#16a34a',

  // Tab bar
  tabActive: '#c0521e',
  tabInactive: '#8a7f72',
} as const;

export type ColorKey = keyof typeof Colors;
