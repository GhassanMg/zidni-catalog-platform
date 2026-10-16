import { changedFields } from './changed-fields';
import { slugify } from './slugify';

describe('slugify', () => {
  it.each([
    ['  Home & Garden ', 'home-garden'],
    ['Électronique', 'electronique'],
    ['Toys_and--Games!!', 'toys-and-games'],
    ['كتب عربية', 'كتب-عربية'],
    ['ＦＵＬＬ　ＷＩＤＴＨ', 'full-width'],
    ['!!!', ''],
  ])('%j -> %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('caps the length without leaving a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(119)} b`);
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('changedFields', () => {
  it('lists keys whose values differ, comparing arrays and nested values by content', () => {
    expect(
      changedFields(
        { name: 'a', ids: ['1', '2'], price: '1.00', gone: true },
        { name: 'a', ids: ['1', '3'], price: '1.00', added: 1 },
      ),
    ).toEqual(['ids', 'gone', 'added']);
  });

  it('returns nothing for identical snapshots', () => {
    expect(changedFields({ a: [1], b: { c: 2 } }, { a: [1], b: { c: 2 } })).toEqual([]);
  });
});
