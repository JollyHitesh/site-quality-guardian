// Showtime truth, in three layers of increasing independence:
// structured data vs the rendered page, plausibility against the clock, and the cinema's own site.
import crypto from 'node:crypto';

const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
const EVENT_TYPES = /(ScreeningEvent|TheaterEvent|Event)$/;

export function berlinTimeParts(now = new Date(), timezone = 'Europe/Berlin') {
  const pieces = new Intl.DateTimeFormat('en-GB', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now);
  const result = Object.fromEntries(pieces.map(p => [p.type, Number(p.value)]));
  return {year: result.year, month: result.month, day: result.day, hour: result.hour, minute: result.minute};
}

export function nextScreeningPlausibility(text, now = new Date(), timezone = 'Europe/Berlin') {
  const match = String(text).match(/Next\s*:\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*[·•-]\s*(\d{1,2}):(\d{2})/i);
  if (!match) return {status: 'NOT_DETECTED'};
  const nowP = berlinTimeParts(now, timezone);
  const month = MONTHS[match[2].toLowerCase()];
  const day = Number(match[1]), hour = Number(match[3]), minute = Number(match[4]);
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return {status: 'UNPARSEABLE'};
  let year = nowP.year;
  if (nowP.month === 12 && month === 1) year++;
  if (nowP.month === 1 && month === 12) year--;
  // Compare local wall-clock numbers. This avoids making an implicit UTC assumption.
  const candidate = Date.UTC(year, month - 1, day, hour, minute);
  const current = Date.UTC(nowP.year, nowP.month - 1, nowP.day, nowP.hour, nowP.minute);
  const minutesUntil = Math.round((candidate - current) / 60000);
  return {status: minutesUntil < -30 ? 'PAST_NEXT_SHOWTIME' : 'PLAUSIBLE', minutesUntil, shown: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${match[3]}:${match[4]}`, timeZone: timezone};
}

function walk(node, visit) {
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return; }
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const key of ['@graph', 'itemListElement', 'item', 'subEvent']) if (node[key]) walk(node[key], visit);
}

export function localParts(iso, timezone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p = berlinTimeParts(date, timezone);
  const pad = n => String(n).padStart(2, '0');
  const weekday = new Intl.DateTimeFormat('en-GB', {timeZone: timezone, weekday: 'short'}).format(date);
  const month = new Intl.DateTimeFormat('en-GB', {timeZone: timezone, month: 'short'}).format(date);
  return {date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}`, weekday, month, day: p.day, monthNumber: p.month, year: p.year};
}

/** Reads schema.org events, which many listing sites publish, without site-specific code. */
export function extractScreenings(jsonLdBlocks, timezone) {
  const found = [];
  for (const block of jsonLdBlocks) {
    let parsed;
    try { parsed = JSON.parse(block); } catch { continue; }
    walk(parsed, node => {
      const type = [].concat(node['@type'] || []).join(' ');
      if (!EVENT_TYPES.test(type) || !node.startDate) return;
      const local = localParts(node.startDate, timezone);
      if (!local) return;
      const location = Array.isArray(node.location) ? node.location[0] : node.location;
      const work = Array.isArray(node.workPresented) ? node.workPresented[0] : node.workPresented;
      const title = String(work?.name || node.name || '').trim();
      if (!title) return;
      found.push({
        title,
        alternateTitle: String(work?.alternateName || '').trim() || null,
        startDate: node.startDate,
        ...local,
        venue: String(location?.name || '').trim(),
        venueUrl: typeof location?.url === 'string' ? location.url : null,
        pageUrl: typeof node.url === 'string' ? node.url : null,
      });
    });
  }
  const seen = new Set();
  return found.filter(s => {
    const key = `${s.title}|${s.startDate}|${s.venue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Page text without scripts, so structured data cannot vouch for itself. */
export function readPageText(page) {
  return page.evaluate(() => {
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
    return copy.textContent || '';
  });
}

export async function readJsonLd(page) {
  return page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.textContent || '')).catch(() => []);
}

const WEEKDAYS = {Mon: ['monday', 'montag'], Tue: ['tuesday', 'dienstag'], Wed: ['wednesday', 'mittwoch'], Thu: ['thursday', 'donnerstag'], Fri: ['friday', 'freitag'], Sat: ['saturday', 'samstag', 'sonnabend'], Sun: ['sunday', 'sonntag']};

const dateTokens = s => [
  `${s.day} ${s.month}`.toLowerCase(),
  `${s.month} ${s.day}`.toLowerCase(),
  `${String(s.day).padStart(2, '0')}.${String(s.monthNumber).padStart(2, '0')}`,
  `${s.day}.${s.monthNumber}.`,
];

/** A date or time that differs between structured data and the page is the classic timezone bug. */
export function compareWithRendered(screenings, renderedText, now, {graceMinutes = 30} = {}) {
  const text = String(renderedText).replace(/\s+/g, ' ').toLowerCase();
  const issues = [];
  for (const s of screenings) {
    const minutes = (new Date(s.startDate).getTime() - now.getTime()) / 60000;
    if (minutes < -graceMinutes) {
      issues.push({type: 'past', screening: s, minutesAgo: Math.round(-minutes)});
      continue;
    }
    const timeShown = text.includes(s.time);
    const dateShown = dateTokens(s).some(token => text.includes(token)) || minutes < 2 * 24 * 60;
    if (!timeShown || !dateShown) issues.push({type: 'not-rendered', screening: s, timeShown, dateShown});
  }
  return issues;
}

const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9:. ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Prefers soon, widely spread screenings: those matter most and vary the sources checked. */
export function chooseSample(screenings, size, now, sourceStats = {}) {
  const hostOf = s => { try { return new URL(s.venueUrl).hostname; } catch { return ''; } };
  // Sites that gave a usable answer before are tried first; a source that never does sinks.
  const usefulness = s => { const stat = sourceStats[hostOf(s)]; return stat ? (stat.useful + 1) / (stat.attempts + 2) : 0.5; };
  const upcoming = screenings.filter(s => s.venueUrl && new Date(s.startDate).getTime() > now.getTime())
    .sort((a, b) => usefulness(b) - usefulness(a) || a.startDate.localeCompare(b.startDate));
  const hosts = new Set();
  const sample = [];
  for (const s of upcoming) {
    let host;
    try { host = new URL(s.venueUrl).hostname; } catch { continue; }
    if (hosts.has(host)) continue;
    hosts.add(host);
    sample.push(s);
    if (sample.length >= size) break;
  }
  return sample;
}

const timePatterns = time => {
  const [h, m] = time.split(':');
  const short = String(Number(h));
  return [`${h}:${m}`, `${h}.${m}`, `${short}:${m}`, `${short}.${m}`, `${h} ${m} uhr`];
};

/**
 * Looks for one screening in the cinema's own page. Only "time shown differs for the same
 * film and date" counts against the site: a missing film may just be on another page.
 */
export function matchOnSourcePage(screening, sourceText, now = null) {
  const text = normalize(sourceText);
  if (text.length < 200) return {status: 'UNAVAILABLE', detail: 'source page had almost no text'};
  const titles = [screening.title, screening.alternateTitle].filter(Boolean).map(t => normalize(t.replace(/\((?:ov|omu|omeu|ome)\)/ig, '')));
  const windows = [];
  for (const title of titles) {
    let from = 0;
    while (title.length >= 3 && windows.length < 40) {
      const at = text.indexOf(title, from);
      if (at < 0) break;
      windows.push(text.slice(Math.max(0, at - 500), at + title.length + 700));
      from = at + title.length;
    }
  }
  if (!windows.length) return {status: 'NOT_FOUND', detail: 'film title not on the source page'};
  const dates = dateTokens(screening).map(normalize);
  dates.push(...(WEEKDAYS[screening.weekday] || []));
  if (now && localParts(now.toISOString(), screening.timezone || 'Europe/Berlin').date === screening.date) dates.push('heute', 'today');
  const times = timePatterns(screening.time).map(normalize);
  const hasDate = w => dates.some(d => w.includes(d));
  const hasTime = w => times.some(t => w.includes(t));
  if (windows.some(w => hasTime(w) && hasDate(w))) return {status: 'MATCH', detail: 'title, date and time appear together'};
  if (windows.some(hasTime)) return {status: dates.some(d => text.includes(d)) ? 'LIKELY_MATCH' : 'TIME_ONLY', detail: 'title and time appear together; date is elsewhere or not shown'};
  if (windows.some(hasDate)) return {status: 'MISMATCH', detail: 'film shown for this date, but not at this time'};
  return {status: 'TITLE_ONLY', detail: 'film listed, but this date and time were not found near it'};
}

export function summarizeVerification(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const confirmed = (counts.MATCH || 0) + (counts.LIKELY_MATCH || 0);
  return {
    checked: results.length,
    counts,
    confirmed,
    verdict: !results.length ? 'NOT_VERIFIED' : counts.MISMATCH ? 'MISMATCHES_FOUND' : confirmed ? 'PARTIALLY_VERIFIED' : 'INCONCLUSIVE',
  };
}

export const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
