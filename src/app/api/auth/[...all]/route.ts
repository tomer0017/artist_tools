import { getAuth } from '@/server/auth';

// Better Auth's endpoints: /api/auth/sign-in/social, /api/auth/callback/google,
// /api/auth/sign-out, /api/auth/get-session, …

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return getAuth().handler(request);
}

export function POST(request: Request) {
  return getAuth().handler(request);
}
