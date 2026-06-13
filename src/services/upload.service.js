const cloudinary = require('cloudinary').v2;
const { cloudinary: { cloudName, apiKey, apiSecret } } = require('../config/env');

cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

// Server-side magic-byte sniffing. The multipart mimetype is attacker-controlled,
// so we identify the real format from the file's leading bytes and only allow the
// raster image types we serve. This rejects e.g. an SVG (which Cloudinary would
// otherwise auto-detect and serve as image/svg+xml, enabling stored script).
const ALLOWED_IMAGE_FORMATS = ['jpg', 'png', 'webp'];

function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'png';
  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) return 'webp';
  return null;
}

function uploadMedia(fileBuffer, folder) {
  return new Promise((resolve, reject) => {
    const format = detectImageFormat(fileBuffer);
    if (!format) {
      return reject(Object.assign(
        new Error('Only JPEG, PNG and WebP images are allowed'),
        { status: 400 },
      ));
    }
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', format, allowed_formats: ALLOWED_IMAGE_FORMATS },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
}

// Extracts the Cloudinary public_id from a secure_url
// e.g. https://res.cloudinary.com/demo/image/upload/v123/avatars/abc.jpg → avatars/abc
function extractPublicId(url) {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
  return match ? match[1] : null;
}

async function deleteMedia(url) {
  const publicId = extractPublicId(url);
  if (publicId) {
    await cloudinary.uploader.destroy(publicId);
  }
}

module.exports = { uploadMedia, deleteMedia };
