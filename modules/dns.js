/**
 * DNS resolution module — queries A, AAAA, MX, NS, TXT, CNAME, SOA records.
 * Uses Node.js built-in dns.promises (Resolve) for all record types.
 */

const dns = require('dns');
const { Resolver } = dns.promises;

const resolver = new Resolver();
// Use system default + Google + Cloudflare DNS servers
resolver.setServers(['8.8.8.8', '1.1.1.1']);

/**
 * Query all DNS record types for a domain.
 * @param {string} domain
 * @returns {Promise<Array<{type: string, name: string, value: string, ttl: number, priority: number}>>}
 */
async function queryAll(domain) {
  const records = [];

  // A records
  try {
    const results = await resolver.resolve4(domain, { ttl: true });
    for (const r of results) {
      records.push({
        type: 'A',
        name: domain,
        value: r.address,
        ttl: r.ttl || 0,
        priority: 0,
      });
    }
  } catch (_) {}

  // AAAA records
  try {
    const results = await resolver.resolve6(domain, { ttl: true });
    for (const r of results) {
      records.push({
        type: 'AAAA',
        name: domain,
        value: r.address,
        ttl: r.ttl || 0,
        priority: 0,
      });
    }
  } catch (_) {}

  // MX records
  try {
    const results = await resolver.resolveMx(domain);
    for (const r of results) {
      records.push({
        type: 'MX',
        name: domain,
        value: r.exchange,
        ttl: 0,
        priority: r.priority,
      });
    }
  } catch (_) {}

  // NS records
  try {
    const results = await resolver.resolveNs(domain);
    for (const r of results) {
      records.push({
        type: 'NS',
        name: domain,
        value: r,
        ttl: 0,
        priority: 0,
      });
    }
  } catch (_) {}

  // TXT records
  try {
    const results = await resolver.resolveTxt(domain);
    for (const r of results) {
      records.push({
        type: 'TXT',
        name: domain,
        value: r.join(''),
        ttl: 0,
        priority: 0,
      });
    }
  } catch (_) {}

  // CNAME records
  try {
    const results = await resolver.resolveCname(domain);
    for (const r of results) {
      records.push({
        type: 'CNAME',
        name: domain,
        value: r,
        ttl: 0,
        priority: 0,
      });
    }
  } catch (_) {}

  // SOA record
  try {
    const r = await resolver.resolveSoa(domain);
    records.push({
      type: 'SOA',
      name: domain,
      value: `mname=${r.nsname} rname=${r.hostmaster}`,
      ttl: r.minttl || 0,
      priority: 0,
    });
  } catch (_) {}

  return records;
}

module.exports = { queryAll };
