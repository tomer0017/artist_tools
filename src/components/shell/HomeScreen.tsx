import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { useIsMobile } from '@/hooks/use-mobile';
import { BrandMark } from './BrandMark';
import { AccountButton, AccountLine } from './account';
import { HOME_ORDER, TOOLS, TOOL_ART, pathForView } from './tools';
import type { TabId } from '@/types/project';

// ─── Home / Tool Hub ──────────────────────────────────────────────────────────
// The answer to "what can this app do for me, and where do I start?". Each card
// names a painter's goal, shows the outcome as a picture, and opens the tool in
// one tap. Nothing here needs a tutorial.

const ART = '/images/home/';

const HERO_FADE = 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.55) 30%, #000 62%, #000 88%, transparent 100%)';

export default function HomeScreen() {
  const isMobile = useIsMobile();
  const t = useTranslations('studio');
  const tl = useTranslations('landing');
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-background">
      <div className="mx-auto w-full max-w-6xl pb-8">
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pb-5 pt-3 md:px-6 md:pb-8 md:pt-8 lg:px-8">
          <div
            className="pointer-events-none absolute inset-y-0 end-0 w-[64%] md:w-[55%] rtl:-scale-x-100"
            style={{ maskImage: HERO_FADE, WebkitMaskImage: HERO_FADE }}
          >
            <img
              src={`${ART}home-hero.webp`}
              alt=""
              width={1199}
              height={1312}
              fetchPriority="high"
              decoding="async"
              // Phones: zoom toward the sketch and colour wheel so the palette
              // doesn't sit behind the headline.
              className="h-full w-full origin-[100%_15%] scale-[1.4] object-cover md:scale-100"
              style={{ objectPosition: '60% 35%' }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-background/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background to-transparent" />
          </div>

          <div className="relative">
            {isMobile && (
              <div className="mb-5 flex items-center justify-between gap-3">
                <BrandMark />
                <AccountButton />
              </div>
            )}
            <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-foreground md:text-[40px] lg:text-[46px]">
              {tl('heroLine1')}
              <span className="relative block w-fit text-primary">
                {tl('heroLine2')}
                <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"
                  className="absolute -bottom-1.5 start-0 h-2.5 w-[105%] text-primary md:-bottom-2 md:h-3 rtl:-scale-x-100">
                  <path d="M2 9C50 3 120 1 198 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-4 max-w-[17rem] text-sm leading-relaxed text-foreground/80 md:mt-5 md:max-w-sm md:text-base">
              {tl('heroLead')}
            </p>
          </div>
        </section>

        <h2 className="px-4 pb-2.5 text-sm font-semibold text-muted-foreground md:px-6 lg:px-8">
          {t('question')}
        </h2>

        {/* Tool cards: one column of wide cards on phones and tablets; on
            desktop the first two lead and the other three sit beneath. */}
        <ul className="grid grid-cols-1 gap-3 px-4 md:gap-4 md:px-6 lg:grid-cols-6 lg:px-8">
          {HOME_ORDER.map((id, i) => (
            <li key={id} className={i < 2 ? 'lg:col-span-3' : 'lg:col-span-2'}>
              <ToolCard id={id} lead={i < 2} eager={i < 2} />
            </li>
          ))}
        </ul>

        <p className="mt-6 px-4 text-center text-xs text-muted-foreground md:px-6">
          {t('privacy')}
        </p>
        <AccountLine />
      </div>
    </div>
  );
}

function ToolCard({ id, lead, eager }: { id: keyof typeof TOOLS; lead: boolean; eager: boolean }) {
  const t = useTranslations('studio');
  const tt = useTranslations(`tools.${id}`);
  const art = TOOL_ART[id];
  const Icon = TOOLS[id].icon;
  const title = tt('title');
  const description = tt('description');
  return (
    // Named by its own text (title, description, what it includes), so what a
    // screen reader says is what is on the card.
    <Link
      href={pathForView(id)}
      className="group flex h-full items-stretch gap-3 rounded-2xl border border-border bg-card p-2 pe-2.5 shadow-sm transition-colors hover:border-primary/50 active:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:gap-5 md:p-2.5 md:pe-4 lg:flex-col lg:gap-0 lg:p-0"
    >
      <div className={`relative aspect-[4/3] w-[38%] max-w-[260px] shrink-0 self-center overflow-hidden rounded-xl bg-secondary ${lead ? 'lg:aspect-[21/9]' : 'lg:aspect-[16/9]'} lg:w-full lg:max-w-none lg:rounded-b-none lg:rounded-t-2xl`}>
        <img
          src={art.src}
          alt=""
          width={art.width}
          height={art.height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: art.position }}
        />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:items-start lg:p-4">
        <div className="min-w-0 flex-1 py-1">
          <div className="flex items-center gap-2">
            <Icon className="h-[18px] w-[18px] shrink-0 text-primary md:h-6 md:w-6" aria-hidden="true" />
            <h3 className="text-[15px] font-semibold leading-tight text-foreground md:text-xl">{title}</h3>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground md:mt-1.5 md:text-[15px]">{description}</p>
          <ul className="mt-2.5 hidden flex-wrap gap-1.5 sm:flex" aria-label={t('includes')}>
            {[tt('chip1'), tt('chip2'), tt('chip3')].map((chip) => (
              <li key={chip} className="rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs text-foreground/80">
                {chip}
              </li>
            ))}
          </ul>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5 lg:hidden" aria-hidden="true" />
      </div>
    </Link>
  );
}
