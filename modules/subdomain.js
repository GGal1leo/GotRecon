/**
 * Subdomain IP resolution with parallel workers.
 */

const dns = require('dns');

/**
 * Resolve a single domain to its A record IP.
 * @param {string} name
 * @returns {Promise<string>}
 */
function resolveA(name) {
  return new Promise((resolve) => {
    dns.resolve4(name, (err, addresses) => {
      resolve(err || !addresses || !addresses.length ? '' : addresses[0]);
    });
  });
}

/**
 * Resolve IPs for a list of subdomains using parallel workers.
 * @param {Array<{name: string, ip: string, source: string}>} subdomains
 * @param {number} maxWorkers
 * @param {AbortSignal} signal
 * @returns {Promise<Array>}
 */
async function resolveIPs(subdomains, maxWorkers = 20, signal = null) {
  if (!subdomains.length) return subdomains;

  let idx = 0;
  const total = subdomains.length;
  const results = [...subdomains]; // shallow clone

  async function worker() {
    while (true) {
      if (signal && signal.aborted) break;
      const i = idx++;
      if (i >= total) break;

      const ip = await resolveA(results[i].name);
      results[i] = { ...results[i], ip };
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

module.exports = { resolveIPs };
