// Database operations for operators, run on a trusted machine that has the
// environment configured (.env.local locally; the server's env file there):
//
//   npm run db -- migrate                     create indexes, sync plans, backfill (idempotent)
//   npm run db -- list-users                  every account, emails masked, with its Google link
//   npm run db -- find-user <email>           show a user's id (they must have signed in once)
//   npm run db -- grant-admin <userId>        give a verified Google account the admin role (audited)
//   npm run db -- revoke-admin <userId>       take the admin role away; never from the last admin (audited)
//   npm run db -- set-plan <userId> free|pro  assign a plan without billing, for testing (audited)
//
// Admin access is granted only here or by another admin, always by user id —
// never from configuration or an email address.
//
// Runs with the react-server condition so `server-only` modules can be imported.
import { existsSync } from 'node:fs';
import { isPlanId } from '@/lib/plans';
import { findUserByEmail, getUserDetail, listUsers, setUserPlan, setUserRole } from '@/server/admin';
import { closeMongo, getDb } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { authConfig } from '@/server/env';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const USAGE =
  'Usage: npm run db -- migrate | list-users | find-user <email> | grant-admin <userId> | revoke-admin <userId> | set-plan <userId> free|pro';

/** Emails are personal data: operators see enough to recognise an account, not the address. */
const mask = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};
const when = (date: Date | null) => (date ? date.toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '—');

function invitation(email: string): string {
  try {
    const { signups } = authConfig();
    if (signups === '*') return 'open sign-up';
    return signups.includes(email.trim().toLowerCase()) ? 'on the invite list' : 'not on the invite list';
  } catch {
    return 'invite list unknown';
  }
}

function userIdFrom(arg: string | undefined) {
  const userId = toObjectId(arg);
  if (!userId) throw new Error(`${USAGE}\n(userId must be the 24-character id shown by list-users or find-user)`);
  return userId;
}

async function main(command: string | undefined, arg: string | undefined, arg2: string | undefined): Promise<void> {
  const db = getDb();
  switch (command) {
    case 'migrate': {
      const r = await migrate(db);
      console.log(`Migration done: ${r.indexes} indexes ensured, ${r.plansInserted} plans inserted, ${r.plansUpdated} plans updated, ${r.usersBackfilled} accounts set to Free.`);
      return;
    }
    case 'list-users': {
      const { rows, total } = await listUsers(db, { pageSize: 200 });
      console.log(`${total} account(s)`);
      for (const u of rows) {
        console.log(
          [
            u.id,
            mask(u.email),
            `verified:${u.emailVerified ? 'yes' : 'no'}`,
            `google:${u.google.linked ? u.google.idHint : 'none'}`,
            `role:${u.role}`,
            `plan:${u.plan}`,
            `status:${u.status}`,
            `created:${when(u.createdAt)}`,
            `last-login:${when(u.lastLoginAt)}`,
            `logins:${u.logins}`,
            invitation(u.email),
          ].join('  '),
        );
      }
      return;
    }
    case 'find-user': {
      if (!arg) throw new Error(USAGE);
      const user = await findUserByEmail(db, arg);
      if (!user) throw new Error('No user with that email. They need to sign in once first.');
      console.log(`id: ${user._id.toHexString()}  name: ${user.name}  role: ${user.role ?? 'user'}  status: ${user.status ?? 'active'}`);
      return;
    }
    case 'grant-admin': {
      const userId = userIdFrom(arg);
      const detail = await getUserDetail(db, userId);
      if (!detail) throw new Error('No user with that id.');
      const googleAccounts = await collections(db).accounts.countDocuments({ userId, providerId: 'google' });
      console.log(
        `Account ${detail.id}: ${mask(detail.email)}, email verified: ${detail.emailVerified ? 'yes' : 'no'}, ` +
          `Google identity: ${googleAccounts === 1 ? detail.google.idHint : `${googleAccounts} found`}, status: ${detail.status}, ` +
          `created ${when(detail.createdAt)}, last login ${when(detail.lastLoginAt)}, ${detail.logins} login(s), ${invitation(detail.email)}`,
      );
      // Only a real, verified Google sign-in can become an admin.
      if (detail.status !== 'active') throw new Error('Refused: the account is not active.');
      if (!detail.emailVerified) throw new Error('Refused: Google has not verified this email address.');
      if (googleAccounts !== 1) throw new Error('Refused: the account must be linked to exactly one Google identity.');
      const result = await setUserRole(db, { userId, role: 'admin', actor: 'cli' });
      console.log(result === 'unchanged' ? 'Already an admin; nothing changed.' : 'Granted: the account is now an admin (recorded in the audit log).');
      return;
    }
    case 'revoke-admin': {
      const userId = userIdFrom(arg);
      const result = await setUserRole(db, { userId, role: 'user', actor: 'cli' });
      if (result === 'not_found') throw new Error('No user with that id.');
      if (result === 'last_admin') throw new Error('Refused: this is the last admin. Grant admin to another account first.');
      console.log(result === 'unchanged' ? 'Not an admin; nothing changed.' : 'Revoked: the account is now a regular user (recorded in the audit log).');
      return;
    }
    case 'set-plan': {
      const userId = userIdFrom(arg);
      if (!isPlanId(arg2)) throw new Error(USAGE);
      const result = await setUserPlan(db, { userId, plan: arg2, actor: 'cli' });
      if (result.status === 'not_found') throw new Error('No user with that id.');
      console.log(result.status === 'unchanged' ? `Already on ${arg2}; nothing changed.` : `Plan changed: ${result.from} → ${result.to} (recorded in the audit log).`);
      return;
    }
    default:
      throw new Error(USAGE);
  }
}

main(process.argv[2], process.argv[3], process.argv[4])
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
