import type { Strategy } from '@trading/api/types';
import { MAX_STRATEGY_RULES } from '@trading/shared';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { useChangeStrategyRules, useDeleteStrategy, useSaveStrategy, useStrategies } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Textarea } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { useT } from '../../i18n/index.tsx';

const errorLines = (err: unknown) => (err instanceof ApiError ? err.lines : [err instanceof Error ? err.message : String(err)]);

function Errors({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export function AnalysisPage() {
  const t = useT().analysis;
  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
      <StrategiesPanel />
      <Panel title={t.dailyTitle}>
        <p className="m-0 px-5 pb-5 text-sm text-dim">{t.dailyText}</p>
      </Panel>
    </main>
  );
}

/** "My strategies": a list on the left, the selected strategy's name, description and entry rules on the right. */
function StrategiesPanel() {
  const all = useT();
  const t = all.analysis;
  const { data: strategies, isLoading } = useStrategies();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = strategies?.find((s) => s.id === selectedId) ?? strategies?.[0];

  return (
    <Panel
      title={t.strategies}
      actions={
        !creating && (
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            + {t.newStrategy}
          </Button>
        )
      }
    >
      <p className="m-0 px-5 text-sm text-dim">{t.strategiesIntro}</p>
      <div className="grid gap-4 p-5 md:grid-cols-[minmax(220px,280px)_1fr]">
        <div className="flex flex-col gap-2">
          {creating && (
            <NewStrategyForm
              onCancel={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                setSelectedId(id);
              }}
            />
          )}
          {isLoading && <span className="text-[13px] text-dim">{all.common.loading}</span>}
          {strategies?.length === 0 && !creating && <span className="text-[13px] text-dim">{t.empty}</span>}
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {strategies?.map((s) => {
              const active = s.id === selected?.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    aria-current={active || undefined}
                    className={`flex w-full flex-col items-start rounded-(--radius-control) px-3.5 py-2.5 text-left transition ${
                      active ? 'bg-chip text-ink' : 'bg-raised text-dim hover:text-ink'
                    }`}
                  >
                    <span className={`w-full truncate text-sm ${active ? 'font-bold' : 'font-semibold'}`}>{s.name}</span>
                    <span className="font-mono text-[11px] text-dim">{t.rules(s.rules.length)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {selected && <StrategyEditor key={selected.id} strategy={selected} autoFocusRule={selected.id === selectedId && selected.rules.length === 0} />}
      </div>
    </Panel>
  );
}

function NewStrategyForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const all = useT();
  const t = all.analysis;
  const save = useSaveStrategy();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const submit = () => {
    if (!name.trim()) return;
    setErrors([]);
    save.mutate({ input: { name: name.trim() } }, { onSuccess: (s) => onCreated(s.id), onError: (err) => setErrors(errorLines(err)) });
  };

  return (
    <form
      className="flex flex-col gap-2.5 rounded-(--radius-control) border border-line bg-panel p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label={t.name}>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
          placeholder={t.namePlaceholder}
          maxLength={80}
          className="font-sans"
        />
      </Field>
      <Errors lines={errors} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {all.common.cancel}
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!name.trim() || save.isPending}>
          {t.create}
        </Button>
      </div>
    </form>
  );
}

/** Name and description save on blur or Enter (like the settings page); rules save one by one. */
function StrategyEditor({ strategy, autoFocusRule }: { strategy: Strategy; autoFocusRule: boolean }) {
  const t = useT().analysis;
  const save = useSaveStrategy();
  const remove = useDeleteStrategy();
  const change = useChangeStrategyRules(strategy.id);
  const [name, setName] = useState(strategy.name);
  const [description, setDescription] = useState(strategy.description ?? '');
  const [newRule, setNewRule] = useState('');
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const newRuleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocusRule) newRuleRef.current?.focus();
  }, [autoFocusRule]);

  const onError = (err: unknown) => setErrors(errorLines(err));
  const run: typeof change.mutate = (input, options) => {
    setErrors([]);
    change.mutate(input, { onError, ...options });
  };

  const saveName = () => {
    const next = name.trim();
    if (!next) return setName(strategy.name);
    if (next !== strategy.name) save.mutate({ id: strategy.id, input: { name: next } }, { onError });
  };
  const saveDescription = () => {
    const next = description.trim() || null;
    if (next !== strategy.description) save.mutate({ id: strategy.id, input: { description: next } }, { onError });
  };
  const addRule = () => {
    const label = newRule.trim();
    if (!label) return;
    run({ op: 'add', label }, { onSuccess: () => setNewRule('') });
  };
  // The new order shows at once (no jump back while it saves); the saved strategy replaces it.
  const [order, setOrder] = useState<string[] | null>(null);
  const rules = order ? order.map((id) => strategy.rules.find((r) => r.id === id)!).filter(Boolean) : strategy.rules;
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rules.length) return;
    const ids = rules.map((r) => r.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    setOrder(ids);
    run({ op: 'order', ids }, { onSettled: () => setOrder(null) });
  };
  const drag = useDragReorder(reorder);
  const [checked, toggleChecked, clearChecked] = useEntryCheck(strategy.id);
  const keptCount = rules.filter((r) => checked.has(r.id)).length;
  const missing = rules.length - keptCount;
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur();
  const full = strategy.rules.length >= MAX_STRATEGY_RULES;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Field label={t.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={blurOnEnter} maxLength={80} className="font-sans font-semibold" />
        </Field>
        <Field label={t.description}>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            placeholder={t.descriptionPlaceholder}
            maxLength={2000}
            className="font-sans"
          />
        </Field>
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="m-0 text-sm font-bold">{t.rulesTitle}</h3>
            <span className="text-xs text-dim">{t.checkHelp}</span>
          </div>
          {rules.length > 0 && (
            <div className="flex items-center gap-2" aria-live="polite">
              <span className="font-mono text-sm font-semibold">{t.checkCount(keptCount, rules.length)}</span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  missing === 0 ? 'bg-buy-soft text-buy' : keptCount === 0 ? 'bg-chip text-dim' : 'bg-warn-bg text-warn'
                }`}
              >
                {missing === 0 ? t.checkOk : t.checkMissing(missing)}
              </span>
              {keptCount > 0 && (
                <Button size="sm" variant="ghost" onClick={clearChecked}>
                  {t.checkReset}
                </Button>
              )}
            </div>
          )}
        </div>
        {strategy.rules.length === 0 && <span className="text-[13px] text-dim">{t.rulesEmpty}</span>}
        <ol ref={drag.listRef} className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rules.map((rule, i) => (
            <li
              key={rule.id}
              style={drag.style(i)}
              className={`flex items-center gap-2 rounded-(--radius-control) bg-raised py-1.5 pr-1.5 pl-1 ${
                drag.active === i ? 'relative z-10 bg-panel! shadow-(--shadow-pop)' : drag.active != null ? 'transition-transform duration-150' : ''
              }`}
            >
              <button
                type="button"
                aria-label={t.dragHandle}
                title={t.dragHandle}
                {...drag.handleProps(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    reorder(i, i + (e.key === 'ArrowUp' ? -1 : 1));
                  }
                }}
                className={`flex h-8 w-6 shrink-0 touch-none items-center justify-center rounded-[8px] text-dim hover:bg-chip hover:text-ink ${
                  drag.active === i ? 'cursor-grabbing' : 'cursor-grab'
                }`}
              >
                <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
                  {[3, 8, 13].flatMap((y) => [<circle key={`a${y}`} cx="3.5" cy={y} r="1.4" />, <circle key={`b${y}`} cx="8.5" cy={y} r="1.4" />])}
                </svg>
              </button>
              {editingRule === rule.id ? (
                <RuleInput
                  initial={rule.label}
                  onCancel={() => setEditingRule(null)}
                  onSave={(label) => {
                    if (label === rule.label) return setEditingRule(null);
                    run({ op: 'edit', ruleId: rule.id, label }, { onSuccess: () => setEditingRule(null) });
                  }}
                />
              ) : (
                <label className="flex min-w-0 grow cursor-pointer items-center gap-3 py-0.5">
                  <input
                    type="checkbox"
                    checked={checked.has(rule.id)}
                    onChange={() => toggleChecked(rule.id)}
                    className="size-5 shrink-0 cursor-pointer accent-(--buy)"
                  />
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-panel font-mono text-[11px] font-semibold text-dim">{i + 1}</span>
                  <span className={`min-w-0 text-sm break-words select-none ${checked.has(rule.id) ? 'text-ink' : 'text-dim'}`}>{rule.label}</span>
                </label>
              )}
              {editingRule !== rule.id && (
                <div className="flex shrink-0 items-center">
                  <IconButton label={t.edit} onClick={() => setEditingRule(rule.id)}>
                    <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />
                  </IconButton>
                  <IconButton label={t.deleteRule} danger disabled={change.isPending} onClick={() => run({ op: 'delete', ruleId: rule.id })}>
                    <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ol>
        {!full && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              addRule();
            }}
          >
            <Input
              ref={newRuleRef}
              aria-label={t.addRule}
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder={t.rulePlaceholder}
              maxLength={200}
              className="grow font-sans"
            />
            <Button type="submit" size="md" disabled={!newRule.trim() || change.isPending} className="shrink-0 whitespace-nowrap">
              + {t.addRule}
            </Button>
          </form>
        )}
      </section>

      <Errors lines={errors} />

      <div className="flex justify-end border-t border-line pt-4">
        <Button
          size="sm"
          variant="danger"
          disabled={remove.isPending}
          onClick={() => window.confirm(t.confirmDelete(strategy.name)) && remove.mutate(strategy.id, { onError })}
        >
          {t.delete}
        </Button>
      </div>
    </div>
  );
}

function RuleInput({ initial, onSave, onCancel }: { initial: string; onSave: (label: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const commit = () => (value.trim() ? onSave(value.trim()) : onCancel());
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      maxLength={200}
      className="h-9 grow font-sans"
    />
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex size-8 items-center justify-center rounded-[9px] text-dim transition hover:bg-chip disabled:opacity-30 disabled:hover:bg-transparent ${
        danger ? 'hover:text-sell' : 'hover:text-ink'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/**
 * Drag to reorder a vertical list by a handle (mouse, pen or touch). The dragged row follows the
 * pointer, the rows it passes slide out of the way, and `onMove(from, to)` runs on release.
 */
function useDragReorder(onMove: (from: number, to: number) => void) {
  const listRef = useRef<HTMLOListElement>(null);
  const start = useRef<{ y: number; slots: { top: number; height: number }[]; gap: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);

  const targetIndex = (from: number, dy: number) => {
    const { slots } = start.current!;
    const center = slots[from]!.top + slots[from]!.height / 2 + dy;
    return slots.filter((slot, j) => j !== from && slot.top + slot.height / 2 < center).length;
  };

  const handleProps = (index: number) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || !listRef.current) return;
      const slots = [...listRef.current.children].map((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top, height: box.height };
      });
      const gap = slots.length > 1 ? slots[1]!.top - slots[0]!.top - slots[0]!.height : 0;
      start.current = { y: e.clientY, slots, gap };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from: index, to: index, dy: 0 });
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      if (!drag || !start.current) return;
      const dy = e.clientY - start.current.y;
      setDrag({ ...drag, dy, to: targetIndex(drag.from, dy) });
    },
    onPointerUp: () => {
      if (drag) onMove(drag.from, drag.to);
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
  });

  /** Row offsets while dragging: the dragged one follows the pointer, the passed ones make room. */
  const style = (index: number): CSSProperties | undefined => {
    if (!drag || !start.current) return undefined;
    if (index === drag.from) return { transform: `translateY(${drag.dy}px)` };
    const shift = start.current.slots[drag.from]!.height + start.current.gap;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: `translateY(${-shift}px)` };
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return { transform: `translateY(${shift}px)` };
    return undefined;
  };

  return { listRef, handleProps, style, active: drag?.from ?? null };
}

/**
 * Entry check: the rules ticked as seen on the chart, kept per strategy in this browser so a reload
 * does not lose them; "Clear" starts the next setup.
 */
function useEntryCheck(strategyId: string): [Set<string>, (ruleId: string) => void, () => void] {
  const key = `strategy-check:${strategyId}`;
  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const store = (next: Set<string>) => {
    setChecked(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // Without storage the ticks last until the page is left.
    }
  };
  const toggle = (ruleId: string) => {
    const next = new Set(checked);
    if (next.has(ruleId)) next.delete(ruleId);
    else next.add(ruleId);
    store(next);
  };
  return [checked, toggle, () => store(new Set())];
}
