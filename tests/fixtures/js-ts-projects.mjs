/**
 * Scratch JS/TS projects with a written ground truth, for
 * specs/045-js-ts-extraction (docguard.js-ts-extraction).
 *
 * Each writer builds a small but realistic project in a directory the caller
 * owns (a fresh temp dir), and each TRUTH object states, by hand, what a
 * correct scan of that project reports. Nothing here reads repository state.
 * @req docguard.js-ts-extraction#SC-001
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** A line that no parser recovers from: forces the per-file regex fallback. */
export const UNPARSEABLE = '\n<<<<<<< merge conflict left in the file\n';

// ── Express + Mongoose (TypeScript, `@/` path alias) ────────────────────────

export const EXPRESS_FILES = {
  'package.json': JSON.stringify({
    name: 'orders-api',
    dependencies: { express: '4.19.2', mongoose: '8.4.0', jsonwebtoken: '9.0.2' },
    devDependencies: { typescript: '5.4.5' },
  }, null, 2),
  // JSONC with comments and a trailing comma, extending a base config.
  'tsconfig.json': `{
  // the paths live in the base config
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "strict": true, },
}
`,
  'tsconfig.base.json': `{
  "compilerOptions": {
    "baseUrl": ".",
    /* the app imports its own modules through @/ */
    "paths": { "@/*": ["src/*"] }
  }
}
`,
  'src/app.ts': `import express from 'express';
import { apiRouter } from '@/routes';
import { config } from '@/config';

const app = express();
app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', apiRouter);
app.listen(config.port);
export default app;
`,
  'src/config.ts': `const { MONGO_URI, JWT_SECRET, LOG_LEVEL = 'info', PORT: port = '3000' } = process.env;

export const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
export const config = { mongoUri: MONGO_URI, jwtSecret: JWT_SECRET, logLevel: LOG_LEVEL, port: Number(port) };
`,
  'src/middleware/auth.ts': `import jwt from 'jsonwebtoken';
import { config } from '@/config';

export function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  req.user = jwt.verify(token, config.jwtSecret);
  next();
}
`,
  'src/routes/index.ts': `import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import ordersRouter from './orders';
import usersRouter from './users';

export const apiRouter = Router();
apiRouter.use('/orders', requireAuth, ordersRouter);
apiRouter.use('/users', usersRouter);
`,
  'src/routes/orders.ts': `import { Router } from 'express';
import Order from '../../lib/models/Order';

const router = Router();

// List and create orders
router.route('/')
  .get(async (req, res) => res.json(await Order.find()))
  .post(async (req, res) => res.status(201).json(await Order.create(req.body)));

router.route('/:id').get(getOrder).delete(deleteOrder);

async function getOrder(req, res) { res.json(await Order.findById(req.params.id)); }
async function deleteOrder(req, res) { await Order.deleteOne({ _id: req.params.id }); res.sendStatus(204); }

export default router;
`,
  'src/routes/users.ts': `import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.post('/login', login);
router.post('/register', register);
router.get('/me', requireAuth, (req, res) => res.json(req.user));

function login(req, res) { res.json({ token: 'x' }); }
function register(req, res) { res.status(201).end(); }

export default router;
`,
  'lib/models/User.ts': `import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema({
  email: { type: String, required: true, unique: true },
  name: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  profile: {
    bio: String,
    avatarUrl: { type: String },
  },
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model('User', UserSchema);
`,
  'lib/models/Order.ts': `import mongoose, { Schema } from 'mongoose';

const orderSchema = new mongoose.Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  total: { type: Number, required: true },
  status: { type: String, default: 'pending' },
}, { timestamps: true });

export default mongoose.model('Order', orderSchema);
`,
  'lib/models/Product.ts': `import { Schema, model } from 'mongoose';

const productSchema = new Schema({
  title: { type: String, required: true },
  price: Number,
  tags: [String],
});

export const Product = model('Product', productSchema);
`,
};

export const EXPRESS_TRUTH = {
  routes: {
    'GET /health': false,
    'GET /api/orders': true,
    'POST /api/orders': true,
    'GET /api/orders/:id': true,
    'DELETE /api/orders/:id': true,
    'POST /api/users/login': false,
    'POST /api/users/register': false,
    'GET /api/users/me': true,
  },
  entities: {
    User: ['createdAt', 'email', 'name', 'profile', 'role'],
    Order: ['items', 'status', 'total', 'user'],
    Product: ['price', 'tags', 'title'],
  },
  relationships: ['Order->Product:items', 'Order->User:user'],
  // name -> has a default in code
  env: { JWT_SECRET: false, LOG_LEVEL: true, MONGO_URI: false, PORT: true, REDIS_URL: true },
  stack: ['Express', 'Mongoose', 'TypeScript'],
  edges: [
    'src/app.ts->src/config.ts',
    'src/app.ts->src/routes/index.ts',
    'src/middleware/auth.ts->src/config.ts',
    'src/routes/index.ts->src/middleware/auth.ts',
    'src/routes/index.ts->src/routes/orders.ts',
    'src/routes/index.ts->src/routes/users.ts',
    'src/routes/orders.ts->lib/models/Order.ts',
    'src/routes/users.ts->src/middleware/auth.ts',
  ],
};

// ── Next.js (App Router + Pages) + Drizzle in lib/db ────────────────────────

export const NEXT_FILES = {
  'package.json': JSON.stringify({
    name: 'tasks-web',
    dependencies: {
      next: '14.2.3', react: '18.3.1', 'react-dom': '18.3.1',
      'drizzle-orm': '0.30.10', postgres: '3.4.4', 'next-auth': '4.24.7',
    },
    devDependencies: { 'drizzle-kit': '0.21.2', typescript: '5.4.5' },
  }, null, 2),
  'tsconfig.json': `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] },
    "jsx": "preserve"
  }
}
`,
  'drizzle.config.ts': `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`,
  'lib/db/schema.ts': `import { pgTable, pgEnum, serial, integer, varchar, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  ownerId: integer('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  priority: priorityEnum('priority').default('medium').notNull(),
  done: boolean('done').default(false),
});
`,
  'lib/db/index.ts': `import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
`,
  'lib/auth.ts': `export const authOptions = { secret: process.env.NEXTAUTH_SECRET, providers: [] };
`,
  'middleware.ts': `export { default } from 'next-auth/middleware';

export const config = { matcher: ['/api/admin/:path*', '/dashboard/:path*'] };
`,
  'app/layout.tsx': `import Header from '@/components/Header';

export default function RootLayout({ children }) {
  return <html><body><Header />{children}</body></html>;
}
`,
  'app/api/health/route.ts': `export async function GET() {
  return Response.json({ ok: true });
}
`,
  'app/api/projects/route.ts': `import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { authOptions } from '@/lib/auth';

export async function GET() {
  return Response.json(await db.select().from(projects));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response(null, { status: 401 });
  return Response.json(await req.json(), { status: 201 });
}
`,
  'app/api/projects/[id]/route.ts': `import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth';

export async function GET(req: Request, { params }) {
  return Response.json({ id: params.id, db: Boolean(db) });
}

export const DELETE = async (req: Request) => {
  const session = await getServerSession(authOptions);
  if (!session) return new Response(null, { status: 401 });
  return new Response(null, { status: 204 });
};
`,
  'app/api/admin/stats/route.ts': `export async function GET() {
  return Response.json({ users: 0 });
}
`,
  'pages/index.tsx': `import Header from '@/components/Header';

const analyticsId = process.env.NEXT_PUBLIC_ANALYTICS_ID;

export default function Home() {
  return <main data-analytics={analyticsId}><Header /></main>;
}
`,
  'components/Header.tsx': `const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'Tasks';

export default function Header() {
  return <header>{appName}</header>;
}
`,
};

export const NEXT_TRUTH = {
  routes: {
    'GET /api/health': false,
    'GET /api/projects': false,
    'POST /api/projects': true,
    'GET /api/projects/:id': false,
    'DELETE /api/projects/:id': true,
    'GET /api/admin/stats': true,
  },
  entities: {
    users: ['createdAt', 'email', 'id', 'name'],
    projects: ['id', 'ownerId', 'title'],
    tasks: ['done', 'id', 'priority', 'projectId'],
  },
  relationships: ['projects->users:ownerId', 'tasks->projects:projectId'],
  env: { DATABASE_URL: false, NEXTAUTH_SECRET: false, NEXT_PUBLIC_ANALYTICS_ID: false, NEXT_PUBLIC_APP_NAME: true },
  stack: ['Drizzle', 'Next.js', 'NextAuth.js', 'React', 'TypeScript'],
  edges: [
    'app/api/projects/[id]/route.ts->lib/auth.ts',
    'app/api/projects/[id]/route.ts->lib/db/index.ts',
    'app/api/projects/route.ts->lib/auth.ts',
    'app/api/projects/route.ts->lib/db/index.ts',
    'app/api/projects/route.ts->lib/db/schema.ts',
    'app/layout.tsx->components/Header.tsx',
    'lib/db/index.ts->lib/db/schema.ts',
    'pages/index.tsx->components/Header.tsx',
  ],
};

// ── Prisma: enums, one-to-one, one-to-many, implicit many-to-many ───────────

export const PRISMA_FILES = {
  'package.json': JSON.stringify({
    name: 'blog-api',
    dependencies: { express: '4.19.2', '@prisma/client': '5.14.0' },
    devDependencies: { prisma: '5.14.0' },
  }, null, 2),
  'prisma/schema.prisma': `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  USER
  ADMIN
}

enum Status {
  DRAFT
  PUBLISHED
}

model User {
  id      Int      @id @default(autoincrement())
  email   String   @unique
  role    Role     @default(USER)
  posts   Post[]
  profile Profile?
}

model Profile {
  id     Int     @id @default(autoincrement())
  bio    String?
  user   User    @relation(fields: [userId], references: [id])
  userId Int     @unique
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  status   Status @default(DRAFT)
  meta     Json   @default("{}")
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
  tags     Tag[]

  @@index([authorId])
}

model Tag {
  id    Int    @id @default(autoincrement())
  name  String @unique
  posts Post[]
}
`,
};

export const PRISMA_TRUTH = {
  entities: {
    User: ['email', 'id', 'role'],
    Profile: ['bio', 'id', 'userId'],
    Post: ['authorId', 'id', 'meta', 'status', 'title'],
    Tag: ['id', 'name'],
  },
  enums: { Role: ['ADMIN', 'USER'], Status: ['DRAFT', 'PUBLISHED'] },
  relationships: ['Post->Tag:tags', 'Post->User:author', 'Profile->User:user'],
  stack: ['Express', 'Prisma'],
};
