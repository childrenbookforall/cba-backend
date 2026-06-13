const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM;

// Strip ASCII control characters (incl. CR/LF and DEL), collapse whitespace
// runs and trim, then length-cap. Keeps user-controlled values (display name,
// message preview) from injecting newlines/control chars into the email
// subject or body. (#15)
function sanitizeForEmail(value, maxLen = 200) {
  return String(value ?? '')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

async function sendInviteEmail(toEmail, inviteUrl) {
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'You have been invited to the CBA Community',
    text: `You have been invited to join the CBA Community.\n\nClick here to set up your account: ${inviteUrl}\n\nThis link expires in 48 hours.`,
  });
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Reset your CBA Community password',
    text: `You requested a password reset for your CBA Community account.\n\nClick here to set a new password: ${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
  });
}

async function sendDirectMessageEmail(toEmail, senderName, messagePreview, inboxUrl) {
  const name = sanitizeForEmail(senderName, 100);
  const preview = sanitizeForEmail(messagePreview, 300);
  try {
    await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: `${name} sent you a message`,
      text: `${name} sent you a message:\n\n"${preview}"\n\nReply here: ${inboxUrl}`,
    });
  } catch (err) {
    console.error('Failed to send direct message email:', err);
  }
}

module.exports = { sendInviteEmail, sendPasswordResetEmail, sendDirectMessageEmail, sanitizeForEmail };
