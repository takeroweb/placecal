// Plain data (no Node imports) so the browser-only build can seed the same defaults.
// Initial categories (spec §9). Colors are only defaults — users can change them.
export const DEFAULT_CATEGORIES = [
  { key: 'work', name: 'バイト', color: '#2f6fde' },
  { key: 'uni', name: '大学', color: '#1f9d55' },
  { key: 'play', name: '遊び', color: '#e8780c' },
  { key: 'study', name: '勉強', color: '#0e8f8f' },
  { key: 'gym', name: '運動', color: '#8a4fd8' },
  { key: 'other', name: 'その他', color: '#6b7280' },
];

// Starter templates so the very first screen is already usable.
export const DEFAULT_TEMPLATES = [
  { cat: 'work', title: 'バイト', start: '17:00', end: '22:00', location: '' },
  { cat: 'uni', title: '大学', start: '10:00', end: '12:00', location: '' },
  { cat: 'gym', title: '筋トレ', start: '19:00', end: '20:00', location: '' },
  { cat: 'study', title: '勉強', start: '20:00', end: '22:00', location: '' },
  { cat: 'play', title: '遊び', start: null, end: null, location: '' },
];
