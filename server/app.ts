import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { generateObligations } from '../src/domain/engine';
import { buildIcs } from '../src/export/ics';
import { parseState } from '../src/state/store';
import {
  PASSWORD_MIN_LENGTH,
  hashPassword,
  isAcceptablePassword,
  newFeedToken,
  normaliseEmail,
  signToken,
  verifyPassword,
  verifyToken,
} from './auth';
import type { Store, UserRecord } from './store';

export interface AppConfig {
  jwtSecret: string;
  /** Browser origins allowed to call the API. An empty list allows any origin (local development). */
  allowedOrigins: string[];
  /** Sign-in and sign-up attempts allowed per IP address per window. */
  authAttemptsPerWindow?: number;
}

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const BODY_LIMIT = '256kb';

/** An error whose message is safe to show to the client. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fixed-window attempt counter per IP: enough to blunt password guessing on a single instance. */
function rateLimiter(maxAttempts: number) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
      return next();
    }
    entry.count += 1;
    if (entry.count > maxAttempts) return next(new HttpError(429, 'Too many attempts. Try again in a few minutes.'));
    next();
  };
}

function cors(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

/**
 * Builds the HTTP API. Takes its store and config as arguments so tests can run
 * it against an in-memory store without touching the network or environment.
 */
export function createApp(store: Store, config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the host's load balancer, so req.ip is the real client
  app.use(cors(config.allowedOrigins));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: BODY_LIMIT }));

  const limitAuth = rateLimiter(config.authAttemptsPerWindow ?? 20);

  const session = (user: UserRecord) => ({ token: signToken(user.id, config.jwtSecret), email: user.email });

  /** Resolves the signed-in user from the Authorization header, or rejects with 401. */
  async function requireUser(req: Request): Promise<UserRecord> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const userId = token ? verifyToken(token, config.jwtSecret) : null;
    const user = userId ? await store.findById(userId) : null;
    if (!user) throw new HttpError(401, 'Sign in again to continue.');
    return user;
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/register', limitAuth, async (req, res) => {
    const email = normaliseEmail(req.body?.email);
    const password: unknown = req.body?.password;
    if (!email) throw new HttpError(400, 'Enter a valid email address.');
    if (!isAcceptablePassword(password)) throw new HttpError(400, `Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.`);

    const user = await store.createUser({
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(password),
      feedToken: newFeedToken(),
    });
    if (!user) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    res.status(201).json(session(user));
  });

  app.post('/api/auth/login', limitAuth, async (req, res) => {
    const email = normaliseEmail(req.body?.email);
    const password: unknown = req.body?.password;
    const user = email ? await store.findByEmail(email) : null;
    const valid = user !== null && typeof password === 'string' && (await verifyPassword(password, user.passwordHash));
    // One message for both failures, so the API does not reveal which emails are registered.
    if (!user || !valid) throw new HttpError(401, 'Email or password is incorrect.');
    res.json(session(user));
  });

  app.get('/api/state', async (req, res) => {
    const user = await requireUser(req);
    res.json({ state: user.state, revision: user.revision, feedToken: user.feedToken });
  });

  app.put('/api/state', async (req, res) => {
    const user = await requireUser(req);
    const baseRevision: unknown = req.body?.baseRevision;
    if (!Number.isInteger(baseRevision)) throw new HttpError(400, 'baseRevision must be an integer.');

    let state;
    try {
      // The same validator the browser uses for backups: the server never stores a shape it cannot read back.
      state = parseState(req.body?.state);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid state.');
    }

    const revision = await store.saveState(user.id, state, baseRevision as number);
    if (revision === null) {
      // Another device saved first. Hand back what it saved so the client can catch up.
      const current = await store.findById(user.id);
      return res.status(409).json({ error: 'A newer version was saved from another device.', state: current?.state ?? null, revision: current?.revision ?? 0 });
    }
    res.json({ revision });
  });

  app.delete('/api/account', async (req, res) => {
    const user = await requireUser(req);
    await store.deleteUser(user.id);
    res.sendStatus(204);
  });

  /**
   * A live calendar feed. Calendar apps poll this URL, so deadlines stay current
   * after filings are recorded, unlike a one-off .ics download. The token in the
   * URL is the credential, because calendar apps cannot send headers.
   */
  app.get('/api/feed/:file', async (req, res) => {
    const file = req.params.file ?? '';
    const user = file.endsWith('.ics') ? await store.findByFeedToken(file.slice(0, -4)) : null;
    if (!user) throw new HttpError(404, 'Calendar feed not found.');

    const profile = user.state?.profile ?? null;
    const completions = user.state?.completions ?? {};
    const open = profile ? generateObligations(profile).filter((obligation) => !completions[obligation.id]) : [];
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(buildIcs(open, profile?.name ?? 'Niyam'));
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));

  // Express recognises an error handler by its four parameters, so `_next` must stay.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    // Errors raised by Express itself (malformed JSON, body too large) carry a 4xx status.
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'The request could not be read.' });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
