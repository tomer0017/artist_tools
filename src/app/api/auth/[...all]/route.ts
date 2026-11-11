import { getAuth } from '@/server/auth';
import { BodyTooLarge, readBodyText } from '@/server/request';

// Better Auth's endpoints: /api/auth/sign-in/social, /api/auth/callback/google,
// /api/auth/sign-out, /api/auth/get-session, … Their bodies are small JSON
// (credentials, a token, a provider name): anything over 32 KB is refused
// before the library reads it.

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;

export function GET(request: Request) {
  return getAuth().handler(request);
}

export async function POST(request: Request) {
  let body: string;
  try {
    body = await readBodyText(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge) return Response.json({ code: 'BODY_TOO_LARGE', message: 'Request too large' }, { status: 413 });
    throw error;
  }
  return getAuth().handler(new Request(request, { body, duplex: 'half' } as RequestInit));
}
