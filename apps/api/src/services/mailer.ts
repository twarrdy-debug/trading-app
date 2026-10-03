import nodemailer from 'nodemailer';

/** Outgoing e-mail. Swap the transport (SMTP, Resend, SES…) without touching the callers. */
export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** Until an e-mail provider is configured: writes the message (with its links) to the server log. */
export const logMailer = (log: (msg: string) => void): Mailer => ({
  async send({ to, subject, text }) {
    log(`E-mail to ${to}: ${subject}\n${text}`);
  },
});

/**
 * Sends through any SMTP server given as a URL, so the provider is a configuration change:
 * Resend `smtps://resend:<API key>@smtp.resend.com:465`, Brevo, SES, Gmail with an app password…
 */
export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}
