// Cursor pagination always anchors on a UUID primary key. Reject a malformed
// `cursor` query param up front with 400 instead of letting it reach Prisma,
// where a non-existent/typed cursor throws (P2025 / validation error) and
// surfaces as a 500. A well-formed-but-stale cursor (deleted anchor row) still
// reaches Prisma; handle that per-endpoint where it matters. (#11)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateCursor(req, res, next) {
  const { cursor } = req.query;
  if (cursor !== undefined && (typeof cursor !== 'string' || !UUID_RE.test(cursor))) {
    return res.status(400).json({ error: 'Invalid cursor' });
  }
  next();
}

module.exports = validateCursor;
