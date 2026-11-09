import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A self-contained server bundle (.next/standalone) for the VPS.
  output: 'standalone',
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
