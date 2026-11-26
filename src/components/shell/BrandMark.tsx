// The SketchyArtLab logo: the fox beside the wordmark, both cut from the
// owner's official artwork (assets/brand, scripts/brand/logo.mjs), which is
// drawn for dark backgrounds like the studio's. Has no state, so it renders the
// same on the server (landing page) and inside the studio; fixed sizes keep the
// layout from shifting while the images load. The lockup reads left to right in
// Hebrew too, as a Latin wordmark does. `compact` is the studio's top bar, where
// the tools need the room: the fox alone until wide screens. Below 380 px it
// is a little smaller, so the phone's Home row keeps room for its buttons.
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span role="img" aria-label="SketchyArtLab" dir="ltr" className="flex items-center gap-2" data-brand-mark="">
      {/* eslint-disable-next-line @next/next/no-img-element -- a tiny static logo, no optimisation needed */}
      <img
        src="/brand/mark.webp"
        alt=""
        width={113}
        height={144}
        decoding="async"
        className={compact ? 'h-8 w-auto shrink-0' : 'h-8 w-auto shrink-0 min-[380px]:h-9 sm:h-10'}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
      <img
        src="/brand/wordmark.webp"
        alt=""
        width={544}
        height={108}
        decoding="async"
        className={compact ? 'hidden h-6 w-auto lg:block' : 'h-[22px] w-auto min-[380px]:h-[26px] sm:h-[30px]'}
      />
    </span>
  );
}
