export const capFor = id => ['cat_02', 'cat_10'].includes(id.slice(0, 6)) ? 31 : 21;
export const subkey = value => String(value ?? '').replace(/[.#$/\[\]]/g, '_');

// Completed responses plus durable, outstanding reservations consume capacity.
// Overflow is considered ONLY after all unused categories' capped pools fail.
export function assign(concepts, history, gender, random = Math.random) {
  const usedCats = new Set(history.map(x => x.category));
  const usedIds = new Set(history.map(x => x.concept_id));
  const usedSubs = new Set(history.map(x => subkey(x.subcategory)));
  const base = concepts.filter(c => !usedCats.has(c.category) && !usedIds.has(c.id));
  const capped = base.filter(c => c.total + c.reserved < capFor(c.id));
  let relaxed = false, overflow = false;
  let pool = capped.filter(c => !usedSubs.has(subkey(c.subcategory)));
  if (!pool.length) { pool = capped; relaxed = true; }
  if (!pool.length) {
    overflow = true; relaxed = false;
    pool = base.filter(c => !usedSubs.has(subkey(c.subcategory)));
    if (!pool.length) { pool = base; relaxed = true; }
  }
  if (!pool.length) return null;
  const pick = xs => xs[Math.floor(random() * xs.length)];
  const category = pick([...new Set(pool.map(c => c.category))]);
  pool = pool.filter(c => c.category === category);
  // Preserve child-app priority: total count, immediate-subcategory guard,
  // gender count, random tie. Reservations also balance simultaneous arrivals.
  const min = Math.min(...pool.map(c => c.total + c.reserved));
  pool = pool.filter(c => c.total + c.reserved === min);
  if (relaxed && history.length) {
    const previous = subkey(history.at(-1).subcategory);
    const nonRepeated = pool.filter(c => subkey(c.subcategory) !== previous);
    if (nonRepeated.length) pool = nonRepeated;
  }
  const field = gender === 'female' ? 'female' : gender === 'male' ? 'male' : null;
  if (field) {
    const minGender = Math.min(...pool.map(c => c[field] + (c[`${field}_reserved`] || 0)));
    pool = pool.filter(c => c[field] + (c[`${field}_reserved`] || 0) === minGender);
  }
  return { ...pick(pool), overflow, relaxed };
}
