/**
 * Typosquat detection module.
 * Generates domain permutations using 10 techniques and checks each via DNS + RDAP.
 */

const dns = require('dns');
const https = require('https');
const http = require('http');

// ── Keyboard neighbor map (QWERTY) ──────────────────────────────────────────

const KEYBOARD_NEIGHBORS = {
  q: 'wa',     w: 'qeas',   e: 'wrsdf',  r: 'edft',
  t: 'rfgy',   y: 'tghu',   u: 'yhji',   i: 'ujko',
  o: 'iklp',   p: 'ol',     a: 'qwsz',   s: 'weadxz',
  d: 'ersfxc', f: 'rtdgcv', g: 'tyfhvb', h: 'yugjbn',
  j: 'uihknm', k: 'iojlm',  l: 'opk',    z: 'asx',
  x: 'zsdc',   c: 'xdfv',   v: 'cfgb',   b: 'vghn',
  n: 'bhjm',   m: 'njk',
};

// ── Homoglyph map ────────────────────────────────────────────────────────────

const HOMOGLYPHS = {
  a: ['4', '@'],  b: ['d', '6'],  c: ['e'],    d: ['b'],    e: ['3', 'c'],
  g: ['q', '9'],  h: ['n'],       i: ['1', 'l'], l: ['1', 'i'], m: ['nn', 'rn'],
  n: ['m', 'h'],  o: ['0'],       p: ['q'],    q: ['g', 'p'], r: ['n'],
  s: ['5'],       t: ['7'],       u: ['v'],    v: ['u'],    w: ['vv'],
  y: ['v'],       '0': ['o'],     '1': ['i', 'l'],
};

// ── Common TLD variants ─────────────────────────────────────────────────────

const ALT_TLDS = [
  '.com', '.net', '.org', '.io', '.co', '.info', '.biz', '.xyz',
  '.app', '.dev', '.site', '.online', '.shop', '.tech', '.cc',
  '.ru', '.cn', '.tk', '.ml', '.ga', '.cf',
];

// ── Permutation Generator ────────────────────────────────────────────────────

/**
 * Generate all typosquat permutations for a domain.
 * Returns unique candidates with { domain, technique }.
 * @param {string} fullDomain e.g. "example.com"
 * @returns {Array<{domain: string, technique: string}>}
 */
function generate(fullDomain) {
  const results = [];
  const seen = new Set([fullDomain]);

  const dotPos = fullDomain.indexOf('.');
  if (dotPos === -1) return results;

  const name = fullDomain.substring(0, dotPos);
  const tld = fullDomain.substring(dotPos);

  function add(d, technique) {
    if (!d || d === fullDomain) return;
    if (!seen.has(d)) {
      seen.add(d);
      results.push({ domain: d, technique });
    }
  }

  // 1. Character omission
  for (let i = 0; i < name.length; i++) {
    const v = name.substring(0, i) + name.substring(i + 1);
    if (v) add(v + tld, 'omission');
  }

  // 2. Adjacent character swap
  for (let i = 0; i + 1 < name.length; i++) {
    const arr = name.split('');
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    add(arr.join('') + tld, 'swap');
  }

  // 3. Character duplication
  for (let i = 0; i < name.length; i++) {
    const v = name.substring(0, i + 1) + name[i] + name.substring(i + 1);
    add(v + tld, 'duplication');
  }

  // 4. Keyboard neighbor replacement
  for (let i = 0; i < name.length; i++) {
    const ch = name[i].toLowerCase();
    const neighbors = KEYBOARD_NEIGHBORS[ch];
    if (!neighbors) continue;
    for (const nc of neighbors) {
      const arr = name.split('');
      arr[i] = nc;
      add(arr.join('') + tld, 'keyboard');
    }
  }

  // 5. Homoglyph substitution
  for (let i = 0; i < name.length; i++) {
    const ch = name[i].toLowerCase();
    const glyphs = HOMOGLYPHS[ch];
    if (!glyphs) continue;
    for (const sub of glyphs) {
      const v = name.substring(0, i) + sub + name.substring(i + 1);
      add(v + tld, 'homoglyph');
    }
  }

  // 6. Hyphen insertion
  for (let i = 1; i < name.length; i++) {
    const v = name.substring(0, i) + '-' + name.substring(i);
    add(v + tld, 'hyphenation');
  }

  // 7. Dot insertion (subdomain-like)
  for (let i = 1; i < name.length; i++) {
    const v = name.substring(0, i) + '.' + name.substring(i);
    add(v + tld, 'subdomain');
  }

  // 8. Vowel swap
  const vowels = 'aeiou';
  for (let i = 0; i < name.length; i++) {
    const ch = name[i].toLowerCase();
    if (!vowels.includes(ch)) continue;
    for (const v of vowels) {
      if (v === ch) continue;
      const arr = name.split('');
      arr[i] = v;
      add(arr.join('') + tld, 'vowel-swap');
    }
  }

  // 9. TLD swap
  for (const alt of ALT_TLDS) {
    if (alt === tld) continue;
    add(name + alt, 'tld-swap');
  }

  // 10. Missing dot (wwwexample.com)
  add('www' + fullDomain, 'missing-dot');

  return results;
}

// ── DNS resolve helper ───────────────────────────────────────────────────────

function resolveA(domain) {
  return new Promise((resolve) => {
    dns.resolve4(domain, (err, addresses) => {
      resolve(err || !addresses || !addresses.length ? '' : addresses[0]);
    });
  });
}

// ── RDAP query helper ────────────────────────────────────────────────────────

function queryRDAP(domain, signal) {
  return new Promise((resolve) => {
    const url = `https://rdap.org/domain/${domain}`;
    const req = https.get(url, {
      headers: { 'User-Agent': 'GotRecon/1.0' },
      timeout: 8000,
    }, (res) => {
      // Follow redirects (up to 3)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location;
        const protocol = redirectUrl.startsWith('https') ? https : http;
        const req2 = protocol.get(redirectUrl, {
          headers: { 'User-Agent': 'GotRecon/1.0' },
          timeout: 8000,
        }, (res2) => {
          let body = '';
          res2.on('data', (chunk) => { body += chunk; });
          res2.on('end', () => { resolve(parseRDAPDate(body)); });
          res2.on('error', () => resolve(''));
        });
        req2.on('error', () => resolve(''));
        req2.on('timeout', () => { req2.destroy(); resolve(''); });
        if (signal) {
          signal.addEventListener('abort', () => { req2.destroy(); resolve(''); }, { once: true });
        }
        return;
      }

      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { resolve(parseRDAPDate(body)); });
      res.on('error', () => resolve(''));
    });

    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });

    if (signal) {
      signal.addEventListener('abort', () => { req.destroy(); resolve(''); }, { once: true });
    }
  });
}

function parseRDAPDate(body) {
  try {
    const j = JSON.parse(body);
    if (j.events && Array.isArray(j.events)) {
      for (const ev of j.events) {
        if (ev.eventAction === 'registration') {
          return ev.eventDate || '';
        }
      }
    }
  } catch (_) {}
  return '';
}

/**
 * Check if a date string is within the last N days.
 * @param {string} dateStr ISO date string
 * @param {number} daysThreshold
 * @returns {boolean}
 */
function isRecent(dateStr, daysThreshold) {
  try {
    const regTime = new Date(dateStr).getTime();
    const now = Date.now();
    const diff = now - regTime;
    return diff >= 0 && diff < daysThreshold * 86400000;
  } catch (_) {
    return false;
  }
}

// ── Parallel checker ─────────────────────────────────────────────────────────

/**
 * Check all typosquat candidates in parallel.
 * @param {Array<{domain: string, technique: string}>} candidates
 * @param {number} maxWorkers
 * @param {AbortSignal} signal
 * @param {function} onProgress  Called with (progressCount, entry) after each check
 * @returns {Promise<Array>}
 */
async function check(candidates, maxWorkers = 30, signal = null, onProgress = null) {
  if (!candidates.length) return [];

  const total = candidates.length;
  const results = candidates.map((c) => ({
    domain: c.domain,
    technique: c.technique,
    ip: '',
    registeredDate: '',
    registered: false,
    recent: false,
    checked: false,
  }));

  let nextIdx = 0;
  let progress = 0;

  async function worker() {
    while (true) {
      if (signal && signal.aborted) break;
      const i = nextIdx++;
      if (i >= total) break;

      const entry = results[i];

      // Try DNS resolve
      const ip = await resolveA(entry.domain);
      if (ip) {
        entry.registered = true;
        entry.ip = ip;

        // Try RDAP for registration date
        const created = await queryRDAP(entry.domain, signal);
        if (created) {
          entry.registeredDate = created;
          entry.recent = isRecent(created, 90);
        }
      }

      entry.checked = true;
      progress++;

      if (onProgress) {
        onProgress(progress, entry);
      }
    }
  }

  const numWorkers = Math.min(maxWorkers, total);
  const workers = [];
  for (let i = 0; i < numWorkers; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

module.exports = { generate, check };
