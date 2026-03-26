const PRISMA_ERROR_MAP = {
  P2002: { status: 409, message: 'A record with this value already exists' },
  P2025: { status: 404, message: 'Record not found' },
};

function errorMiddleware(err, req, res, next) {
  console.error(err);

  // Handle known Prisma errors consistently across all controllers
  if (err.code && PRISMA_ERROR_MAP[err.code]) {
    const { status, message } = PRISMA_ERROR_MAP[err.code];
    return res.status(status).json({ error: message });
  }

  const status = err.status || 500;
  const message = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Something went wrong'
    : err.message || 'Internal server error';

  res.status(status).json({ error: message });
}

module.exports = errorMiddleware;
