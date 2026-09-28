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
