// Trailing tile in the mobile compact shelves on Profile. Renders either a
// "See all → / +N more" affordance when the shelf is collapsed past its cap,
// or a "Show less / Collapse" affordance when expanded. The tile matches the
// 64×96 dimensions of CurrentlyReadingBook so it sits flush in the wrap row.
export default function SeeAllTile({ expanded, remaining, onToggle, theme }) {
  return (
    <div
      onClick={onToggle}
      onTouchEnd={(e) => { e.preventDefault(); onToggle() }}
      style={{ cursor: 'pointer', textAlign: 'center', width: 64 }}
    >
      <div style={{
        width: 64, height: 96, borderRadius: 6, marginBottom: 6,
        border: `1px dashed ${theme.border}`, background: theme.bgSubtle,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, color: theme.textSubtle,
        lineHeight: 1.2, padding: '0 4px', textAlign: 'center',
      }}>
        {expanded ? <>Show<br />less</> : <>See all<br />→</>}
      </div>
      <div style={{ fontSize: 11, color: theme.textSubtle, lineHeight: 1.3 }}>
        {expanded ? 'Collapse' : `+${remaining} more`}
      </div>
    </div>
  )
}
