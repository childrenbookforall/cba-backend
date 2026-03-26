const prisma = require('../prisma/client');
const { uploadMedia, deleteMedia } = require('../services/upload.service');

async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { bio: req.body.bio },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { avatarUrl: true },
    });

    const avatarUrl = await uploadMedia(req.file.buffer, 'avatars');

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { avatarUrl },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });

    if (existing.avatarUrl) {
      await deleteMedia(existing.avatarUrl).catch((err) =>
        console.error('Failed to delete old avatar from Cloudinary:', err)
      );
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function getUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, uploadAvatar, getUser };
