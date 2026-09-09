// Original, abstract per-domain guide characters — never a rendering of the real
// person/topic being taught (guardrail: no AI imagery depicting real, named
// people). Each is just a flat-illustration avatar + a small symbolic badge.
export const NARRATORS = {
  history: { accent: '#8B5E34', label: 'The Historian', badge: 'pillar' },
  science: { accent: '#4A7C6F', label: 'The Researcher', badge: 'flask' },
  'current-events': { accent: '#B5563C', label: 'The Correspondent', badge: 'bubble' },
  'arts-culture': { accent: '#7A5670', label: 'The Curator', badge: 'palette' },
}

export function narratorFor(domainSlug) {
  return NARRATORS[domainSlug] || { accent: '#6B4226', label: 'The Guide', badge: null }
}
