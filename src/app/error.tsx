'use client';

// Shown when a page fails on the server (for example, the database cannot be
// reached to verify a session). Access is never granted on failure.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">The studio could not be loaded just now. Please try again in a moment.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
