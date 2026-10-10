/**
 * Tech-Stack Detection — which technologies the code shows, and which ones
 * this project's manifests could show at all.
 *
 * One reader for the check (DDF001, `diff`) and the writers (`generate`,
 * `memory`), so the generated tech stack names exactly what the check looks
 * for (docguard.generated-docs-consistency#FR-010). Moved from
 * `shared-source.mjs` so it can read every ecosystem `detectEcosystems` parses
 * without a Shared → Scanners import (docguard.dogfood-round-2#FR-007).
 *
 * @implements docguard.generated-docs-consistency#FR-010
 * @implements docguard.dogfood-round-2#FR-002
 * @implements docguard.dogfood-round-2#FR-003
 * @implements docguard.dogfood-round-2#FR-006
 * @implements docguard.dogfood-round-2#FR-007
 * @implements docguard.coverage-followups#FR-005
 */

import { join, relative, resolve } from 'node:path';
import { shouldIgnore, isNonProductPath, walkFiles } from '../shared-ignore.mjs';
import { CODE_EXTENSIONS, collectPackageJsons, findDockerManifest, readScannable } from '../shared-source.mjs';
import { detectEcosystems } from './project-type.mjs';

/** Technologies the tech-stack drift check (DDF001) and `diff` recognise by name. */
export const TECH_PATTERNS = ['React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Express', 'Fastify', 'Hono',
  'PostgreSQL', 'MySQL', 'MongoDB', 'DynamoDB', 'Redis', 'Prisma', 'Drizzle', 'TypeORM', 'Sequelize',
  'TypeScript', 'Tailwind', 'Docker', 'Terraform'];

// Mongoose stays MongoDB only: the database is the fact an architecture states,
// and naming the ODM too would warn every project that already documents MongoDB.
// A package.json covers every name in TECH_PATTERNS, so each name needs a
// dependency here or a universal signal; Angular and Svelte had none, and the
// official `mongodb`, `mysql` and `postgres` clients mapped to nothing, so a
// Node project documenting them always read "documented but not found".
// `angular` (AngularJS) is a different framework and is not mapped.
// @implements docguard.dogfood-round-2#FR-006
// @implements docguard.coverage-followups#FR-005
export const TECH_DEPENDENCIES = Object.freeze({
  'react': 'React', 'next': 'Next.js', 'vue': 'Vue', '@angular/core': 'Angular',
  'svelte': 'Svelte', '@sveltejs/kit': 'Svelte', 'express': 'Express',
  'fastify': 'Fastify', 'hono': 'Hono', 'prisma': 'Prisma', '@prisma/client': 'Prisma',
  'drizzle-orm': 'Drizzle', 'typeorm': 'TypeORM', 'sequelize': 'Sequelize',
  'typescript': 'TypeScript', 'tailwindcss': 'Tailwind',
  'redis': 'Redis', 'ioredis': 'Redis', 'pg': 'PostgreSQL', 'postgres': 'PostgreSQL',
  'mysql2': 'MySQL', 'mysql': 'MySQL', 'mongoose': 'MongoDB', 'mongodb': 'MongoDB',
  '@aws-sdk/client-dynamodb': 'DynamoDB', '@aws-sdk/lib-dynamodb': 'DynamoDB',
});

/** Read everywhere, whatever the language: Dockerfiles, compose files, scripts, `.tf`. */
export const UNIVERSAL_TECH = Object.freeze(['Docker', 'Terraform']);

/*
 * Non-Node ecosystems (docguard.dogfood-round-2#FR-007). `deps` maps a
 * dependency (exact name, or a module-path prefix for Go) to a technology.
 * `covers` lists the technologies whose ABSENCE the manifest proves: every
 * common client is a dedicated package the manifest declares directly. A
 * technology reached through a generic SDK (boto3, aws-sdk-go v1, the PHP AWS
 * SDK), a build feature (sqlx `postgres`), a PHP extension or a Gradle version
 * catalog leaves no dependency to find, so it is detected when present but
 * never reported as "documented but not found". Node keeps today's behaviour:
 * a package.json covers every technology in TECH_PATTERNS.
 */
const ECOSYSTEM_TECH = {
  Python: {
    normalize: name => name.toLowerCase().replace(/_/g, '-'),
    deps: {
      'redis': 'Redis', 'django-redis': 'Redis', 'aioredis': 'Redis', 'rq': 'Redis',
      'psycopg2': 'PostgreSQL', 'psycopg2-binary': 'PostgreSQL', 'psycopg': 'PostgreSQL', 'asyncpg': 'PostgreSQL', 'pg8000': 'PostgreSQL',
      'mysqlclient': 'MySQL', 'pymysql': 'MySQL', 'mysql-connector-python': 'MySQL', 'aiomysql': 'MySQL',
      'pymongo': 'MongoDB', 'motor': 'MongoDB', 'mongoengine': 'MongoDB', 'beanie': 'MongoDB',
      'pynamodb': 'DynamoDB',
    },
    // Redis is often reached through an extra (`celery[redis]`), which the manifest parse drops.
    covers: ['PostgreSQL', 'MySQL', 'MongoDB'],
  },
  Go: {
    prefix: true,
    deps: {
      'github.com/redis/go-redis': 'Redis', 'github.com/go-redis/redis': 'Redis', 'github.com/gomodule/redigo': 'Redis',
      'github.com/lib/pq': 'PostgreSQL', 'github.com/jackc/pgx': 'PostgreSQL', 'gorm.io/driver/postgres': 'PostgreSQL',
      'github.com/go-sql-driver/mysql': 'MySQL', 'gorm.io/driver/mysql': 'MySQL',
      'go.mongodb.org/mongo-driver': 'MongoDB',
      'github.com/aws/aws-sdk-go-v2/service/dynamodb': 'DynamoDB', 'github.com/guregu/dynamo': 'DynamoDB',
    },
    covers: ['Redis', 'PostgreSQL', 'MySQL', 'MongoDB'],
  },
  Ruby: {
    deps: {
      'redis': 'Redis', 'redis-client': 'Redis', 'sidekiq': 'Redis', 'resque': 'Redis',
      'pg': 'PostgreSQL', 'mysql2': 'MySQL', 'trilogy': 'MySQL',
      'mongoid': 'MongoDB', 'mongo': 'MongoDB',
      'aws-sdk-dynamodb': 'DynamoDB', 'dynamoid': 'DynamoDB', 'aws-record': 'DynamoDB',
    },
    covers: ['Redis', 'PostgreSQL', 'MySQL', 'MongoDB'],
  },
  Rust: {
    deps: {
      'redis': 'Redis', 'fred': 'Redis', 'deadpool-redis': 'Redis', 'bb8-redis': 'Redis',
      'postgres': 'PostgreSQL', 'tokio-postgres': 'PostgreSQL', 'deadpool-postgres': 'PostgreSQL',
      'mysql': 'MySQL', 'mysql_async': 'MySQL',
      'mongodb': 'MongoDB',
      'aws-sdk-dynamodb': 'DynamoDB', 'rusoto_dynamodb': 'DynamoDB',
    },
    // PostgreSQL and MySQL are often a feature of sqlx or diesel, invisible to the dependency list.
    covers: ['Redis', 'MongoDB', 'DynamoDB'],
  },
  PHP: {
    normalize: name => name.toLowerCase(),
    deps: {
      'predis/predis': 'Redis', 'ext-redis': 'Redis',
      'ext-pgsql': 'PostgreSQL', 'ext-pdo_pgsql': 'PostgreSQL', 'ext-mysqli': 'MySQL', 'ext-pdo_mysql': 'MySQL',
      'mongodb/mongodb': 'MongoDB', 'mongodb/laravel-mongodb': 'MongoDB', 'jenssegers/mongodb': 'MongoDB', 'ext-mongodb': 'MongoDB',
    },
    // PDO drivers and phpredis are extensions a project rarely declares.
    covers: ['MongoDB'],
  },
  'C#': {
    normalize: name => name.toLowerCase(),
    deps: {
      'stackexchange.redis': 'Redis', 'microsoft.extensions.caching.stackexchangeredis': 'Redis',
      'npgsql': 'PostgreSQL', 'npgsql.entityframeworkcore.postgresql': 'PostgreSQL',
      'mysql.data': 'MySQL', 'mysqlconnector': 'MySQL', 'pomelo.entityframeworkcore.mysql': 'MySQL', 'mysql.entityframeworkcore': 'MySQL',
      'mongodb.driver': 'MongoDB', 'awssdk.dynamodbv2': 'DynamoDB',
    },
    covers: ['Redis', 'PostgreSQL', 'MySQL', 'MongoDB', 'DynamoDB'],
  },
  Java: {
    deps: {
      'redis.clients:jedis': 'Redis', 'io.lettuce:lettuce-core': 'Redis', 'org.redisson:redisson': 'Redis',
      'org.springframework.boot:spring-boot-starter-data-redis': 'Redis',
      'org.postgresql:postgresql': 'PostgreSQL', 'com.mysql:mysql-connector-j': 'MySQL', 'mysql:mysql-connector-java': 'MySQL',
      'org.mongodb:mongodb-driver-sync': 'MongoDB', 'org.mongodb:mongodb-driver-reactivestreams': 'MongoDB',
      'org.springframework.boot:spring-boot-starter-data-mongodb': 'MongoDB',
      'software.amazon.awssdk:dynamodb': 'DynamoDB', 'software.amazon.awssdk:dynamodb-enhanced': 'DynamoDB',
      'com.amazonaws:aws-java-sdk-dynamodb': 'DynamoDB',
    },
    // Gradle version catalogs and runtime-only scopes hide drivers from the parse.
    covers: [],
  },
};
ECOSYSTEM_TECH.Kotlin = ECOSYSTEM_TECH.Java;

function ecosystemTechnologies(spec, deps) {
  const normalize = spec.normalize || (name => name);
  const found = [];
  for (const raw of Object.keys(deps || {})) {
    const name = normalize(raw);
    for (const [dep, tech] of Object.entries(spec.deps)) {
      if (name === dep || (spec.prefix && name.startsWith(dep + '/'))) found.push({ tech, dep: raw });
    }
  }
  return found;
}

/*
 * Source-text signals for technologies a project can use without declaring a
 * dependency (docguard.dogfood-round-2#FR-002/FR-003). Each one is a string
 * that cannot mean anything else: DynamoDB's wire target prefix and endpoint,
 * its local image, the SDK v2 and boto3 constructors, an endpoint setting; and
 * a docker command in a script. Ambiguous names (redis, postgres) get none.
 * The patterns are written so their own source text does not match them.
 */
const DYNAMODB_TEXT_SIGNALS = [
  [/\bDynamoDB_\d{8}\.[A-Z]\w*/, 'DynamoDB API target'],
  [/\bdynamodb\.[a-z]{2}(?:-[a-z]+)+-\d\.amazonaws\.com/, 'DynamoDB endpoint'],
  [/\bamazon\/dynamodb-local\b/, 'DynamoDB Local image'],
  [/\bAWS\.DynamoDB\b/, 'AWS SDK v2 client'],
  [/\b(?:client|resource)\(\s*['"]dynamodb['"]/, 'boto3 client'],
  [/\b(?:DYNAMODB|DDB)_ENDPOINT\b/, 'endpoint setting'],
];
const DOCKER_COMMAND_RE = /\bdocker\s+(?:run|build|compose)\b|\bdocker-compose\s+[a-z]/;
const SCRIPT_FILE_RE = /\.(?:sh|bash|zsh|mk)$|(?:^|\/)(?:GNUmakefile|[Mm]akefile)$/;
const CI_FILE_RE = /^\.github\/workflows\/[^/]+\.ya?ml$|(?:^|\/)\.gitlab-ci\.ya?ml$/;
const COMPOSE_FILE_RE = /(?:^|\/)(?:compose|docker-compose(?:\.[\w-]+)?)\.ya?ml$/;
const COMMENT_LINE_RE = /^\s*(?:#|\/\/|\/\*|\*)/;
const TEST_FILE_RE = /\.(?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]*\.py$/i;
const extOf = filePath => (String(filePath).match(/\.[^./\\]+$/) || [''])[0].toLowerCase();

/** Lines that are not whole-line comments: a commented-out command is not use. */
const liveText = content => content.split('\n').filter(line => !COMMENT_LINE_RE.test(line)).join('\n');

const TECH_WALK_IGNORE = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'docs-canonical', 'docs-implementation', 'templates',
]);

/**
 * Everything the tech-stack check needs in one pass:
 *   evidence — one `{ tech, file, signal, kind }` per technology found, in
 *              TECH_PATTERNS order; `kind` is 'manifest' or 'source' (a text signal)
 *   covered  — technologies whose absence the project's manifests prove
 *              (all of TECH_PATTERNS when a package.json exists, as before)
 *   hasManifest — whether any dependency manifest was read; without one
 *              there is no code-side truth and the check is skipped
 * @returns {{ evidence: Array<{ tech: string, file: string, signal: string, kind: 'manifest'|'source' }>, covered: Set<string>, hasManifest: boolean }}
 */
export function scanCodeTechnologies(dir, config = {}) {
  const root = resolve(dir);
  const found = new Map();
  const covered = new Set(UNIVERSAL_TECH);
  const add = (tech, file, signal, kind) => { if (!found.has(tech)) found.set(tech, { tech, file, signal, kind }); };

  const pkgs = collectPackageJsons(dir, config);
  for (const { dir: pkgDir, pkg } of pkgs) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const file = relative(root, join(pkgDir, 'package.json')).split('\\').join('/');
    for (const [dep, tech] of Object.entries(TECH_DEPENDENCIES)) if (deps[dep]) add(tech, file, 'dependency ' + dep, 'manifest');
  }
  if (pkgs.length) for (const tech of TECH_PATTERNS) covered.add(tech);

  let otherManifests = 0;
  for (const eco of detectEcosystems(dir, config)) {
    const spec = ECOSYSTEM_TECH[eco.language];
    if (!spec) continue;
    otherManifests++;
    for (const tech of spec.covers) covered.add(tech);
    for (const { tech, dep } of ecosystemTechnologies(spec, eco.deps)) add(tech, eco.manifest.split('\\').join('/'), 'dependency ' + dep, 'manifest');
  }

  const dockerManifest = findDockerManifest(dir, config);
  if (dockerManifest) add('Docker', dockerManifest, 'Docker manifest', 'manifest');

  walkFiles(root, (full) => {
    const rel = relative(root, full).split('\\').join('/');
    if (shouldIgnore(rel, config)) return;
    if (extOf(full) === '.tf') { add('Terraform', rel, 'Terraform file', 'manifest'); return; }
    const wantDynamo = !found.has('DynamoDB');
    const wantDocker = !found.has('Docker');
    if (!wantDynamo && !wantDocker) return;
    if (isNonProductPath(rel, config) || TEST_FILE_RE.test(rel)) return;
    const isScript = SCRIPT_FILE_RE.test(rel);
    const isCi = CI_FILE_RE.test(rel);
    const isCompose = COMPOSE_FILE_RE.test(rel);
    if (wantDocker && isCompose) add('Docker', rel, 'compose file', 'source');
    if (!isScript && !isCi && !isCompose && !CODE_EXTENSIONS.has(extOf(full))) return;
    const raw = readScannable(full);
    if (raw === null) return;
    const text = liveText(raw);
    if (wantDynamo) {
      const hit = DYNAMODB_TEXT_SIGNALS.find(([re]) => re.test(text));
      if (hit) add('DynamoDB', rel, hit[1], 'source');
    }
    if (wantDocker && (isScript || isCi)) {
      const command = DOCKER_COMMAND_RE.exec(text);
      if (command) add('Docker', rel, command[0].replace(/\s+/g, ' ').replace(/^(docker-compose) \w+$/, '$1'), 'source');
    }
  }, { ignoreDirs: TECH_WALK_IGNORE, keepDot: entry => entry === '.github' || /^\.gitlab-ci\.ya?ml$/.test(entry) });

  return {
    evidence: TECH_PATTERNS.filter(t => found.has(t)).map(t => found.get(t)),
    covered,
    hasManifest: pkgs.length > 0 || otherManifests > 0,
  };
}

/** The technologies the code shows, each with the file that shows it. */
export function detectCodeTechnologyEvidence(dir, config = {}) {
  return scanCodeTechnologies(dir, config).evidence;
}

/**
 * The technology names the code shows.
 * @returns {string[]} in TECH_PATTERNS order
 */
export function detectCodeTechnologies(dir, config = {}) {
  return detectCodeTechnologyEvidence(dir, config).map(e => e.tech);
}
