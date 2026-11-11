import { execSync } from 'node:child_process';
import type { NextConfig } from 'next';

// The exact commit and time of this build, so the running version can be
// checked from outside (GET /api/health) without logging in to the server.
// Release builds run in a git checkout of that commit (deploy/release.sh).
const commit = (() => {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
})();

const nextConfig: NextConfig = {
  // A self-contained server bundle (.next/standalone) for the VPS.
  output: 'standalone',
  env: { BUILD_COMMIT: commit, BUILD_TIME: new Date().toISOString() },
  // The Vite app never ran under StrictMode; keep effects running once so the
  // tools behave exactly as before the migration.
  reactStrictMode: false,
  poweredByHeader: false,
  // Baseline browser protections for every response. The first three match
  // what CloudPanel's nginx adds for every site (/etc/nginx/global_settings),
  // so the duplicates agree; HSTS is honoured by browsers over HTTPS only.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ],
      },
    ];
  },
};

export default nextConfig;
