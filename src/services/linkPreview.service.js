// Fetches Open Graph metadata for a URL.
// Returns { linkPreviewImage, linkPreviewTitle, linkPreviewDescription } or null on failure.

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,  // link-local
  /^::1$/,        // IPv6 loopback
  /^fc00:/i,      // IPv6 private
];

function isSafeUrl(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    if (PRIVATE_IP_PATTERNS.some((re) => re.test(hostname))) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchLinkPreview(url) {
  if (!isSafeUrl(url)) return null;

  try {
    const { default: ogs } = await import('open-graph-scraper');
    const { result } = await ogs({
      url,
      timeout: 5000,
      fetchOptions: { signal: AbortSignal.timeout(5000) },
    });
    if (!result.success) return null;
    return {
      linkPreviewImage: result.ogImage?.[0]?.url ?? null,
      linkPreviewTitle: result.ogTitle ?? null,
      linkPreviewDescription: result.ogDescription ?? null,
    };
  } catch {
    return null;
  }
}

module.exports = { fetchLinkPreview };
