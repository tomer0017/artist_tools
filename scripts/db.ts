// Database operations for operators, run on a trusted machine that has the
// environment configured (.env.local locally; the server's env file there):
//
//   npm run db -- migrate                create indexes and seed plans (idempotent)
//   npm run db -- find-user <email>      show a user's id (they must have signed in once)
//   npm run db -- grant-admin <userId>   give a user the admin role (audited)
//   npm run db -- revoke-admin <userId>  take the admin role away (audited)
//
// Admin access is granted only here, by user id, by someone with server access —
// never from configuration or an email address.
//
// Runs with the react-server condition so `server-only` modules can be imported.
import { existsSync } from 'node:fs';
import { setUserRole, findUserByEmail } from '@/server/admin';
import { closeMongo, getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const USAGE = 'Usage: npm run db -- migrate | find-user <email> | grant-admin <userId> | revoke-admin <userId>';

async function main(command: string | undefined, arg: string | undefined): Promise<void> {
  switch (command) {
    case 'migrate': {
      const report = await migrate(getDb());
      console.log(`Migration done: ${report.indexes} indexes ensured, ${report.plansInserted} plans inserted.`);
      return;
    }
    case 'find-user': {
      if (!arg) throw new Error(USAGE);
      const user = await findUserByEmail(getDb(), arg);
      if (!user) throw new Error('No user with that email. They need to sign in once first.');
      console.log(`id: ${user._id.toHexString()}  name: ${user.name}  role: ${user.role ?? 'user'}  status: ${user.status ?? 'active'}`);
      return;
    }
    case 'grant-admin':
    case 'revoke-admin': {
      const userId = toObjectId(arg);
      if (!userId) throw new Error(`${USAGE}\n(userId must be the 24-character id shown by find-user)`);
      const role = command === 'grant-admin' ? 'admin' : 'user';
      if (!(await setUserRole(getDb(), userId, role, 'cli'))) throw new Error('No user with that id.');
      console.log(`${userId.toHexString()} is now: ${role}`);
      return;
    }
    default:
      throw new Error(USAGE);
  }
}

main(process.argv[2], process.argv[3])
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
