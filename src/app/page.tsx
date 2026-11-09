import Link from 'next/link';
import { BrandMark } from '@/components/shell/BrandMark';
import LegacyHashRedirect from '@/components/shell/LegacyHashRedirect';

// Public landing page. A placeholder until the marketing page is designed: it
// reuses the studio's hero so the brand looks the same before and after entry.

const HERO_FADE = 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.55) 30%, #000 62%, #000 88%, transparent 100%)';

export default function LandingPage() {
  return (
    <main className="min-h-[100dvh] bg-background">
      <LegacyHashRedirect />
      <section className="relative mx-auto w-full max-w-6xl overflow-hidden px-4 pb-10 pt-6 md:px-6 md:pb-16 md:pt-10 lg:px-8">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-[64%] md:w-[55%]"
          style={{ maskImage: HERO_FADE, WebkitMaskImage: HERO_FADE }}
        >
          <img
            src="/images/home/home-hero.webp"
            alt=""
            width={1199}
            height={1312}
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover"
            style={{ objectPosition: '60% 35%' }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-background/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background to-transparent" />
        </div>

        <div className="relative">
          <div className="mb-8"><BrandMark /></div>
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
          <Link
            href="/app"
            className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open the studio
          </Link>
        </div>
      </section>
    </main>
  );
}
