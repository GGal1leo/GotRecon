/**
 * crt.sh Certificate Transparency log query.
 * Pulls cert entries and extracts subdomains from SANs.
 */

const https = require('https');

/**
 * Fetch JSON from a URL using Node.js built-in https.
 * @param {string} url
 * @param {AbortSignal} signal
 * @returns {Promise<any>}
 */
function fetchJSON(url, signal) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'GotRecon/1.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location, signal).then(resolve, reject);
      }

      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Failed to parse crt.sh response'));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('crt.sh timeout')); });

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('cancelled'));
      }, { once: true });
    }
  });
}

/**
 * Query crt.sh for a domain and return certs + subdomains.
 * @param {string} domain
 * @param {AbortSignal} signal
 * @returns {Promise<{certs: Array, subdomains: Array}>}
 */
async function query(domain, signal) {
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;
  let data;

  try {
    data = await fetchJSON(url, signal);
  } catch (err) {
    if (err.message === 'cancelled') throw err;
    return { certs: [], subdomains: [] };
  }

  if (!Array.isArray(data)) return { certs: [], subdomains: [] };

  const certs = [];
  const seenSubs = new Set();
  const subdomains = [];
  const domLower = domain.toLowerCase();

  for (const item of data) {
    certs.push({
      id: item.id || 0,
      issuer: item.issuer_name || '',
      commonName: item.common_name || '',
      nameValue: item.name_value || '',
      notBefore: item.not_before || '',
      notAfter: item.not_after || '',
    });

    // Extract subdomains from name_value (newline-separated)
    const nv = item.name_value || '';
    for (let line of nv.split('\n')) {
      // Trim wildcards, dots, whitespace
      line = line.replace(/^[\s*.]+/, '').replace(/[\s\r]+$/, '').toLowerCase();
      if (!line) continue;

      // Must belong to the target domain
      if (line === domLower || (line.endsWith('.' + domLower) && line.length > domLower.length + 1)) {
        if (!seenSubs.has(line)) {
          seenSubs.add(line);
          subdomains.push({
            name: line,
            ip: '',
            source: 'crt.sh',
          });
        }
      }
    }
  }

  return { certs, subdomains };
}

module.exports = { query };
