const { createClient } = require('@libsql/client');

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL.trim(),
  authToken: process.env.TURSO_AUTH_TOKEN.trim(),
});

module.exports = turso;
