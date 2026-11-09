import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A self-contained server bundle (.next/standalone) for the VPS.
  output: 'standalone',
  // The Vite app never ran under StrictMode; keep effects running once so the
  // tools behave exactly as before the migration.
  reactStrictMode: false,
  poweredByHeader: false,
};

export default nextConfig;
