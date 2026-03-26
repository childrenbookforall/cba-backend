/**
 * Test helpers — shared utilities for seeding data, generating tokens, etc.
 *
 * Tests use a real (test) database.  Set DATABASE_URL to a dedicated test DB
 * before running.  Each describe block is responsible for cleaning up the
 * records it creates via the exported `cleanup` helper.
 */

const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const app = require('../src/app');
const prisma = require('../src/prisma/client');

// ─── Token helpers ────────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function createUser(overrides = {}) {
  const defaults = {
    id: uuidv4(),
    email: `user-${uuidv4()}@test.com`,
    passwordHash: await bcrypt.hash('Password1!', 12),
    firstName: 'Test',
    lastName: 'User',
    role: 'member',
    isActive: true,
  };
  return prisma.user.create({ data: { ...defaults, ...overrides } });
}

async function createAdmin(overrides = {}) {
  return createUser({ role: 'admin', ...overrides });
}

async function createGroup(overrides = {}) {
  const slug = `group-${uuidv4().slice(0, 8)}`;
  return prisma.group.create({
    data: {
      name: overrides.name || `Group ${slug}`,
      slug: overrides.slug || slug,
      description: overrides.description || null,
      ...overrides,
    },
  });
}

async function addMember(userId, groupId) {
  return prisma.groupMember.create({ data: { userId, groupId } });
}

async function createPost(userId, groupId, overrides = {}) {
  return prisma.post.create({
    data: {
      userId,
      groupId,
      type: 'text',
      title: 'Test Post',
      content: 'Some content',
      ...overrides,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      group: { select: { id: true, name: true, slug: true } },
      _count: { select: { comments: true, reactions: true } },
    },
  });
}

async function createComment(postId, userId, overrides = {}) {
  return prisma.comment.create({
    data: { postId, userId, content: 'Test comment', ...overrides },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
  });
}

async function createInviteToken(email, createdById, overrides = {}) {
  return prisma.inviteToken.create({
    data: {
      token: uuidv4(),
      email,
      createdById,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      ...overrides,
    },
  });
}

async function createPasswordResetToken(email, overrides = {}) {
  return prisma.passwordResetToken.create({
    data: {
      token: uuidv4(),
      email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    },
  });
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────

async function deleteUser(id) {
  await prisma.inviteToken.deleteMany({ where: { createdById: id } });
  await prisma.user.deleteMany({ where: { id } });
}

async function deleteGroup(id) {
  await prisma.group.deleteMany({ where: { id } });
}

async function deletePost(id) {
  await prisma.post.deleteMany({ where: { id } });
}

async function deleteComment(id) {
  await prisma.comment.deleteMany({ where: { id } });
}

module.exports = {
  request,
  app,
  prisma,
  signToken,
  authHeader,
  createUser,
  createAdmin,
  createGroup,
  addMember,
  createPost,
  createComment,
  createInviteToken,
  createPasswordResetToken,
  deleteUser,
  deleteGroup,
  deletePost,
  deleteComment,
};
