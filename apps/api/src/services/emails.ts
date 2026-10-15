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

/** Characters for a release item's tile (mail clients drop SVG). */
const ITEM_ICONS = { import: '&#8595;', book: '&#167;', chart: '&#8599;', swap: '&#8644;', check: '&#10003;' } as const;

export interface WhatsNewItem {
  kind: 'new' | 'fix';
  icon: keyof typeof ITEM_ICONS;
  title: string;
  text: string;
}

/** "What's new": the changes of one release, sent after it reaches production. */
export function whatsNewEmail(o: { language: Language; publicUrl: string; email: string; unsubscribeUrl?: string; version: string; date: string; title: string; intro: string; items: WhatsNewItem[] }): MailMessage {
  const l = o.language;
  const pill = (label: string, bg: string, fg: string, size = 11) =>
    `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};color:${fg};font-size:${size}px;font-weight:700">${escape(label)}</span>`;
  const intro =
    `<p style="margin:0 0 12px">${pill(t(l, 'whatsNewBadge'), '#e6eefc', '#2f6fdb', 12)}<span style="padding-left:10px;font-size:12px;color:${C.dim}">${escape(t(l, 'whatsNewVersion', { version: o.version, date: o.date }))}</span></p>` +
    `<h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.02em">${escape(o.title)}</h1>` +
    `<p style="margin:0;font-size:15px;line-height:1.6;color:${C.dim}">${escape(o.intro)}</p>`;
  const rows = o.items
    .map((item, i) => {
      const isNew = item.kind === 'new';
      const border = i < o.items.length - 1 ? `border-bottom:1px solid ${C.ground};` : '';
      return (
        `<tr><td style="${border}padding:22px 0;vertical-align:top;width:44px">` +
        `<div style="width:44px;height:44px;border-radius:12px;background:${isNew ? C.accentSoft : '#f0f3f7'};text-align:center;font-size:22px;line-height:44px;color:${isNew ? C.accentInk : C.dim}">${ITEM_ICONS[item.icon]}</div></td>` +
        `<td style="${border}padding:22px 0 22px 18px;vertical-align:top">` +
        `<div style="margin-bottom:6px"><b style="font-size:16px">${escape(item.title)}</b>&nbsp; ${isNew ? pill(t(l, 'whatsNewNew'), '#e3f5eb', '#147a48') : pill(t(l, 'whatsNewFix'), '#f0f3f7', C.dim)}</div>` +
        `<div style="font-size:14px;line-height:1.55;color:${C.dim}">${escape(item.text)}</div></td></tr>`
      );
    })
    .join('');
  const list = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`;
  const cards =
    card(intro, '32px 36px') +
    card(list, '8px 32px') +
    `<tr><td align="center" style="padding:4px 0 16px">${button(t(l, 'whatsNewButton'), o.publicUrl)}</td></tr>`;
  const text =
    `${o.title}\n${t(l, 'whatsNewVersion', { version: o.version, date: o.date })}\n\n${o.intro}\n\n` +
    o.items.map((item) => `• ${item.title} (${t(l, item.kind === 'new' ? 'whatsNewNew' : 'whatsNewFix')}): ${item.text}`).join('\n') +
    `\n\n${t(l, 'whatsNewButton')}: ${o.publicUrl}\n\n${t(l, 'whatsNewFooter', { app: APP_NAME })}`;
  return {
    to: o.email,
    subject: t(l, 'whatsNewSubject', { app: APP_NAME, title: o.title }),
    html: layout({ language: l, publicUrl: o.publicUrl, preheader: o.intro, cards, footer: footer(l, o.publicUrl, t(l, 'updatesFooter'), o.unsubscribeUrl) }),
    text: o.unsubscribeUrl ? `${text}\n${t(l, 'mailUnsubscribe')}: ${o.unsubscribeUrl}` : text,
    unsubscribeUrl: o.unsubscribeUrl,
  };
}

// --- Regular e-mails ---------------------------------------------------------

const GREEN = '#147a48';
const RED = '#c0303c';
const SOFT = { green: '#e3f5eb', red: '#fce8ea', amber: '#fff4de', grey: '#f0f3f7' };

/** The small print: why it came, plus the settings and (when it can be turned off) unsubscribe links. */
function footer(language: Language, publicUrl: string, why: string, unsubscribeUrl?: string) {
  const link = (label: string, url: string) => `<a href="${escape(url)}" style="color:${C.accentInk}">${escape(label)}</a>`;
  const links = [unsubscribeUrl ? link(t(language, 'mailUnsubscribe'), unsubscribeUrl) : '', link(t(language, 'mailSettings'), `${publicUrl}/ustawienia/maile`)]
    .filter(Boolean)
    .join(' &middot; ');
  return `${escape(why)}<br>${links}`;
}

const pill = (label: string, bg: string, fg: string) =>
  `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:700;white-space:nowrap">${escape(label)}</span>`;

const centeredButton = (label: string, url: string) => `<tr><td align="center" style="padding:4px 0 16px">${button(label, url)}</td></tr>`;

/** A row of equal tiles (a table, so it holds in every mail client). */
const tiles = (cells: { value: string; label: string; bg: string; fg?: string; labelFg?: string; labelFirst?: boolean }[]) =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${cells
    .map((c, i) => {
      const value = `<div style="font-size:24px;font-weight:800;color:${c.fg ?? C.ink}">${c.value}</div>`;
      const label = `<div style="font-size:12px;font-weight:600;color:${c.labelFg ?? C.dim}">${escape(c.label)}</div>`;
      return `<td style="width:${Math.floor(100 / cells.length)}%;padding:0 ${i < cells.length - 1 ? 10 : 0}px 0 0;vertical-align:top"><div style="background:${c.bg};border-radius:14px;padding:14px 16px">${c.labelFirst ? label + value : value + label}</div></td>`;
    })
    .join('')}</tr></table>`;

/** An event row: time, currency, title with figures, impact. */
export interface MailEvent {
  time: string;
  currency: string;
  title: string;
  impact: 'high' | 'medium';
  forecast: string | null;
  previous: string | null;
}

function eventRows(language: Language, events: MailEvent[]) {
  return events
    .map((e) => {
      const figures = [e.forecast ? t(language, 'forecast', { value: e.forecast }) : '', e.previous ? t(language, 'previous', { value: e.previous }) : ''].filter(Boolean).join(' · ');
      const impact = e.impact === 'high' ? pill(t(language, 'impactHigh'), SOFT.red, RED) : pill(t(language, 'impactMedium'), SOFT.amber, '#8a5a00');
      return (
        `<tr><td style="border-top:1px solid ${C.ground};padding:11px 10px 11px 0;width:44px;font-size:13px;font-weight:700;vertical-align:middle">${escape(e.time)}</td>` +
        `<td style="border-top:1px solid ${C.ground};padding:11px 10px 11px 0;width:44px;vertical-align:middle"><div style="background:${SOFT.grey};border-radius:6px;padding:3px 0;text-align:center;font-size:11px;font-weight:800">${escape(e.currency)}</div></td>` +
        `<td style="border-top:1px solid ${C.ground};padding:11px 10px 11px 0;vertical-align:middle"><div style="font-size:14px;font-weight:600">${escape(e.title)}</div>${figures ? `<div style="font-size:12px;color:${C.dim}">${escape(figures)}</div>` : ''}</td>` +
        `<td style="border-top:1px solid ${C.ground};padding:11px 0;text-align:right;vertical-align:middle">${impact}</td></tr>`
      );
    })
    .join('');
}

const listCard = (heading: string, right: string, rows: string) =>
  card(
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding-bottom:8px;font-size:15px;font-weight:700">${escape(heading)}</td><td style="padding-bottom:8px;text-align:right;font-size:12px;color:${C.dim}">${right}</td></tr></table>` +
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`,
    '18px 24px 8px',
  );

/** The header line's right side ("Sunday, 18.10 · 18:00"). */
const dateline = (label: string) => `<tr><td style="padding:0 8px 12px;text-align:right;font-size:12px;color:${C.dim}">${escape(label)}</td></tr>`;

/** "Welcome": after the account is activated; three first steps and what the app does. */
export function welcomeEmail({ language: l, publicUrl, email, name }: { language: Language; publicUrl: string; email: string; name: string }): MailMessage {
  const p = { app: APP_NAME, name };
  const bars = [30, 45, 38, 60, 72, 66, 88]
    .map((h, i) => {
      const bg = i === 6 ? GREEN : i === 2 || i === 5 ? SOFT.red : SOFT.green;
      return `<td style="vertical-align:bottom;padding:0 4px"><div style="height:${Math.round(h)}px;background:${bg};border-radius:6px"></div></td>`;
    })
    .join('');
  const hero =
    `<p style="margin:0 0 14px">${pill(t(l, 'welcomeBadge'), C.accentSoft, '#8a5a00')}</p>` +
    `<h1 style="margin:0 0 14px;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.02em">${escape(t(l, 'welcomeTitle', p))}</h1>` +
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${C.dim}">${escape(t(l, 'welcomeIntro'))}</p>` +
    `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:${C.accent};border-radius:12px"><a href="${escape(publicUrl)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:${C.ink};text-decoration:none">${escape(t(l, 'welcomeButton'))}</a></td></tr></table>` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;background:${C.raised};border:1px solid #e1e6ec;border-radius:14px"><tr><td style="padding:18px 16px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="height:100px"><tr>${bars}</tr></table></td></tr></table>`;
  const steps = ([1, 2, 3] as const)
    .map(
      (n) =>
        `<tr><td style="width:30px;padding:9px 16px 9px 0;vertical-align:top"><div style="width:30px;height:30px;border-radius:999px;background:${C.ink};color:#ffffff;text-align:center;font-size:14px;font-weight:800;line-height:30px">${n}</div></td>` +
        `<td style="padding:9px 0;vertical-align:top"><div style="font-size:15px;font-weight:700">${escape(t(l, `welcomeStep${n}`))}</div><div style="font-size:14px;line-height:1.5;color:${C.dim}">${escape(t(l, `welcomeStep${n}Text`))}</div></td></tr>`,
    )
    .join('');
  const ICON = ['&#9636;', '&#9719;', '&#8644;', '&#8801;', '&#9638;', '&#8623;'];
  const features = ([1, 2, 3, 4, 5, 6] as const).map(
    (n) =>
      `<div style="background:${C.raised};border-radius:14px;padding:16px"><div style="font-size:18px;line-height:1;color:${C.accentInk}">${ICON[n - 1]}</div><div style="margin-top:8px;font-size:14px;font-weight:700">${escape(t(l, `welcomeF${n}`))}</div><div style="margin-top:4px;font-size:13px;line-height:1.45;color:${C.dim}">${escape(t(l, `welcomeF${n}Text`))}</div></div>`,
  );
  const grid = [0, 2, 4]
    .map((i) => `<tr><td style="width:50%;padding:0 6px 12px 0;vertical-align:top">${features[i]}</td><td style="width:50%;padding:0 0 12px 6px;vertical-align:top">${features[i + 1]}</td></tr>`)
    .join('');
  const cards =
    card(hero, '36px 36px 32px') +
    card(`<h2 style="margin:0 0 8px;font-size:18px;font-weight:800">${escape(t(l, 'welcomeStepsTitle'))}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${steps}</table>`, '28px 32px') +
    card(`<h2 style="margin:0 0 16px;font-size:18px;font-weight:800">${escape(t(l, 'welcomeFeaturesTitle'))}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${grid}</table>`, '28px 32px 16px');
  const text =
    `${t(l, 'welcomeTitle', p)}\n\n${t(l, 'welcomeIntro')}\n\n${t(l, 'welcomeStepsTitle')}\n` +
    ([1, 2, 3] as const).map((n) => `${n}. ${t(l, `welcomeStep${n}`)}: ${t(l, `welcomeStep${n}Text`)}`).join('\n') +
    `\n\n${t(l, 'welcomeButton')}: ${publicUrl}\n\n${t(l, 'welcomeFooter', p)}`;
  return {
    to: email,
    subject: t(l, 'welcomeSubject', p),
    html: layout({ language: l, publicUrl, preheader: t(l, 'welcomeIntro'), cards, footer: footer(l, publicUrl, t(l, 'welcomeFooter', p)) }),
    text,
  };
}

/** "The week ahead": Sunday evening, the coming week's high and medium events for the user's currencies. */
export function weekAheadEmail(o: {
  language: Language;
  publicUrl: string;
  email: string;
  unsubscribeUrl: string;
  dateline: string;
  range: string;
  currencies: string[];
  zone: string;
  busiest: string | null;
  days: { name: string; count: string; events: MailEvent[] }[];
}): MailMessage {
  const l = o.language;
  const all = o.days.flatMap((d) => d.events);
  const high = all.filter((e) => e.impact === 'high').length;
  const medium = all.length - high;
  const head =
    `<div style="font-size:13px;font-weight:600;color:${C.dim}">${escape(t(l, 'weekKicker'))}</div>` +
    `<h1 style="margin:8px 0;font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.02em">${escape(o.range)}</h1>` +
    `<p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:${C.dim}">${escape(t(l, 'weekScope', { currencies: o.currencies.join(', '), zone: o.zone }))}</p>` +
    tiles([
      { value: String(high), label: t(l, 'weekHigh'), bg: SOFT.red, fg: RED, labelFg: '#8e2430' },
      { value: String(medium), label: t(l, 'weekMedium'), bg: SOFT.amber, fg: '#8a5a00', labelFg: '#8a5a00' },
      { value: escape(o.busiest ?? '–'), label: t(l, 'weekBusiest'), bg: SOFT.grey },
    ]);
  const cards =
    dateline(o.dateline) +
    card(head, '30px 32px') +
    o.days.map((d) => listCard(d.name, escape(d.count), eventRows(l, d.events))).join('') +
    centeredButton(t(l, 'weekButton'), `${o.publicUrl}/kalendarz`);
  const text =
    `${t(l, 'weekKicker')}: ${o.range}\n${t(l, 'weekScope', { currencies: o.currencies.join(', '), zone: o.zone })}\n\n` +
    o.days.map((d) => `${d.name}\n${d.events.map((e) => `  ${e.time} ${e.currency} ${e.title} (${t(l, e.impact === 'high' ? 'impactHigh' : 'impactMedium')})`).join('\n')}`).join('\n\n') +
    `\n\n${t(l, 'weekButton')}: ${o.publicUrl}/kalendarz\n\n${t(l, 'weekFooter')}\n${t(l, 'mailUnsubscribe')}: ${o.unsubscribeUrl}`;
  return {
    to: o.email,
    subject: t(l, 'weekSubject', { range: o.range }),
    html: layout({ language: l, publicUrl: o.publicUrl, preheader: t(l, 'weekScope', { currencies: o.currencies.join(', '), zone: o.zone }), cards, footer: footer(l, o.publicUrl, t(l, 'weekFooter'), o.unsubscribeUrl) }),
    text,
    unsubscribeUrl: o.unsubscribeUrl,
  };
}

/** "Day summary": in the evening of a day with closed trades. Amounts come formatted. */
export function daySummaryEmail(o: {
  language: Language;
  publicUrl: string;
  email: string;
  unsubscribeUrl: string;
  dateline: string;
  date: string;
  accountLabel: string | null;
  pnl: string;
  positive: boolean;
  balanceLine: string | null;
  trades: string;
  winRate: string;
  rSum: string;
  rPositive: boolean;
  rows: { time: string; long: boolean; side: string; symbol: string; detail: string; pnl: string; win: boolean | null; r: string }[];
  checks: { ok: boolean; label: string }[];
  tomorrow: MailEvent[];
}): MailMessage {
  const l = o.language;
  const tone = (positive: boolean | null) => (positive == null ? C.dim : positive ? GREEN : RED);
  const head =
    `<div style="font-size:13px;font-weight:600;color:${C.dim}">${escape(t(l, 'dayKicker'))}${o.accountLabel ? ` · ${escape(o.accountLabel)}` : ''}</div>` +
    `<div style="margin:8px 0 6px;font-size:44px;line-height:1;font-weight:800;letter-spacing:-0.02em;color:${tone(o.positive)}">${escape(o.pnl)}</div>` +
    (o.balanceLine ? `<div style="font-size:14px;color:${C.dim}">${escape(o.balanceLine)}</div>` : '') +
    `<div style="height:18px"></div>` +
    tiles([
      { value: o.trades, label: t(l, 'dayTrades'), bg: C.raised, labelFirst: true },
      { value: escape(o.winRate), label: t(l, 'dayWinRate'), bg: C.raised, labelFirst: true },
      { value: escape(o.rSum), label: t(l, 'dayRSum'), bg: C.raised, fg: tone(o.rPositive), labelFirst: true },
    ]);
  const tradeRows = o.rows
    .map((r) => {
      const side = r.long ? pill(r.side, SOFT.green, GREEN) : pill(r.side, SOFT.red, RED);
      return (
        `<tr><td style="border-top:1px solid ${C.ground};padding:12px 10px 12px 0;width:44px;font-size:13px;font-weight:700">${escape(r.time)}</td>` +
        `<td style="border-top:1px solid ${C.ground};padding:12px 10px 12px 0;width:52px">${side}</td>` +
        `<td style="border-top:1px solid ${C.ground};padding:12px 10px 12px 0"><div style="font-size:14px;font-weight:700">${escape(r.symbol)}</div><div style="font-size:12px;color:${C.dim}">${escape(r.detail)}</div></td>` +
        `<td style="border-top:1px solid ${C.ground};padding:12px 0;text-align:right;white-space:nowrap"><div style="font-size:15px;font-weight:800;color:${tone(r.win)}">${escape(r.pnl)}</div><div style="font-size:12px;color:${C.dim}">${escape(r.r)}</div></td></tr>`
      );
    })
    .join('');
  const kept = o.checks.filter((c) => c.ok).length;
  const checks = o.checks
    .map(
      (c) =>
        `<tr><td style="width:22px;padding:6px 12px 6px 0"><div style="width:22px;height:22px;border-radius:999px;text-align:center;line-height:22px;font-size:12px;font-weight:800;background:${c.ok ? SOFT.green : SOFT.amber};color:${c.ok ? GREEN : '#8a5a00'}">${c.ok ? '&#10003;' : '!'}</div></td><td style="padding:6px 0;font-size:14px">${escape(c.label)}</td></tr>`,
    )
    .join('');
  const disciplineCard = card(
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding-bottom:8px;font-size:15px;font-weight:700">${escape(t(l, 'dayDiscipline'))}</td><td style="padding-bottom:8px;text-align:right;font-size:12px;font-weight:700;color:${kept === o.checks.length ? GREEN : '#8a5a00'}">${escape(t(l, 'dayChecksKept', { kept, total: o.checks.length }))}</td></tr></table>` +
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${checks}</table>`,
    '22px 24px',
  );
  const tomorrow = o.tomorrow.length
    ? listCard(t(l, 'dayTomorrow'), '', eventRows(l, o.tomorrow))
    : card(`<div style="font-size:15px;font-weight:700">${escape(t(l, 'dayTomorrow'))}</div><div style="margin-top:6px;font-size:14px;color:${C.dim}">${escape(t(l, 'dayTomorrowNone'))}</div>`, '18px 24px');
  const cards =
    dateline(o.dateline) +
    card(head, '30px 32px') +
    listCard(t(l, 'dayTrades'), '', tradeRows) +
    disciplineCard +
    tomorrow +
    centeredButton(t(l, 'dayButton'), `${o.publicUrl}/transakcje`);
  const text =
    `${t(l, 'dayKicker')} ${o.date}${o.accountLabel ? ` · ${o.accountLabel}` : ''}: ${o.pnl}\n` +
    (o.balanceLine ? `${o.balanceLine}\n` : '') +
    `${t(l, 'dayTrades')}: ${o.trades.replace(/<[^>]+>/g, '')} · ${t(l, 'dayWinRate')}: ${o.winRate} · ${t(l, 'dayRSum')}: ${o.rSum}\n\n` +
    o.rows.map((r) => `${r.time} ${r.side} ${r.symbol} ${r.detail}: ${r.pnl} (${r.r})`).join('\n') +
    `\n\n${t(l, 'dayDiscipline')}: ${o.checks.map((c) => `${c.ok ? '✓' : '!'} ${c.label}`).join(', ')}\n\n` +
    `${t(l, 'dayButton')}: ${o.publicUrl}/transakcje\n\n${t(l, 'dayFooter')}\n${t(l, 'mailUnsubscribe')}: ${o.unsubscribeUrl}`;
  return {
    to: o.email,
    subject: t(l, 'daySubject', { date: o.date, pnl: o.pnl }),
    html: layout({ language: l, publicUrl: o.publicUrl, preheader: `${o.pnl} · ${o.rows.length} ${t(l, 'dayTrades').toLowerCase()}`, cards, footer: footer(l, o.publicUrl, t(l, 'dayFooter'), o.unsubscribeUrl) }),
    text,
    unsubscribeUrl: o.unsubscribeUrl,
  };
}
