import { narratorFor } from '../lib/narrators'

const INK = '#3A2415'
const CREAM = '#F1E4CF'

function Badge({ kind, accent }) {
  // Small symbolic glyph per domain, drawn from primitive shapes — abstract,
  // not a depiction of any real person or object photograph.
  switch (kind) {
    case 'pillar':
      return (
        <g fill={INK}>
          <rect x="-7" y="-8" width="14" height="2" />
          <rect x="-6" y="-6" width="2" height="8" />
          <rect x="4" y="-6" width="2" height="8" />
          <rect x="-6" y="2" width="12" height="2" />
        </g>
      )
    case 'flask':
      return (
        <g>
          <rect x="-1.5" y="-8" width="3" height="5" fill={INK} />
          <polygon points="-1.5,-3 1.5,-3 5,7 -5,7" fill={INK} />
          <ellipse cx="0" cy="4.5" rx="3.5" ry="1.6" fill={accent} />
        </g>
      )
    case 'bubble':
      return (
        <g fill={INK}>
          <rect x="-7" y="-6" width="14" height="9" rx="3" />
          <polygon points="-2,3 2,3 0,7" />
          <rect x="-4.5" y="-3.5" width="9" height="1.3" fill={CREAM} />
          <rect x="-4.5" y="-1" width="6" height="1.3" fill={CREAM} />
        </g>
      )
    case 'palette':
      return (
        <g>
          <ellipse cx="0" cy="0" rx="8" ry="6" fill={INK} />
          <circle cx="4.5" cy="3" r="2.2" fill={CREAM} />
          <circle cx="-3" cy="-2" r="1.3" fill={accent} />
          <circle cx="1" cy="-3" r="1.3" fill={CREAM} />
          <circle cx="-2" cy="2" r="1.3" fill="#B5563C" />
        </g>
      )
    default:
      return null
  }
}

export function Narrator({ domainSlug, speaking }) {
  const { accent, label, badge } = narratorFor(domainSlug)

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="112" height="112" viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle cx="60" cy="60" r="56" fill={accent} />
        <circle cx="60" cy="64" r="38" fill={CREAM} />

        <g className="narrator-eyes">
          <ellipse cx="46" cy="58" rx="4" ry="5" fill={INK} />
          <ellipse cx="74" cy="58" rx="4" ry="5" fill={INK} />
        </g>

        <ellipse
          className={`narrator-mouth${speaking ? ' narrator-mouth--speaking' : ''}`}
          cx="60"
          cy="80"
          rx="9"
          ry="3.5"
          fill={INK}
          style={{ transformOrigin: '60px 80px' }}
        />

        {badge && (
          <g transform="translate(92, 30)">
            <circle r="16" fill={CREAM} stroke={accent} strokeWidth="2" />
            <Badge kind={badge} accent={accent} />
          </g>
        )}
      </svg>
      <span className="text-xs opacity-60">{label}</span>
    </div>
  )
}
