const {
  request, app,
  createUser, deleteUser,
  signToken, authHeader,
} = require('./helpers');

describe('Users API', () => {
  let user, token;

  beforeAll(async () => {
    user = await createUser();
    token = signToken({ userId: user.id, role: user.role });
  });

  afterAll(async () => {
    await deleteUser(user.id);
  });

  // ─── GET /api/users/me ──────────────────────────────────────────────────────

  describe('GET /api/users/me', () => {
    test('200 and own profile for authenticated user', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      });
      // passwordHash must NOT be returned
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    test('401 without auth token', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.status).toBe(401);
    });

    test('401 with malformed token', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set({ Authorization: 'Bearer totally.fake.token' });
      expect(res.status).toBe(401);
    });

    test('401 when user is suspended', async () => {
      const suspended = await createUser({ isActive: false });
      const suspendedToken = signToken({ userId: suspended.id, role: suspended.role });
      const res = await request(app)
        .get('/api/users/me')
        .set(authHeader(suspendedToken));
      expect(res.status).toBe(401);
      await deleteUser(suspended.id);
    });
  });

  // ─── PUT /api/users/me ──────────────────────────────────────────────────────

  describe('PUT /api/users/me', () => {
    test('200 and updated profile when bio is provided', async () => {
      const res = await request(app)
        .put('/api/users/me')
        .set(authHeader(token))
        .send({ bio: 'Hello world' });
      expect(res.status).toBe(200);
      expect(res.body.bio).toBe('Hello world');
    });

    test('200 and clears bio when empty string sent', async () => {
      const res = await request(app)
        .put('/api/users/me')
        .set(authHeader(token))
        .send({ bio: '' });
      expect(res.status).toBe(200);
    });

    test('400 when bio exceeds 500 characters', async () => {
      const res = await request(app)
        .put('/api/users/me')
        .set(authHeader(token))
        .send({ bio: 'a'.repeat(501) });
      expect(res.status).toBe(400);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .put('/api/users/me')
        .send({ bio: 'No auth' });
      expect(res.status).toBe(401);
    });
  });

  // Minimal valid 1x1 white JPEG (standard test fixture)
  const MINIMAL_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
    'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
    'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
    'MjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA' +
    'AAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAA' +
    'AAAA/9oADAMBAAIRAxEAPwAlAAH/2Q==',
    'base64'
  );

  // ─── POST /api/users/me/avatar ──────────────────────────────────────────────

  describe('POST /api/users/me/avatar', () => {
    test('200 and updated avatarUrl after uploading a valid image', async () => {
      if (!process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY === 'test') {
        return console.warn('Skipping avatar upload test — Cloudinary not configured');
      }
      const res = await request(app)
        .post('/api/users/me/avatar')
        .set(authHeader(token))
        .attach('avatar', MINIMAL_JPEG, { filename: 'avatar.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('avatarUrl');
      expect(res.body.avatarUrl).toMatch(/^https?:\/\//);
    }, 15000);

    test('400 when no file is attached', async () => {
      const res = await request(app)
        .post('/api/users/me/avatar')
        .set(authHeader(token));
      expect(res.status).toBe(400);
    });

    test('400 when file type is not allowed (e.g. PDF)', async () => {
      const res = await request(app)
        .post('/api/users/me/avatar')
        .set(authHeader(token))
        .attach('avatar', Buffer.from('%PDF-1.4 fake'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(400);
    });

    test('401 without auth token', async () => {
      const res = await request(app).post('/api/users/me/avatar');
      expect(res.status).toBe(401);
    });
  });
});
