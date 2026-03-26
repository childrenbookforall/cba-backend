const {
  request, app, prisma,
  createUser, createAdmin, createInviteToken, createPasswordResetToken,
  deleteUser,
} = require('./helpers');

describe('Auth API', () => {
  let admin;

  beforeAll(async () => {
    admin = await createAdmin();
  });

  afterAll(async () => {
    await deleteUser(admin.id);
  });

  // ─── GET /api/auth/invite/:token ────────────────────────────────────────────

  describe('GET /api/auth/invite/:token', () => {
    let user, invite;

    beforeAll(async () => {
      user = await createUser({ passwordHash: 'INVITE_PENDING' });
      invite = await createInviteToken(user.email, admin.id);
    });

    afterAll(async () => {
      await prisma.inviteToken.deleteMany({ where: { id: invite.id } });
      await deleteUser(user.id);
    });

    test('returns user info for a valid token', async () => {
      const res = await request(app).get(`/api/auth/invite/${invite.token}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
    });

    test('404 for a non-existent token', async () => {
      const res = await request(app).get('/api/auth/invite/non-existent-token');
      expect(res.status).toBe(404);
    });

    test('400 for an already-used token', async () => {
      const usedInvite = await createInviteToken(user.email, admin.id, {
        usedAt: new Date(),
      });
      const res = await request(app).get(`/api/auth/invite/${usedInvite.token}`);
      expect(res.status).toBe(400);
      await prisma.inviteToken.deleteMany({ where: { id: usedInvite.id } });
    });

    test('400 for an expired token', async () => {
      const expiredInvite = await createInviteToken(user.email, admin.id, {
        expiresAt: new Date(Date.now() - 1000),
      });
      const res = await request(app).get(`/api/auth/invite/${expiredInvite.token}`);
      expect(res.status).toBe(400);
      await prisma.inviteToken.deleteMany({ where: { id: expiredInvite.id } });
    });
  });

  // ─── POST /api/auth/invite/:token ───────────────────────────────────────────

  describe('POST /api/auth/invite/:token', () => {
    let user, invite;

    beforeEach(async () => {
      user = await createUser({ passwordHash: 'INVITE_PENDING' });
      invite = await createInviteToken(user.email, admin.id);
    });

    afterEach(async () => {
      await prisma.inviteToken.deleteMany({ where: { email: user.email } });
      await deleteUser(user.id);
    });

    test('201 and JWT token when accepting valid invite', async () => {
      const res = await request(app)
        .post(`/api/auth/invite/${invite.token}`)
        .send({ password: 'Password1!' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
    });

    test('400 when password is too short', async () => {
      const res = await request(app)
        .post(`/api/auth/invite/${invite.token}`)
        .send({ password: 'short' });
      expect(res.status).toBe(400);
    });

    test('400 when password has no uppercase letter', async () => {
      const res = await request(app)
        .post(`/api/auth/invite/${invite.token}`)
        .send({ password: 'password1!!' });
      expect(res.status).toBe(400);
    });

    test('400 when password has no number', async () => {
      const res = await request(app)
        .post(`/api/auth/invite/${invite.token}`)
        .send({ password: 'Password!!!' });
      expect(res.status).toBe(400);
    });

    test('400 when password has no special character', async () => {
      const res = await request(app)
        .post(`/api/auth/invite/${invite.token}`)
        .send({ password: 'Password111' });
      expect(res.status).toBe(400);
    });

    test('400 for an already-used token', async () => {
      const usedInvite = await createInviteToken(user.email, admin.id, {
        usedAt: new Date(),
      });
      const res = await request(app)
        .post(`/api/auth/invite/${usedInvite.token}`)
        .send({ password: 'Password1!' });
      expect(res.status).toBe(400);
      await prisma.inviteToken.deleteMany({ where: { id: usedInvite.id } });
    });

    test('400 for an expired token', async () => {
      const expiredInvite = await createInviteToken(user.email, admin.id, {
        expiresAt: new Date(Date.now() - 1000),
      });
      const res = await request(app)
        .post(`/api/auth/invite/${expiredInvite.token}`)
        .send({ password: 'Password1!' });
      expect(res.status).toBe(400);
      await prisma.inviteToken.deleteMany({ where: { id: expiredInvite.id } });
    });
  });

  // ─── POST /api/auth/login ───────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    let user;

    beforeAll(async () => {
      user = await createUser({ email: `login-test-${Date.now()}@test.com` });
    });

    afterAll(async () => {
      await deleteUser(user.id);
    });

    test('200 and JWT token with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'Password1!' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
    });

    test('401 with wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'WrongPass1!' });
      expect(res.status).toBe(401);
    });

    test('401 with non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@test.com', password: 'Password1!' });
      expect(res.status).toBe(401);
    });

    test('400 with missing password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email });
      expect(res.status).toBe(400);
    });

    test('400 with invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'not-an-email', password: 'Password1!' });
      expect(res.status).toBe(400);
    });

    test('401 for suspended (inactive) user', async () => {
      const suspended = await createUser({ isActive: false });
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: suspended.email, password: 'Password1!' });
      expect(res.status).toBe(401);
      await deleteUser(suspended.id);
    });

    test('401 for user whose invite is still pending', async () => {
      const pending = await createUser({ passwordHash: 'INVITE_PENDING' });
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: pending.email, password: 'Password1!' });
      expect(res.status).toBe(401);
      await deleteUser(pending.id);
    });
  });

  // ─── POST /api/auth/forgot-password ────────────────────────────────────────

  describe('POST /api/auth/forgot-password', () => {
    let user;

    beforeAll(async () => {
      user = await createUser();
    });

    afterAll(async () => {
      await prisma.passwordResetToken.deleteMany({ where: { email: user.email } });
      await deleteUser(user.id);
    });

    test('200 with generic message for existing email', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: user.email });
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });

    test('200 with same generic message for non-existent email (no enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody@nowhere.com' });
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });

    test('400 with invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/auth/reset-password/:token ──────────────────────────────────

  describe('POST /api/auth/reset-password/:token', () => {
    let user, resetToken;

    beforeEach(async () => {
      user = await createUser();
      resetToken = await createPasswordResetToken(user.email);
    });

    afterEach(async () => {
      await prisma.passwordResetToken.deleteMany({ where: { email: user.email } });
      await deleteUser(user.id);
    });

    test('200 and success message for valid token and password', async () => {
      const res = await request(app)
        .post(`/api/auth/reset-password/${resetToken.token}`)
        .send({ password: 'NewPassword1!' });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/updated/i);
    });

    test('400 for expired reset token', async () => {
      const expired = await createPasswordResetToken(user.email, {
        expiresAt: new Date(Date.now() - 1000),
      });
      const res = await request(app)
        .post(`/api/auth/reset-password/${expired.token}`)
        .send({ password: 'NewPassword1!' });
      expect(res.status).toBe(400);
      await prisma.passwordResetToken.deleteMany({ where: { id: expired.id } });
    });

    test('400 for already-used reset token', async () => {
      const used = await createPasswordResetToken(user.email, {
        usedAt: new Date(),
      });
      const res = await request(app)
        .post(`/api/auth/reset-password/${used.token}`)
        .send({ password: 'NewPassword1!' });
      expect(res.status).toBe(400);
      await prisma.passwordResetToken.deleteMany({ where: { id: used.id } });
    });

    test('400 for non-existent token', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password/fake-token')
        .send({ password: 'NewPassword1!' });
      expect(res.status).toBe(400);
    });

    test('400 for weak password', async () => {
      const res = await request(app)
        .post(`/api/auth/reset-password/${resetToken.token}`)
        .send({ password: 'weak' });
      expect(res.status).toBe(400);
    });
  });
});
