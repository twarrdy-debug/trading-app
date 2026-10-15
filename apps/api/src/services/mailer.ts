import nodemailer from 'nodemailer';

/** One message: always plain text, and an HTML version for the designed e-mails (services/emails.ts). */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** One-click unsubscribe (List-Unsubscribe headers) for the e-mails a user can turn off. */
  unsubscribeUrl?: string;
}

/** Outgoing e-mail. Swap the transport (SMTP, Resend, SES…) without touching the callers. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
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
    async send({ to, subject, text, html, unsubscribeUrl }) {
      await transport.sendMail({
        from,
        to,
        subject,
        text,
        ...(html ? { html } : {}),
        ...(unsubscribeUrl ? { list: { unsubscribe: unsubscribeUrl }, headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
      });
    },
  };
}
