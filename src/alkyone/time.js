/**
 * Zaman = TEXT, ISO-8601 UTC (2026-07-06T14:03:00Z). Spec Bolum 3.
 */
function nowIso() {
  return new Date().toISOString();
}

/** Verilen tarihi (Date|string|null) ISO-8601 UTC'ye normalize et. */
function toIso(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = { nowIso, toIso };
