import { WHATS_NEW_ICONS, type WhatsNewInput } from '@trading/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useSendWhatsNew } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented, Textarea } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';

type Item = WhatsNewInput['items'][number];
const emptyItem = (): Item => ({ kind: 'new', icon: 'check', title: '', text: '' });

/** The "what's new" e-mail: version, title, intro and the changes; a test to yourself, then to everyone. */
export function AdminWhatsNew() {
  const t = useT().admin.whatsNew;
  const send = useSendWhatsNew();
  const [form, setForm] = useState<Omit<WhatsNewInput, 'test'>>({ version: '', title: '', intro: '', items: [emptyItem()] });
  const [note, setNote] = useState<string | null>(null);

  const setItem = (index: number, patch: Partial<Item>) => setForm((f) => ({ ...f, items: f.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  const submit = (test: boolean) => {
    if (!test && !window.confirm(t.confirmAll)) return;
    setNote(null);
    send.mutate({ ...form, test }, { onSuccess: ({ recipients }) => setNote(test ? t.testSent : t.queued(recipients)) });
  };

  return (
    <section className="card flex flex-col gap-5 p-5">
      <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Field label={t.version}>
          <Input value={form.version} maxLength={20} onChange={(e) => setForm({ ...form, version: e.target.value })} />
        </Field>
        <Field label={t.title}>
          <Input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
      </div>
      <Field label={t.intro}>
        <Textarea rows={2} value={form.intro} maxLength={400} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
      </Field>

      <div className="flex flex-col gap-3">
        <span className="eyebrow">{t.items}</span>
        {form.items.map((item, i) => (
          <div key={i} className="grid gap-3 rounded-(--radius-control) bg-raised p-3 md:grid-cols-[auto_11rem_minmax(0,1fr)_auto] md:items-center">
            <Segmented<Item['kind']>
              label={t.items}
              value={item.kind}
              onChange={(kind) => setItem(i, { kind })}
              options={[
                { value: 'new', label: t.kind.new },
                { value: 'fix', label: t.kind.fix },
              ]}
            />
            <Select<Item['icon']> aria-label={t.items} value={item.icon} onChange={(icon) => setItem(i, { icon })} options={WHATS_NEW_ICONS.map((icon) => ({ value: icon, label: t.icons[icon] }))} />
            <Input aria-label={t.itemTitle} placeholder={t.itemTitle} value={item.title} maxLength={80} onChange={(e) => setItem(i, { title: e.target.value })} />
                        <Button size="sm" variant="ghost" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}>
              {t.remove}
            </Button>
            <Input aria-label={t.itemText} placeholder={t.itemText} value={item.text} maxLength={300} onChange={(e) => setItem(i, { text: e.target.value })} className="md:col-span-4" />
          </div>
        ))}
        {form.items.length < 8 && (
          <Button size="sm" className="self-start" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })}>
            {t.addItem}
          </Button>
        )}
      </div>

      {send.error && (
        <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-sm text-sell">
          {(send.error instanceof ApiError ? send.error.lines : [send.error.message]).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {note && (
        <p role="status" className="m-0 rounded-(--radius-control) bg-buy-soft p-3 text-sm text-buy">
          {note}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button disabled={send.isPending} onClick={() => submit(true)}>
          {t.sendTest}
        </Button>
        <Button variant="primary" disabled={send.isPending} onClick={() => submit(false)}>
          {t.sendAll}
        </Button>
      </div>
    </section>
  );
}
