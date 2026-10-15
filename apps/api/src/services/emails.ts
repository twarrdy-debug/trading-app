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

/** "Confirm your e-mail address": the link that activates a new account. */
export function verificationEmail({ language, publicUrl, name, email, url }: { language: Language; publicUrl: string; name: string; email: string; url: string }): MailMessage {
  const p = { name, app: APP_NAME };
  const icon = `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 16px"><tr><td style="width:64px;height:64px;border-radius:18px;background:${C.accentSoft};text-align:center;font-size:30px;line-height:64px;color:${C.accentInk}">&#9993;</td></tr></table>`;
  const cards =
    card(
      `${icon}<h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em">${escape(t(language, 'verifyTitle'))}</h1>` +
        `<p style="margin:0 auto 16px;max-width:440px;font-size:15px;line-height:1.6;color:${C.dim}">${escape(t(language, 'verifyBody', p))}</p>` +
        button(t(language, 'verifyButton'), url) +
        `<p style="margin:14px 0 0;font-size:13px;color:${C.dim}">${escape(t(language, 'verifyValid'))}</p>`,
      '40px 40px 36px',
      'center',
    ) +
    card(
      `<p style="margin:0 0 8px;font-size:13px;color:${C.dim}">${escape(t(language, 'mailFallback'))}</p>` +
        `<p style="margin:0;padding:10px 12px;border-radius:10px;background:${C.raised};font-size:12px;line-height:1.5;word-break:break-all"><a href="${escape(url)}" style="color:${C.accentInk}">${escape(url)}</a></p>`,
      '20px 28px',
    );
  return {
    to: email,
    subject: t(language, 'verifySubject', p),
    html: layout({ language, publicUrl, preheader: t(language, 'verifyBody', p), cards, footer: escape(t(language, 'verifyIgnore')) }),
    text: t(language, 'verifyText', { ...p, url }),
  };
}
