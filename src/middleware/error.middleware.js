const multer = require('multer');

const PRISMA_ERROR_MAP = {
  P2002: { status: 409, message: 'A record with this value already exists' },
  P2025: { status: 404, message: 'Record not found' },
};

const MULTER_ERROR_MAP = {
  LIMIT_FILE_SIZE: 'File is too large',
  LIMIT_UNEXPECTED_FILE: 'Unexpected file field',
};

function errorMiddleware(err, req, res, next) {
  console.error(err);

  // Handle multer errors (file size, unexpected field, etc.)
  if (err instanceof multer.MulterError) {
    const message = MULTER_ERROR_MAP[err.code] || err.message;
    return res.status(400).json({ error: message });
  }

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
