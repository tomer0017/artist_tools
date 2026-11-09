// Database operations for operators, run on a trusted machine that has the
// environment configured (.env.local locally; the server's env file there):
//
//   npm run db -- migrate              create indexes and seed plans (idempotent)
//
// Runs with the react-server condition so `server-only` modules can be imported.
import { existsSync } from 'node:fs';
import { closeMongo, getDb } from '@/server/db/client';
import { migrate } from '@/server/db/migrate';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

async function main(command: string | undefined): Promise<void> {
  switch (command) {
    case 'migrate': {
      const report = await migrate(getDb());
      console.log(`Migration done: ${report.indexes} indexes ensured, ${report.plansInserted} plans inserted.`);
      return;
    }
    default:
      console.error('Usage: npm run db -- migrate');
      process.exitCode = 1;
  }
}

main(process.argv[2])
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
