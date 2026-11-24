import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Dices,
  EyeOff,
  GraduationCap,
  Layers,
  Lightbulb,
  Lock,
  Smile,
  Sparkles,
  Users,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AUDIENCES, type Audience, type CompanionTip, type TipAction, type ToolId } from '@/lib/companion/model';
import { NEEDS, RECIPES, TOOL_CAPABILITIES, toolsFor, type Abilities, type RecipeId } from '@/lib/companion/registry';
import { classModeOn, setClassMode } from '@/lib/learn/class-mode';
import { learnPath } from '@/lib/learn/routes';
import { TOOLS, pathForView } from '@/components/shell/tools';
import type { MenuView } from './actions';

// Sketchy's menu (ADR-0024): a compact panel beside him. Every entry does
// something real or leads to the right place, and appears only when it can
// work for this person (their plan, Learn, the worksheets, the capabilities
// an admin opened). Guided help never claims to have looked at a drawing: it
// asks what the person wants to improve and opens the tools for it, alone or
// as a short plan of tools that work together.

const item =
  'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[15px] font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface MenuProps {
  view: MenuView;
  setView: (view: MenuView) => void;
  onClose: () => void;
  can: Abilities;
  locale: 'en' | 'he';
  audience: Audience | null;
  /** Drawing tips (only-when-asked tips) this person may see. */
  drawingTips: CompanionTip[];
  pickDrawingTip: () => CompanionTip | null;
  runAction: (action: TipAction) => void;
  openRoulette: (options: { classMode?: boolean }) => void;
  surprise: () => void;
  nextLesson: { href: string; label: string; loading: boolean } | null;
  saveAudience: (audience: Audience | null) => Promise<boolean>;
  hide: () => Promise<boolean>;
  /** Placed on screen (it is measured hidden first): only then can it take the focus. */
  ready: boolean;
  style?: React.CSSProperties;
}

export const Menu = forwardRef<HTMLDivElement, MenuProps>(function Menu(props, ref) {
  const { view, setView, onClose, can, locale, ready } = props;
  const t = useTranslations('companion');
  const panel = useRef<HTMLDivElement | null>(null);

  // Focus moves into the menu (to each new view's first choice) once it is on screen, and Escape closes it.
  const body = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ready) return;
    const id = window.requestAnimationFrame(() => {
      body.current?.querySelector<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [view, ready]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const titleId = 'sketchy-menu-title';
  const title =
    view === 'main' ? t('menu.title') : view === 'tip' ? t('tip.title') : view === 'improve' ? t('improve.title') : view === 'choose' ? t('choose.title') : view === 'lesson' ? t('lesson.title') : view === 'sheets' ? t('sheets.title') : view === 'class' ? t('class.title') : view === 'about' ? t('about.title') : t('hide.title');

  return (
    <div
      ref={(el) => {
        panel.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      role="dialog"
      aria-labelledby={titleId}
      data-sketchy-menu={view}
      className="pointer-events-auto absolute z-40 w-[min(340px,calc(100vw-24px))] rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl transition-none animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none"
      style={props.style}
    >
      <div className="flex items-center gap-1 px-1 pb-1">
        {view !== 'main' && (
          <button type="button" onClick={() => setView('main')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
            <span className="sr-only">{t('menu.back')}</span>
          </button>
        )}
        <h2 id={titleId} className="min-w-0 flex-1 px-2 text-base font-semibold text-foreground">
          {title}
        </h2>
        <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-sketchy-menu-close>
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('menu.close')}</span>
        </button>
      </div>
      <div ref={body} className="max-h-[min(60vh,440px)] overflow-y-auto px-1 pb-1">
        {view === 'main' && <MainView {...props} />}
        {view === 'tip' && <TipView {...props} />}
        {view === 'improve' && <ImproveView can={can} />}
        {view === 'choose' && <ChooseView can={can} />}
        {view === 'lesson' && <LessonView next={props.nextLesson} can={can} />}
        {view === 'sheets' && <SheetsView {...props} />}
        {view === 'class' && <ClassView {...props} />}
        {view === 'about' && <AboutView audience={props.audience} save={props.saveAudience} done={() => setView('main')} />}
        {view === 'hide' && <HideView hide={props.hide} keep={() => setView('main')} />}
      </div>
      <span className="sr-only" lang={locale} />
    </div>
  );
});

function Entry({ icon: Icon, label, onClick, data, chevron = false }: { icon: LucideIcon; label: string; onClick: () => void; data: string; chevron?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={item} data-menu-entry={data}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden="true" />}
    </button>
  );
}

function MainView({ can, setView, openRoulette, surprise, drawingTips, onClose }: MenuProps) {
  const t = useTranslations('companion.menu');
  const guide = can.companion('guide');
  const classroom = can.companion('classroom');
  return (
    <div className="space-y-0.5">
      <p className="px-3 pb-1 text-sm text-muted-foreground">{t('lead')}</p>
      <Entry icon={Wand2} label={t('surprise')} onClick={surprise} data="surprise" />
      {guide && drawingTips.length > 0 && <Entry icon={Lightbulb} label={t('tip')} onClick={() => setView('tip')} data="tip" chevron />}
      {can.companion('roulette') && can.challenges === 'open' && (
        <Entry
          icon={Dices}
          label={t('challenge')}
          onClick={() => {
            onClose();
            openRoulette({});
          }}
          data="challenge"
        />
      )}
      {guide && <Entry icon={Sparkles} label={t('improve')} onClick={() => setView('improve')} data="improve" chevron />}
      {guide && <Entry icon={Layers} label={t('chooseTool')} onClick={() => setView('choose')} data="choose" chevron />}
      {guide && can.course === 'open' && <Entry icon={BookOpen} label={t('lesson')} onClick={() => setView('lesson')} data="lesson" chevron />}
      {classroom && can.worksheets && can.tool('grid') === 'open' && <Entry icon={GraduationCap} label={t('sheets')} onClick={() => setView('sheets')} data="sheets" chevron />}
      {classroom && can.challenges === 'open' && <Entry icon={Users} label={t('classPrep')} onClick={() => setView('class')} data="class" chevron />}
      <div className="my-1 border-t border-border" />
      <Entry icon={Smile} label={t('about')} onClick={() => setView('about')} data="about" chevron />
      <Entry icon={EyeOff} label={t('hide')} onClick={() => setView('hide')} data="hide" chevron />
    </div>
  );
}

function TipView({ pickDrawingTip, runAction, can, locale }: MenuProps) {
  const t = useTranslations('companion');
  const [tip, setTip] = useState<CompanionTip | null>(() => pickDrawingTip());
  const action = tip && tip.action.type !== 'none' ? tip.action : null;
  if (!tip) return <p className="px-3 py-2 text-[15px] text-foreground">{t('tip.none')}</p>;
  return (
    <div className="px-2 pb-1" data-menu-tip={tip.id}>
      <p aria-live="polite" className="rounded-xl bg-secondary/60 p-3 text-[15px] leading-relaxed text-foreground">
        {tip.text[locale]}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {action && (
          <button type="button" onClick={() => runAction(action)} className="inline-flex min-h-[40px] items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {action.label[locale]}
          </button>
        )}
        <button type="button" onClick={() => setTip(pickDrawingTip())} className="inline-flex min-h-[40px] items-center rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-menu-another>
          {t('sign.another')}
        </button>
      </div>
    </div>
  );
}

/** A tool as a row: its studio name and one line, and whether this plan opens it. */
function ToolRow({ tool, can, lead }: { tool: ToolId; can: Abilities; lead?: string }) {
  const t = useTranslations();
  const state = can.tool(tool);
  const Icon = TOOLS[tool].icon;
  if (state === 'absent') return null;
  return (
    <Link href={pathForView(tool)} className={`${item} items-start`} data-menu-tool={tool} data-state={state}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{t(`tools.${tool}.title`)}</span>
          {state === 'locked' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground/80">
              <Lock className="h-3 w-3" aria-hidden="true" /> {t('companion.improve.locked')}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{lead ?? t(`tools.${tool}.description`)}</span>
      </span>
    </Link>
  );
}

function ImproveView({ can }: { can: Abilities }) {
  const t = useTranslations('companion.improve');
  const [need, setNeed] = useState<(typeof NEEDS)[number] | null>(null);
  if (need) {
    return (
      <div className="space-y-0.5">
        <p className="px-3 pb-1 text-sm font-semibold text-foreground">{t(`needs.${need}.title`)}</p>
        {toolsFor(need).map((tool) => (
          <ToolRow key={tool} tool={tool} can={can} />
        ))}
        <button type="button" onClick={() => setNeed(null)} className="px-3 py-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('title')}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {NEEDS.filter((n) => toolsFor(n).some((tool) => can.tool(tool) !== 'absent')).map((n) => (
        <button key={n} type="button" onClick={() => setNeed(n)} className={`${item} items-start`} data-menu-need={n}>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t(`needs.${n}.title`)}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{t(`needs.${n}.lead`)}</span>
          </span>
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden="true" />
        </button>
      ))}
      <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('recipesTitle')}</p>
      {(Object.keys(RECIPES) as RecipeId[])
        .filter((id) => RECIPES[id].every((tool) => can.tool(tool) !== 'absent'))
        .map((id) => (
          <Recipe key={id} id={id} can={can} />
        ))}
    </div>
  );
}

function Recipe({ id, can }: { id: RecipeId; can: Abilities }) {
  const t = useTranslations();
  return (
    <div className="mx-1 mb-2 rounded-xl border border-border p-2" data-menu-recipe={id}>
      <p className="px-1 pb-1 text-sm font-semibold text-foreground">{t(`companion.improve.recipes.${id}`)}</p>
      <ol className="space-y-1">
        {RECIPES[id].map((tool: ToolId, i) => {
          const state = can.tool(tool);
          return (
            <li key={tool}>
              <Link href={pathForView(tool)} className="flex min-h-[40px] items-center gap-2 rounded-lg px-2 text-sm text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-state={state}>
                <span className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">{t('companion.improve.step', { number: i + 1 })}</span>
                <span className="min-w-0 flex-1 font-medium">{t(`tools.${tool}.title`)}</span>
                {state === 'locked' && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t('companion.improve.locked')} />}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ChooseView({ can }: { can: Abilities }) {
  const t = useTranslations('companion.choose');
  const order: ToolId[] = useMemo(() => ['value', 'measure', 'grid', 'color', 'compare'], []);
  return (
    <div className="space-y-0.5">
      <p className="px-3 pb-1 text-sm text-muted-foreground">{t('lead')}</p>
      {order.filter((tool) => TOOL_CAPABILITIES[tool]).map((tool) => (
        <ToolRow key={tool} tool={tool} can={can} />
      ))}
    </div>
  );
}

function LessonView({ next, can }: { next: MenuProps['nextLesson']; can: Abilities }) {
  const t = useTranslations('companion.lesson');
  if (can.course !== 'open') return <p className="px-3 py-2 text-[15px] text-foreground">{t('none')}</p>;
  return (
    <div className="space-y-2 px-2 pb-1">
      {!next || next.loading ? (
        <p className="py-2 text-[15px] text-muted-foreground" role="status">
          {t('loading')}
        </p>
      ) : (
        <Link href={next.href} className="flex min-h-[48px] items-center gap-3 rounded-xl bg-primary px-3 py-2 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-menu-next-lesson>
          <BookOpen className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{next.label}</span>
        </Link>
      )}
      <Link href={learnPath({ screen: 'curriculum' })} className="inline-flex min-h-[40px] items-center px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t('course')}
      </Link>
    </div>
  );
}

function SheetsView({ can, runAction, openRoulette, onClose }: MenuProps) {
  const t = useTranslations('companion.sheets');
  if (!can.worksheets || can.tool('grid') !== 'open') return <p className="px-3 py-2 text-[15px] text-foreground">{t('none')}</p>;
  return (
    <div className="space-y-2 px-2 pb-1">
      <p className="text-[15px] leading-relaxed text-foreground">{t('lead')}</p>
      <button
        type="button"
        onClick={() => runAction({ type: 'worksheets', label: { en: '', he: '' } })}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-menu-sheets-open
      >
        <Layers className="h-4 w-4" aria-hidden="true" /> {t('open')}
      </button>
      {can.challenges === 'open' && can.companion('roulette') && (
        <button
          type="button"
          onClick={() => {
            onClose();
            openRoulette({ classMode: true });
          }}
          className="inline-flex min-h-[40px] items-center px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('fromChallenge')}
        </button>
      )}
    </div>
  );
}

function ClassView({ can, openRoulette, onClose }: MenuProps) {
  const t = useTranslations('companion.class');
  const [on, setOn] = useState(() => {
    try {
      return classModeOn(window.sessionStorage);
    } catch {
      return false;
    }
  });
  if (can.challenges !== 'open') return <p className="px-3 py-2 text-[15px] text-foreground">{t('none')}</p>;
  return (
    <div className="space-y-2 px-2 pb-1">
      <p className="text-[15px] leading-relaxed text-foreground">{t('lead')}</p>
      <button
        type="button"
        onClick={() => {
          onClose();
          openRoulette({ classMode: true });
        }}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-menu-class-spin
      >
        <Dices className="h-4 w-4" aria-hidden="true" /> {t('spin')}
      </button>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-2 text-[15px] text-foreground hover:bg-secondary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            try {
              setClassMode(window.sessionStorage, e.target.checked);
              setOn(e.target.checked);
            } catch {
              // No tab storage: class mode stays off.
            }
          }}
          className="h-5 w-5 accent-[hsl(var(--primary))]"
          data-menu-class-mode
        />
        {on ? t('classModeOn') : t('classMode')}
      </label>
    </div>
  );
}

function AboutView({ audience, save, done }: { audience: Audience | null; save: (a: Audience | null) => Promise<boolean>; done: () => void }) {
  const t = useTranslations('companion.about');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const choose = async (value: Audience | null) => {
    setStatus('saving');
    const ok = await save(value);
    setStatus(ok ? 'saved' : 'failed');
    if (ok) window.setTimeout(done, 900);
  };
  return (
    <div className="space-y-1 px-1 pb-1">
      <p className="px-2 pb-1 text-sm text-muted-foreground">{t('lead')}</p>
      {AUDIENCES.map((a) => (
        <button key={a} type="button" onClick={() => void choose(a)} aria-pressed={audience === a} disabled={status === 'saving'} className={`${item} ${audience === a ? 'bg-primary/15' : ''}`} data-menu-audience={a}>
          {t(a)}
        </button>
      ))}
      <button type="button" onClick={() => void choose(null)} aria-pressed={audience === null} disabled={status === 'saving'} className={`${item} text-muted-foreground`} data-menu-audience="none">
        {t('skip')}
      </button>
      <p role="status" className="min-h-[20px] px-2 text-sm text-foreground">
        {status === 'saved' ? t('saved') : status === 'failed' ? t('failed') : ''}
      </p>
    </div>
  );
}

function HideView({ hide, keep }: { hide: () => Promise<boolean>; keep: () => void }) {
  const t = useTranslations('companion.hide');
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  return (
    <div className="space-y-2 px-2 pb-1">
      <p className="text-[15px] leading-relaxed text-foreground">{t('lead')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={state === 'busy'}
          onClick={async () => {
            setState('busy');
            if (!(await hide())) setState('failed');
          }}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          data-menu-hide-confirm
        >
          {t('yes')}
        </button>
        <button type="button" onClick={keep} className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-[15px] font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('no')}
        </button>
      </div>
      {state === 'failed' && (
        <p role="alert" className="text-sm text-foreground">
          {t('failed')}
        </p>
      )}
    </div>
  );
}
