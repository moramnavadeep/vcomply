import type { AppState } from '../src/domain/types';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  feedToken: string;
  state: AppState | null;
  /** Incremented on every save; lets a client detect that another device saved first. */
  revision: number;
}

export type NewUser = Pick<UserRecord, 'id' | 'email' | 'passwordHash' | 'feedToken'>;

/**
 * Everything the API needs from a database. The API only talks to this
 * interface, so tests run against memory and production against Postgres.
 */
export interface Store {
  init(): Promise<void>;
  /** Returns null when the email is already registered. */
  createUser(user: NewUser): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  findByFeedToken(feedToken: string): Promise<UserRecord | null>;
  /** Saves only if `baseRevision` is still current. Returns the new revision, or null on conflict. */
  saveState(userId: string, state: AppState, baseRevision: number): Promise<number | null>;
  deleteUser(id: string): Promise<void>;
}

/** Keeps everything in a Map. For tests and local development; data is lost on restart. */
export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();

  async init(): Promise<void> {}

  async createUser(user: NewUser): Promise<UserRecord | null> {
    if (await this.findByEmail(user.email)) return null;
    const record: UserRecord = { ...user, state: null, revision: 0 };
    this.users.set(record.id, record);
    return record;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async findByFeedToken(feedToken: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((user) => user.feedToken === feedToken) ?? null;
  }

  async saveState(userId: string, state: AppState, baseRevision: number): Promise<number | null> {
    const user = this.users.get(userId);
    if (!user || user.revision !== baseRevision) return null;
    user.state = state;
    user.revision += 1;
    return user.revision;
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
  }
}
