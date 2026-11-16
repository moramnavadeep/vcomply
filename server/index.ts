import { createApp } from './app';
import { PostgresStore } from './postgresStore';
import { MemoryStore, type Store } from './store';

const DEV_SECRET = 'dev-only-secret-do-not-use-in-production';

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  const { DATABASE_URL, JWT_SECRET, ALLOWED_ORIGINS, DATABASE_SSL } = process.env;
  const port = Number(process.env.PORT ?? 8787);

  // Fail at startup rather than run insecurely: production must have a real secret and a real database.
  if (isProduction && (!JWT_SECRET || !DATABASE_URL)) {
    throw new Error('JWT_SECRET and DATABASE_URL must be set in production.');
  }

  let store: Store;
  if (DATABASE_URL) {
    store = new PostgresStore(DATABASE_URL, DATABASE_SSL === 'true');
  } else {
    console.warn('DATABASE_URL is not set: using the in-memory store. Data is lost when the server stops.');
    store = new MemoryStore();
  }
  await store.init();

  const app = createApp(store, {
    jwtSecret: JWT_SECRET ?? DEV_SECRET,
    allowedOrigins: (ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  });

  app.listen(port, () => console.log(`Niyam API listening on port ${port}`));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
