import pg from 'pg';
import type { AppState } from '../src/domain/types';
import type { NewUser, Store, UserRecord } from './store';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    feed_token    TEXT NOT NULL UNIQUE,
    state         JSONB,
    revision      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  feed_token: string;
  state: AppState | null;
  revision: number;
}

function toRecord(row: UserRow | undefined): UserRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    feedToken: row.feed_token,
    state: row.state,
    revision: row.revision,
  };
}

/** Production store. Every query is parameterised; no SQL is built from user input. */
export class PostgresStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string, useSsl: boolean) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async createUser(user: NewUser): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (id, email, password_hash, feed_token)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [user.id, user.email, user.passwordHash, user.feedToken],
    );
    return toRecord(result.rows[0]);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    return toRecord(result.rows[0]);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return toRecord(result.rows[0]);
  }

  async findByFeedToken(feedToken: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE feed_token = $1', [feedToken]);
    return toRecord(result.rows[0]);
  }

  async saveState(userId: string, state: AppState, baseRevision: number): Promise<number | null> {
    // The revision check and the write happen in one statement, so two devices
    // saving at the same moment cannot both succeed.
    const result = await this.pool.query<{ revision: number }>(
      `UPDATE users SET state = $2::jsonb, revision = revision + 1
       WHERE id = $1 AND revision = $3
       RETURNING revision`,
      [userId, JSON.stringify(state), baseRevision],
    );
    return result.rows[0]?.revision ?? null;
  }

  async deleteUser(id: string): Promise<void> {
    await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
  }
}
