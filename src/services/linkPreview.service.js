// Fetches Open Graph metadata for a URL.
// Returns { linkPreviewImage, linkPreviewTitle, linkPreviewDescription } or null on failure.
//
// SSRF hardening: the page is fetched through an undici Agent whose DNS lookup
// rejects private/internal addresses. Validating at connect time (instead of
// pre-checking the URL string) covers encoded IP literals, hostnames that
// resolve to internal IPs, and DNS rebinding between check and fetch.
// Redirects are followed manually so every hop goes through the same checks.

const dns = require('node:dns');
const net = require('node:net');
const { Agent, fetch } = require('undici');

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
// og: tags live in <head>, so a truncated document still parses fine
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const blockList = new net.BlockList();
blockList.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
blockList.addSubnet('10.0.0.0', 8, 'ipv4');
blockList.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
blockList.addSubnet('127.0.0.0', 8, 'ipv4');
blockList.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local, incl. cloud metadata
blockList.addSubnet('172.16.0.0', 12, 'ipv4');
blockList.addSubnet('192.0.0.0', 24, 'ipv4');
blockList.addSubnet('192.168.0.0', 16, 'ipv4');
blockList.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
blockList.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blockList.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved + broadcast
blockList.addAddress('::', 'ipv6');
blockList.addAddress('::1', 'ipv6');
blockList.addSubnet('fc00::', 7, 'ipv6'); // unique-local
blockList.addSubnet('fe80::', 10, 'ipv6'); // link-local
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is checked against the ipv4 rules by BlockList itself.

// dns.lookup-compatible resolver that fails the connection when any resolved
// address is internal. net.connect/tls.connect call this on every connection,
// so redirect hops and rebinding attempts are all covered.
function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const blocked = addresses.some(({ address, family }) =>
      blockList.check(address, family === 6 ? 'ipv6' : 'ipv4'),
    );
    if (blocked) {
      return callback(new Error(`Refusing to connect to internal address for ${hostname}`));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const safeAgent = new Agent({ connect: { lookup: safeLookup } });

function parseHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null;
  } catch {
    return null;
  }
}

async function readBodyCapped(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString('utf8');
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel();
  return Buffer.concat(chunks).toString('utf8');
}

// Follows redirects manually, re-validating protocol (and, via safeAgent,
// resolved IPs) on every hop. Returns { html, finalUrl } or null.
async function fetchHtml(url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = parseHttpUrl(current);
    if (!parsed) return null;

    const res = await fetch(parsed, {
      dispatcher: safeAgent,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'cba-link-preview/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) return null;
      current = new URL(location, parsed).href;
      continue;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      await res.body?.cancel();
      return null;
    }
    return { html: await readBodyCapped(res), finalUrl: parsed.href };
  }
  return null;
}

async function fetchLinkPreview(url) {
  try {
    const page = await fetchHtml(url);
    if (!page) return null;

    const { default: ogs } = await import('open-graph-scraper');
    const { result } = await ogs({ html: page.html });
    if (!result.success) return null;

    // Resolve og:image against the final page URL and keep only http(s) targets
    let linkPreviewImage = null;
    if (result.ogImage?.[0]?.url) {
      try {
        const image = new URL(result.ogImage[0].url, page.finalUrl);
        if (image.protocol === 'https:' || image.protocol === 'http:') {
          linkPreviewImage = image.href;
        }
      } catch {
        // unparseable og:image — drop it
      }
    }

    return {
      linkPreviewImage,
      linkPreviewTitle: result.ogTitle ?? null,
      linkPreviewDescription: result.ogDescription ?? null,
    };
  } catch {
    return null;
  }
}

module.exports = { fetchLinkPreview };
