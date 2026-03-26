const cloudinary = require('cloudinary').v2;
const { cloudinary: { cloudName, apiKey, apiSecret } } = require('../config/env');

cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

function uploadMedia(fileBuffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
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
