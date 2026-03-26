const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM;

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

module.exports = { sendInviteEmail, sendPasswordResetEmail };
