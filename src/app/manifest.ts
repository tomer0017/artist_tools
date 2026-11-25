import type { MetadataRoute } from 'next';

// The web app manifest (/manifest.webmanifest): SketchyArtLab's name and icons
// for "Add to Home Screen" and installs. `minimal-ui` keeps a back button and
// the address where a browser supports it (and opens in the browser itself on
// iOS), so Google sign-in and PayPal behave exactly as on the website.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SketchyArtLab',
    short_name: 'SketchyArtLab',
    description: "A painter's toolkit for measuring, value studies, color mixing, and grid drawing.",
    start_url: '/app',
    scope: '/',
    display: 'minimal-ui',
    background_color: '#18181b',
    theme_color: '#18181b',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
