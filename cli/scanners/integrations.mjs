/**
 * External Integrations Scanner — what third-party services does this project talk to?
 *
 * Recognizes common SDKs/clients across all detected ecosystems (JS/TS, Python,
 * Rust, Go, Java, Ruby, PHP, .NET) by name-matching dependencies against a
 * curated registry. Output is the project's external-system surface — the kind
 * of "this integrates with AWS S3, Stripe, OpenAI, Sentry" facts the AI agent
 * uses to write INTEGRATIONS.md.
 *
 * Deterministic facts; the agent narrates. Zero NPM dependencies.
 */

import { detectEcosystems } from './project-type.mjs';

/**
 * Registry of integrations. Each entry: a category label + name patterns to
 * match against dependency keys (substring, lowercased). Add new SDKs here.
 */
const REGISTRY = [
  // ── Cloud ──
  { name: 'AWS', category: 'Cloud', patterns: ['@aws-sdk/', 'aws-sdk', 'boto3', 'aws-sdk-go', 'aws-sdk-rust', 'aws.sdk', 'amazon-aws'] },
  { name: 'Google Cloud', category: 'Cloud', patterns: ['@google-cloud/', 'google-cloud-', 'gcloud'] },
  { name: 'Azure', category: 'Cloud', patterns: ['@azure/', 'azure-', 'azure.sdk'] },
  { name: 'Cloudflare', category: 'Cloud', patterns: ['cloudflare', 'wrangler', '@cloudflare/'] },
  { name: 'Vercel', category: 'Cloud', patterns: ['@vercel/', 'vercel/'] },
  // ── Databases / storage ──
  { name: 'PostgreSQL', category: 'Database', patterns: ['pg', '@neondatabase/serverless', 'postgres', 'psycopg', 'sqlx', 'lib/pq'] },
  { name: 'MySQL',      category: 'Database', patterns: ['mysql2', 'mysql-connector', 'pymysql'] },
  { name: 'MongoDB',    category: 'Database', patterns: ['mongoose', 'mongodb', 'pymongo'] },
  { name: 'DynamoDB',   category: 'Database', patterns: ['@aws-sdk/client-dynamodb', 'aws-sdk/dynamodb', 'boto3.dynamodb'] },
  { name: 'Redis',      category: 'Database', patterns: ['redis', 'ioredis', 'redis-rs', 'go-redis'] },
  { name: 'Supabase',   category: 'Database', patterns: ['@supabase/', 'supabase-py', 'supabase-go'] },
  { name: 'Firebase',   category: 'Database', patterns: ['firebase', '@firebase/', 'firebase-admin', 'pyrebase'] },
  // ── Payments ──
  { name: 'Stripe',     category: 'Payments', patterns: ['stripe', '@stripe/', 'stripe-go', 'stripe-java'] },
  { name: 'Braintree',  category: 'Payments', patterns: ['braintree'] },
  { name: 'PayPal',     category: 'Payments', patterns: ['@paypal/', 'paypal-checkout'] },
  // ── Auth ──
  { name: 'Auth0',      category: 'Auth', patterns: ['@auth0/', 'auth0-'] },
  { name: 'Clerk',      category: 'Auth', patterns: ['@clerk/'] },
  { name: 'NextAuth',   category: 'Auth', patterns: ['next-auth', '@auth/'] },
  { name: 'Passport',   category: 'Auth', patterns: ['passport', 'passport-'] },
  { name: 'Cognito',    category: 'Auth', patterns: ['@aws-sdk/client-cognito-identity', 'amazon-cognito-identity-js', 'aws-amplify'] },
  // ── AI ──
  { name: 'OpenAI',     category: 'AI', patterns: ['openai'] },
  { name: 'Anthropic',  category: 'AI', patterns: ['@anthropic-ai/sdk', 'anthropic'] },
  { name: 'LangChain',  category: 'AI', patterns: ['langchain', '@langchain/'] },
  { name: 'Hugging Face', category: 'AI', patterns: ['huggingface', '@huggingface/', 'transformers'] },
  // ── Messaging / email ──
  { name: 'Twilio',     category: 'Messaging', patterns: ['twilio'] },
  { name: 'SendGrid',   category: 'Messaging', patterns: ['@sendgrid/', 'sendgrid'] },
  { name: 'Mailgun',    category: 'Messaging', patterns: ['mailgun', 'mailgun.js'] },
  { name: 'Resend',     category: 'Messaging', patterns: ['resend'] },
  { name: 'Slack',      category: 'Messaging', patterns: ['@slack/', 'slack-sdk', 'slack_sdk'] },
  { name: 'Bird (MessageBird)', category: 'Messaging', patterns: ['messagebird', 'bird-sdk', '@birdapp/'] },
  // ── Observability ──
  { name: 'Sentry',     category: 'Observability', patterns: ['@sentry/', 'sentry-sdk', 'sentry-go'] },
  { name: 'Datadog',    category: 'Observability', patterns: ['dd-trace', '@datadog/', 'datadog'] },
  { name: 'OpenTelemetry', category: 'Observability', patterns: ['@opentelemetry/', 'opentelemetry-'] },
  { name: 'Pino',       category: 'Observability', patterns: ['pino'] },
  // ── Search ──
  { name: 'Algolia',    category: 'Search', patterns: ['algoliasearch', '@algolia/', 'algolia'] },
  { name: 'Elasticsearch', category: 'Search', patterns: ['@elastic/elasticsearch', 'elasticsearch'] },
  { name: 'Meilisearch',category: 'Search', patterns: ['meilisearch'] },
  { name: 'Typesense',  category: 'Search', patterns: ['typesense'] },
  // ── Queues ──
  { name: 'SQS',        category: 'Queue', patterns: ['@aws-sdk/client-sqs'] },
  { name: 'RabbitMQ',   category: 'Queue', patterns: ['amqplib', 'pika'] },
  { name: 'Kafka',      category: 'Queue', patterns: ['kafkajs', 'sarama', 'confluent-kafka'] },
  // ── Storage ──
  { name: 'S3',         category: 'Storage', patterns: ['@aws-sdk/client-s3', 'multer-s3', 'boto3.s3'] },
];

function depKeys(deps) {
  return Object.keys(deps).map(k => k.toLowerCase());
}

function matches(keys, patterns) {
  const evidence = [];
  for (const p of patterns) {
    const needle = p.toLowerCase();
    for (const k of keys) {
      if (k.includes(needle)) evidence.push(k);
    }
  }
  return evidence;
}

/**
 * Detect external integrations across all ecosystems in the project.
 * @returns {Array<{ name, category, ecosystems: string[], evidence: string[] }>}
 */
export function detectIntegrations(projectDir, config = {}) {
  const ecosystems = detectEcosystems(projectDir, config);
  const found = new Map(); // name -> { name, category, ecosystems:Set, evidence:Set }

  for (const eco of ecosystems) {
    const keys = depKeys(eco.deps);
    if (keys.length === 0) continue;
    for (const entry of REGISTRY) {
      const ev = matches(keys, entry.patterns);
      if (ev.length === 0) continue;
      let row = found.get(entry.name);
      if (!row) {
        row = { name: entry.name, category: entry.category, ecosystems: new Set(), evidence: new Set() };
        found.set(entry.name, row);
      }
      row.ecosystems.add(eco.language);
      for (const e of ev) row.evidence.add(e);
    }
  }

  return [...found.values()]
    .map(r => ({ name: r.name, category: r.category, ecosystems: [...r.ecosystems], evidence: [...r.evidence] }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
