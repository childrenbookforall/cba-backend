const webpush = require('web-push');

webpush.setVapidDetails(
  process.env.VAPID_MAILTO,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Send a push notification to a single subscription.
 * Returns false if the subscription is expired/invalid (caller should delete it).
 */
async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err) {
    // 404 or 410 means the subscription is no longer valid
    if (err.statusCode === 404 || err.statusCode === 410) return false;
    throw err;
  }
}

module.exports = { sendPush };
