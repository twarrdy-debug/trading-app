import { APP_NAME, type Language } from '@trading/shared';
import { t } from '../i18n.ts';
import type { MailMessage } from './mailer.ts';

/**
 * HTML e-mails in the app's "Chmura" look (mockups: https://claude.ai/artifact/9CabE6U4YCtJfP17LmKgus).
 * Mail clients ignore stylesheets, flexbox and web fonts in places, so the markup is tables with
 * inline styles and Manrope falls back to Arial. Every message also has a plain-text part.
 */
const C = {
  ground: '#eef1f5',
  panel: '#ffffff',
  raised: '#f7f9fb',
  ink: '#18202b',
  dim: '#5f6b7a',
  accent: '#FFB020',
  accentInk: '#a8730f',
  accentSoft: '#fff4de',
};
const FONT = "Manrope, 'Segoe UI', Arial, sans-serif";

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** A white card with rounded corners (square in Outlook, which is fine). */
const card = (inner: string, padding = '36px 40px', align = 'left') =>
  `<tr><td style="padding:0 0 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.panel};border-radius:18px"><tr><td style="padding:${padding};text-align:${align}">${inner}</td></tr></table></td></tr>`;

const button = (label: string, url: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px auto 0"><tr><td style="background:${C.accent};border-radius:12px"><a href="${escape(url)}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:${C.ink};text-decoration:none">${escape(label)}</a></td></tr></table>`;

/** "AlphaLog" with "FX" in the accent, as in the app. */
const wordmark = `${escape(APP_NAME.replace(/FX$/, ''))}<span style="color:${C.accentInk}">FX</span>`;

/** The page around the cards: logo row, the cards, and the small print below. */
function layout({ language, publicUrl, preheader, cards, footer }: { language: Language; publicUrl: string; preheader: string; cards: string; footer: string }) {
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">
<title>${escape(APP_NAME)}</title>
</head>
<body style="margin:0;padding:0;background:${C.ground}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.ground}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;font-family:${FONT};color:${C.ink}">
<tr><td style="padding:0 8px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td style="width:32px"><img src="${escape(publicUrl)}/logo-mail.png" width="32" height="32" alt="" style="display:block;border:0;border-radius:9px"></td>
<td style="padding-left:10px;font-size:18px;font-weight:800;letter-spacing:-0.02em">${wordmark}</td>
</tr></table>
</td></tr>
${cards}
<tr><td style="padding:8px 12px 0;font-size:12px;line-height:1.5;color:${C.dim};text-align:center">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Icons for the round tile above a message's title (plain characters: mail clients drop SVG). */
const ICONS = { mail: '&#9993;', key: '&#8635;', invite: '&#10022;' } as const;

/**
 * One message with a single action: an icon, the title, a sentence, the button, a note under it,
 * an optional box (e.g. an invitation code), the link spelled out for when the button does not
 * work, and the small print below.
 */
function actionEmail(o: {
  language: Language;
  publicUrl: string;
  to: string;
  subject: string;
  icon: keyof typeof ICONS;
  title: string;
  body: string;
  button: string;
  url: string;
  note?: string;
  box?: { label: string; value: string };
  footer: string;
  text: string;
}): MailMessage {
  const icon = `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 16px"><tr><td style="width:64px;height:64px;border-radius:18px;background:${C.accentSoft};text-align:center;font-size:30px;line-height:64px;color:${C.accentInk}">${ICONS[o.icon]}</td></tr></table>`;
  const box = o.box
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px auto 0"><tr><td style="padding:12px 22px;border-radius:12px;background:${C.raised};text-align:center"><div style="font-size:12px;color:${C.dim}">${escape(o.box.label)}</div><div style="margin-top:2px;font-size:20px;font-weight:800;letter-spacing:0.08em">${escape(o.box.value)}</div></td></tr></table>`
    : '';
  const cards =
    card(
      `${icon}<h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em">${escape(o.title)}</h1>` +
        `<p style="margin:0 auto 16px;max-width:440px;font-size:15px;line-height:1.6;color:${C.dim}">${escape(o.body)}</p>` +
        button(o.button, o.url) +
        (o.note ? `<p style="margin:14px 0 0;font-size:13px;color:${C.dim}">${escape(o.note)}</p>` : '') +
        box,
      '40px 40px 36px',
      'center',
    ) +
    card(
      `<p style="margin:0 0 8px;font-size:13px;color:${C.dim}">${escape(t(o.language, 'mailFallback'))}</p>` +
        `<p style="margin:0;padding:10px 12px;border-radius:10px;background:${C.raised};font-size:12px;line-height:1.5;word-break:break-all"><a href="${escape(o.url)}" style="color:${C.accentInk}">${escape(o.url)}</a></p>`,
      '20px 28px',
    );
  return {
    to: o.to,
    subject: o.subject,
    html: layout({ language: o.language, publicUrl: o.publicUrl, preheader: o.body, cards, footer: escape(o.footer) }),
    text: o.text,
  };
}

/** "Confirm your e-mail address": the link that activates a new account. */
export function verificationEmail({ language, publicUrl, name, email, url }: { language: Language; publicUrl: string; name: string; email: string; url: string }): MailMessage {
  const p = { name, app: APP_NAME };
  return actionEmail({
    language,
    publicUrl,
    to: email,
    subject: t(language, 'verifySubject', p),
    icon: 'mail',
    title: t(language, 'verifyTitle'),
    body: t(language, 'verifyBody', p),
    button: t(language, 'verifyButton'),
    url,
    note: t(language, 'verifyValid'),
    footer: t(language, 'verifyIgnore'),
    text: t(language, 'verifyText', { ...p, url }),
  });
}

/** "Set a new password": the link from "forgot password" (valid one hour). */
export function passwordResetEmail({ language, publicUrl, email, url }: { language: Language; publicUrl: string; email: string; url: string }): MailMessage {
  return actionEmail({
    language,
    publicUrl,
    to: email,
    subject: t(language, 'resetSubject'),
    icon: 'key',
    title: t(language, 'resetTitle'),
    body: t(language, 'resetIntro'),
    button: t(language, 'resetButton'),
    url,
    note: t(language, 'resetValid'),
    footer: t(language, 'resetIgnore'),
    text: t(language, 'resetBody', { url }),
  });
}

/** An invitation from an admin: the sign-up link with the code filled in, and the code itself. */
export function invitationEmail(o: { language: Language; publicUrl: string; email: string; url: string; inviter: string; code: string; expires: string | null }): MailMessage {
  const p = { inviter: o.inviter, app: APP_NAME };
  return actionEmail({
    language: o.language,
    publicUrl: o.publicUrl,
    to: o.email,
    subject: t(o.language, 'inviteSubject'),
    icon: 'invite',
    title: t(o.language, 'inviteTitle', p),
    body: t(o.language, 'inviteIntro', p),
    button: t(o.language, 'inviteButton'),
    url: o.url,
    note: o.expires ? t(o.language, 'inviteValid', { expires: o.expires }) : undefined,
    box: { label: t(o.language, 'inviteCodeLabel'), value: o.code },
    footer: t(o.language, 'inviteIgnore'),
    text: t(o.language, 'inviteBody', { inviter: o.inviter, url: o.url, code: o.code, expires: o.expires ?? '—' }),
  });
}
