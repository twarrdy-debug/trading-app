import { APP_NAME } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { LogoMark, Wordmark } from '../../components/ui/Brand.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { usePageMeta } from '../../lib/seo.ts';
import privacyEn from './privacy.md?raw';
import privacyPl from './polityka-prywatnosci.md?raw';
import termsPl from './regulamin.md?raw';
import termsEn from './terms.md?raw';

const linkClass = 'font-semibold text-accent-ink underline-offset-2 hover:underline';

/** Bold text, web addresses and support addresses inside a line. Builds elements, never HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s),]+[^\s),.]|[\w.+-]+@alphalogfx\.com)/g).map((part, i) => {
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} className={linkClass}>{part}</a>;
    if (part.endsWith('@alphalogfx.com')) return <a key={i} href={`mailto:${part}`} className={linkClass}>{part}</a>;
    return part;
  });
}

const cells = (line: string) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** The few Markdown forms the legal texts use: headings, a note, lists, a table and paragraphs. */
function render(markdown: string) {
  const out: ReactNode[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (line.startsWith('# ')) {
      out.push(<h1 key={i} className="m-0 text-3xl font-extrabold tracking-tight">{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      out.push(<h2 key={i} className="m-0 mt-5 text-lg font-extrabold">{line.slice(3)}</h2>);
    } else if (line.startsWith('> ')) {
      out.push(<p key={i} className="m-0 rounded-(--radius-control) bg-accent/10 px-4 py-3 text-sm">{inline(line.slice(2))}</p>);
    } else if (line.startsWith('|')) {
      let end = i;
      while (lines[end]?.startsWith('|')) end++;
      const [head, , ...rows] = lines.slice(i, end);
      i = end - 1;
      out.push(
        <div key={i} className="overflow-x-auto rounded-(--radius-control) border border-line">
          <table className="w-full border-collapse text-left text-[13.5px]">
            <thead>
              <tr>{cells(head!).map((c) => <th key={c} className="border-b border-line p-3 font-bold">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row}>{cells(row).map((c) => <td key={c} className="border-b border-line p-3 align-top [tr:last-child_&]:border-b-0">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^(\d+\.|-) /.test(line)) {
      const ordered = /^\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(\d+\.|-) /.test(lines[i]!)) items.push(lines[i++]!.replace(/^(\d+\.|-) /, ''));
      i--;
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={i} className={`m-0 flex flex-col gap-2 pl-5 text-[14.5px] leading-relaxed ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item) => <li key={item}>{inline(item)}</li>)}
        </List>,
      );
    } else {
      out.push(<p key={i} className="m-0 text-[14.5px] leading-relaxed">{inline(line)}</p>);
    }
  }
  return out;
}

/** The Terms and the Privacy Policy, public and in the visitor's language. */
function LegalPage({ pl, en, title }: { pl: string; en: string; title: string }) {
  const language = useLanguage();
  usePageMeta({ title: `${title} · ${APP_NAME}`, index: false });
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8 md:py-12">
        <Link to="/" className="mb-3 flex items-center gap-2 self-start text-ink no-underline">
          <LogoMark size={30} />
          <Wordmark className="text-lg" />
        </Link>
        {render(language === 'pl' ? pl : en)}
      </main>
    </div>
  );
}

export function TermsPage() {
  return <LegalPage pl={termsPl} en={termsEn} title={useT().legal.terms} />;
}

export function PrivacyPage() {
  return <LegalPage pl={privacyPl} en={privacyEn} title={useT().legal.privacy} />;
}

/** "the Terms" and "the Privacy Policy" as links opening in a new tab, so an unfinished form stays. */
export function LegalLinks({ separator }: { separator?: string }) {
  const t = useT().legal;
  return (
    <>
      <Link to="/regulamin" target="_blank" className={linkClass}>{t.terms}</Link>
      {separator ?? ' · '}
      <Link to="/prywatnosc" target="_blank" className={linkClass}>{t.privacy}</Link>
    </>
  );
}
