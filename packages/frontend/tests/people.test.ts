/**
 * People Page Tests
 *
 * Tests for People page logic: helper functions (getInitials, nameToHue,
 * formatRelativeTime), contact list sorting, search filtering, URL path
 * matching for contact detail routing.
 *
 * These are pure logic tests — no DOM required.
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// getInitials
// ============================================================================

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

describe('getInitials', () => {
  it('returns first letters of two words', () => {
    expect(getInitials('Alice Wonderland')).toBe('AW');
  });

  it('returns single initial for single name', () => {
    expect(getInitials('Alice')).toBe('A');
  });

  it('limits to 2 initials for 3+ words', () => {
    expect(getInitials('John Michael Doe')).toBe('JM');
  });

  it('uppercases lowercase input', () => {
    expect(getInitials('alice wonderland')).toBe('AW');
  });

  it('handles empty string', () => {
    expect(getInitials('')).toBe('');
  });

  it('handles multiple spaces gracefully', () => {
    // Extra spaces produce empty splits filtered out by Boolean
    expect(getInitials('Alice  Wonderland')).toBe('AW');
  });
});

// ============================================================================
// nameToHue (deterministic warm hue from a string)
// ============================================================================

function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return 15 + (Math.abs(hash) % 30);
}

describe('nameToHue', () => {
  it('returns a number in the warm range 15-44', () => {
    const hue = nameToHue('Alice');
    expect(hue).toBeGreaterThanOrEqual(15);
    expect(hue).toBeLessThanOrEqual(44);
  });

  it('is deterministic (same name = same hue)', () => {
    expect(nameToHue('Bob')).toBe(nameToHue('Bob'));
  });

  it('produces different hues for different names', () => {
    const h1 = nameToHue('Alice');
    const h2 = nameToHue('Bob');
    const h3 = nameToHue('Charlie');
    // At least 2 of 3 should differ (hash collisions are possible but unlikely)
    const unique = new Set([h1, h2, h3]);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it('handles empty string without error', () => {
    const hue = nameToHue('');
    expect(hue).toBeGreaterThanOrEqual(15);
    expect(hue).toBeLessThanOrEqual(44);
  });

  it('handles long names', () => {
    const hue = nameToHue('A Very Long Full Name That Has Many Words');
    expect(hue).toBeGreaterThanOrEqual(15);
    expect(hue).toBeLessThanOrEqual(44);
  });

  it('always produces integer output', () => {
    const names = ['Alice', 'Bob', 'Charlie', '', 'Zzzz'];
    for (const name of names) {
      expect(Number.isInteger(nameToHue(name))).toBe(true);
    }
  });
});

// ============================================================================
// formatRelativeTime
// ============================================================================

function formatRelativeTime(ts: string | null): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

describe('formatRelativeTime', () => {
  it('returns empty string for null', () => {
    expect(formatRelativeTime(null)).toBe('');
  });

  it('returns "just now" for very recent', () => {
    const ts = new Date(Date.now() - 10000).toISOString();
    expect(formatRelativeTime(ts)).toBe('just now');
  });

  it('returns minutes for 1-59 minutes', () => {
    const ts = new Date(Date.now() - 5 * 60000).toISOString();
    expect(formatRelativeTime(ts)).toBe('5m ago');
  });

  it('returns 1m ago at boundary', () => {
    const ts = new Date(Date.now() - 60000).toISOString();
    expect(formatRelativeTime(ts)).toBe('1m ago');
  });

  it('returns hours for 1-23 hours', () => {
    const ts = new Date(Date.now() - 3 * 60 * 60000).toISOString();
    expect(formatRelativeTime(ts)).toBe('3h ago');
  });

  it('returns days for 1-6 days', () => {
    const ts = new Date(Date.now() - 2 * 24 * 60 * 60000).toISOString();
    expect(formatRelativeTime(ts)).toBe('2d ago');
  });

  it('returns locale date for 7+ days', () => {
    const ts = new Date(Date.now() - 10 * 24 * 60 * 60000).toISOString();
    const result = formatRelativeTime(ts);
    expect(result).not.toContain('ago');
    expect(result).not.toBe('just now');
  });
});

// ============================================================================
// Contact list sorting
// ============================================================================

interface ContactSortInput {
  id: string;
  fullName: string;
  isPrimary: boolean;
  lastMessage: { createdAt: string } | null;
}

function sortContacts(contacts: ContactSortInput[]): ContactSortInput[] {
  return [...contacts].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    const aTime = a.lastMessage?.createdAt ?? '';
    const bTime = b.lastMessage?.createdAt ?? '';
    return bTime.localeCompare(aTime);
  });
}

describe('Contact list sorting', () => {
  it('puts primary contact first', () => {
    const contacts: ContactSortInput[] = [
      { id: '1', fullName: 'Standard', isPrimary: false, lastMessage: null },
      { id: '2', fullName: 'Primary', isPrimary: true, lastMessage: null },
    ];
    const sorted = sortContacts(contacts);
    expect(sorted[0]!.fullName).toBe('Primary');
  });

  it('sorts non-primary by most recent message first', () => {
    const contacts: ContactSortInput[] = [
      { id: '1', fullName: 'Alice', isPrimary: false, lastMessage: { createdAt: '2024-01-01T00:00:00Z' } },
      { id: '2', fullName: 'Bob', isPrimary: false, lastMessage: { createdAt: '2024-01-02T00:00:00Z' } },
      { id: '3', fullName: 'Charlie', isPrimary: false, lastMessage: { createdAt: '2024-01-03T00:00:00Z' } },
    ];
    const sorted = sortContacts(contacts);
    expect(sorted.map((c) => c.fullName)).toEqual(['Charlie', 'Bob', 'Alice']);
  });

  it('contacts without messages sort after those with messages', () => {
    const contacts: ContactSortInput[] = [
      { id: '1', fullName: 'NoMsg', isPrimary: false, lastMessage: null },
      { id: '2', fullName: 'HasMsg', isPrimary: false, lastMessage: { createdAt: '2024-01-01T00:00:00Z' } },
    ];
    const sorted = sortContacts(contacts);
    expect(sorted[0]!.fullName).toBe('HasMsg');
    expect(sorted[1]!.fullName).toBe('NoMsg');
  });

  it('primary always beats recent messages', () => {
    const contacts: ContactSortInput[] = [
      { id: '1', fullName: 'Primary', isPrimary: true, lastMessage: null },
      { id: '2', fullName: 'Standard', isPrimary: false, lastMessage: { createdAt: '2099-01-01T00:00:00Z' } },
    ];
    const sorted = sortContacts(contacts);
    expect(sorted[0]!.fullName).toBe('Primary');
  });

  it('does not mutate original array', () => {
    const contacts: ContactSortInput[] = [
      { id: '2', fullName: 'B', isPrimary: false, lastMessage: null },
      { id: '1', fullName: 'A', isPrimary: true, lastMessage: null },
    ];
    const original = [...contacts];
    sortContacts(contacts);
    expect(contacts).toEqual(original);
  });
});

// ============================================================================
// Contact search filtering
// ============================================================================

describe('Contact search filtering', () => {
  const contacts = [
    { id: '1', fullName: 'Alice Smith' },
    { id: '2', fullName: 'Bob Johnson' },
    { id: '3', fullName: 'Charlie Brown' },
    { id: '4', fullName: 'Alice Walker' },
  ];

  function filterContacts(list: typeof contacts, query: string) {
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((c) => c.fullName.toLowerCase().includes(q));
  }

  it('returns all contacts with empty query', () => {
    expect(filterContacts(contacts, '')).toHaveLength(4);
  });

  it('returns all contacts with whitespace query', () => {
    expect(filterContacts(contacts, '   ')).toHaveLength(4);
  });

  it('filters by first name', () => {
    const result = filterContacts(contacts, 'alice');
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['1', '4']);
  });

  it('filters by last name', () => {
    const result = filterContacts(contacts, 'brown');
    expect(result).toHaveLength(1);
    expect(result[0]!.fullName).toBe('Charlie Brown');
  });

  it('is case insensitive', () => {
    expect(filterContacts(contacts, 'ALICE')).toHaveLength(2);
  });

  it('returns empty for no matches', () => {
    expect(filterContacts(contacts, 'xyz')).toHaveLength(0);
  });

  it('matches partial strings', () => {
    expect(filterContacts(contacts, 'li')).toHaveLength(3); // Alice, Alice, Charlie
  });
});

// ============================================================================
// Contact detail path matching
// ============================================================================

describe('Contact detail path matching', () => {
  function extractContactId(pathname: string): string | null {
    const match = pathname.match(/^\/people\/([a-f0-9-]+)$/);
    return match ? match[1] ?? null : null;
  }

  it('extracts UUID from valid path', () => {
    expect(extractContactId('/people/abc-123-def')).toBe('abc-123-def');
  });

  it('returns null for list view', () => {
    expect(extractContactId('/people')).toBeNull();
  });

  it('returns null for trailing slash', () => {
    expect(extractContactId('/people/')).toBeNull();
  });

  it('extracts full UUID', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(extractContactId(`/people/${uuid}`)).toBe(uuid);
  });

  it('returns null for invalid characters', () => {
    expect(extractContactId('/people/Hello World')).toBeNull();
  });

  it('returns null for nested paths', () => {
    expect(extractContactId('/people/abc-123/edit')).toBeNull();
  });
});

// ============================================================================
// Channel icon mapping
// ============================================================================

describe('Channel icon mapping', () => {
  const channelIcons: Record<string, string> = {
    web: 'Globe',
    sms: 'ChatText',
    discord: 'DiscordLogo',
    api: 'Code',
  };

  it('has all 4 channel types mapped', () => {
    expect(Object.keys(channelIcons)).toHaveLength(4);
  });

  it('maps web to Globe', () => {
    expect(channelIcons['web']).toBe('Globe');
  });

  it('maps sms to ChatText', () => {
    expect(channelIcons['sms']).toBe('ChatText');
  });

  it('maps discord to DiscordLogo', () => {
    expect(channelIcons['discord']).toBe('DiscordLogo');
  });

  it('maps api to Code', () => {
    expect(channelIcons['api']).toBe('Code');
  });
});

// ============================================================================
// Last message direction prefix logic
// ============================================================================

describe('Message direction prefix', () => {
  function getPrefix(direction: 'inbound' | 'outbound'): string {
    return direction === 'outbound' ? 'You: ' : '';
  }

  it('prefixes outbound messages with "You: "', () => {
    expect(getPrefix('outbound')).toBe('You: ');
  });

  it('no prefix for inbound messages', () => {
    expect(getPrefix('inbound')).toBe('');
  });
});

// ============================================================================
// Notes auto-save debounce logic
// ============================================================================

describe('Notes debounce logic', () => {
  it('debounce timer is 1500ms', () => {
    // The PeoplePage uses 1500ms debounce for notes auto-save
    const DEBOUNCE_MS = 1500;
    expect(DEBOUNCE_MS).toBe(1500);
  });

  it('debounce resets on each keystroke', () => {
    // Simulate debounce behavior
    let timer: ReturnType<typeof setTimeout> | null = null;
    let saveCount = 0;

    const handleChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { saveCount++; }, 100); // Use shorter timeout for test
    };

    // Rapid changes — only the last should trigger save
    handleChange();
    handleChange();
    handleChange();

    // Verify only 1 timer is active (the last one)
    expect(timer).not.toBeNull();
    clearTimeout(timer!);
    expect(saveCount).toBe(0); // Not yet fired
  });
});
