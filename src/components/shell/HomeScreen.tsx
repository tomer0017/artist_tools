import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { BrandMark } from './AppNav';
import { HeroEyeArt, ToolArt } from './ToolArt';
import { HOME_ORDER, TOOLS, pathForView } from './tools';

// ─── Home / Tool Hub ──────────────────────────────────────────────────────────
// The answer to "what can this app do for me, and where do I start?". Each card
// names a painter's goal, shows the outcome as a picture, and opens the tool in
// one tap. Nothing here needs a tutorial.

const HERO_FADE = 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.55) 30%, #000 62%, #000 88%, transparent 100%)';

export default function HomeScreen() {
  const isMobile = useIsMobile();
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-background">
      <div className="mx-auto w-full max-w-6xl pb-8">
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pb-5 pt-3 md:px-6 md:pb-8 md:pt-8 lg:px-8">
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-[64%] md:w-[55%]"
            style={{ maskImage: HERO_FADE, WebkitMaskImage: HERO_FADE }}
          >
            <HeroEyeArt className="h-full w-full" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background to-transparent" />
          </div>

          <div className="relative">
            {isMobile && <div className="mb-5"><BrandMark /></div>}
            <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-foreground md:text-[40px] lg:text-[46px]">
              Your All-in-One
              <span className="relative block w-fit text-primary">
                Art Studio
                <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"
                  className="absolute -bottom-1.5 left-0 h-2.5 w-[105%] text-primary md:-bottom-2 md:h-3">
                  <path d="M2 9C50 3 120 1 198 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-4 max-w-[17rem] text-sm leading-relaxed text-foreground/80 md:mt-5 md:max-w-sm md:text-base">
              Analyze, measure, plan and compare your artwork — all in one place.
            </p>
          </div>
        </section>

        <h2 className="px-4 pb-2.5 text-sm font-semibold text-muted-foreground md:px-6 lg:px-8">
          What do you want to work on?
        </h2>

        {/* Tool cards: one column of wide cards on phones and tablets; on
            desktop the first two lead and the other three sit beneath. */}
        <ul className="grid grid-cols-1 gap-3 px-4 md:gap-4 md:px-6 lg:grid-cols-6 lg:px-8">
          {HOME_ORDER.map((id, i) => (
            <li key={id} className={i < 2 ? 'lg:col-span-3' : 'lg:col-span-2'}>
              <ToolCard id={id} lead={i < 2} />
            </li>
          ))}
        </ul>

        <p className="mt-6 px-4 text-center text-xs text-muted-foreground md:px-6">
          Everything runs in your browser — your images never leave this device.
        </p>
      </div>
    </div>
  );
}

function ToolCard({ id, lead }: { id: keyof typeof TOOLS; lead: boolean }) {
  const tool = TOOLS[id];
  const Icon = tool.icon;
  return (
    <Link
      to={pathForView(id)}
      aria-label={`${tool.title}: ${tool.description}`}
      className="group flex h-full items-stretch gap-3 rounded-2xl border border-border bg-card p-2 pr-2.5 shadow-sm transition-colors hover:border-primary/50 active:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:gap-5 md:p-2.5 md:pr-4 lg:flex-col lg:gap-0 lg:p-0"
    >
      <div className={`relative aspect-[4/3] w-[38%] max-w-[260px] shrink-0 self-center overflow-hidden rounded-xl bg-secondary ${lead ? 'lg:aspect-[21/9]' : 'lg:aspect-[16/9]'} lg:w-full lg:max-w-none lg:rounded-b-none lg:rounded-t-2xl`}>
        <ToolArt tool={id} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:items-start lg:p-4">
        <div className="min-w-0 flex-1 py-1">
          <div className="flex items-center gap-2">
            <Icon className="h-[18px] w-[18px] shrink-0 text-primary md:h-6 md:w-6" aria-hidden="true" />
            <h3 className="text-[15px] font-semibold leading-tight text-foreground md:text-xl">{tool.title}</h3>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground md:mt-1.5 md:text-[15px]">{tool.description}</p>
          <ul className="mt-2.5 hidden flex-wrap gap-1.5 sm:flex" aria-label="Includes">
            {tool.chips.map((chip) => (
              <li key={chip} className="rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs text-foreground/80">
                {chip}
              </li>
            ))}
          </ul>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary lg:hidden" aria-hidden="true" />
      </div>
    </Link>
  );
}
