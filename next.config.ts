import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A self-contained server bundle (.next/standalone) for the VPS.
  output: 'standalone',
  // The Vite app never ran under StrictMode; keep effects running once so the
  // tools behave exactly as before the migration.
  reactStrictMode: false,
  poweredByHeader: false,
  // Baseline browser protections for every response. HSTS is added by nginx,
  // which terminates HTTPS.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
