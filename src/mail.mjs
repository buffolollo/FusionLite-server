/** Invio via Gmail SMTP (password per le app, porta 465 TLS). */

import nodemailer from 'nodemailer';
import { MailError } from './errors.mjs';

export async function sendReport({ cfg, subject, text, html }) {
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: cfg.gmailUser,
      pass: cfg.gmailAppPassword,
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });

  try {
    const info = await transport.sendMail({
      from: { name: 'FusionLite Report', address: cfg.mailFrom },
      to: cfg.recipients,
      subject,
      text,
      html,
      headers: { 'X-FusionLite-Report': 'daily' },
    });
    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    };
  } catch (error) {
    throw new MailError(`Invio non riuscito: ${error.message}`);
  } finally {
    transport.close();
  }
}
