process.env.NODE_ENV = 'test';
require('dotenv').config({ path: '.env.test' });

// Provide fallbacks for vars that are required by env.js but not exercised in tests.
// Override these in .env.test if you want to run integration tests against real services.
const defaults = {
  JWT_SECRET: 'test-secret-do-not-use-in-production',
  JWT_EXPIRES_IN: '7d',
  FRONTEND_URL: 'http://localhost:3000',
  CLOUDINARY_CLOUD_NAME: 'test',
  CLOUDINARY_API_KEY: 'test',
  CLOUDINARY_API_SECRET: 'test',
  RESEND_API_KEY: 'test',
  EMAIL_FROM: 'test@test.com',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
