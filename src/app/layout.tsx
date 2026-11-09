import type { Metadata, Viewport } from 'next';
import '@/index.css';

const description = "A painter's toolkit for measuring, value studies, color mixing, and grid drawing.";

export const metadata: Metadata = {
  title: 'Studio Companion',
  description,
  authors: [{ name: 'Studio Companion' }],
  openGraph: { title: 'Studio Companion', description, type: 'website' },
  twitter: { card: 'summary', title: 'Studio Companion', description },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
