/**
 * Spec 108: config files are scanned for secrets (issue 719), and every file DocGuard recognizes but
 * does not analyze is disclosed (issue 718). The literal values are made up.
 *
 * @req docguard.analysis-disclosure#FR-001
 * @req docguard.analysis-disclosure#FR-002
 * @req docguard.analysis-disclosure#FR-003
 * @req docguard.analysis-disclosure#FR-004
 * @req docguard.analysis-disclosure#FR-005
 * @req docguard.analysis-disclosure#FR-006
 * @req docguard.analysis-disclosure#FR-007
 * @req docguard.analysis-disclosure#FR-008
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSecurity } from '../cli/validators/security.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };

function tree(t, files) {
  const dir = makeTempDir('dg-108-', t);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sec = (dir) => validateSecurity(dir, {}).findings.filter(f => /^SEC00[1-6]$/.test(f.code));
const at = (findings, file) => findings.filter(f => String(f.location).startsWith(`${file}:`));

const SPRING = {
  'package.json': '{"name":"demo","version":"1.0.0"}\n',
  '.gitignore': '.env\n',
  'src/main/java/demo/App.java': 'package demo; public class App { public static void main(String[] a) { System.out.println("ok"); } }\n',
  'src/main/resources/application.yml': [
    'spring:', '  datasource:', '    url: jdbc:postgresql://db:5432/orders', '    username: orders', '    password: Hx7kQ2vLp9zRw4Tn',
    'partner:', '  client-secret: q8Wd3LmZx2Rt7KpVb5NcY6', '  api-key: "${PARTNER_API_KEY}"', '',
  ].join('\n'),
  'src/main/resources/application.properties': 'mail.smtp.password=Mz4tR8wQ2nLp6vXc\nmail.smtp.user=orders\n',
  'src/main/resources/config/dev.yaml': 'partner:\n  clientSecret: "q8Wd3LmZx2Rt7KpVb5NcY6"\n  token: "${secure::partner.token}"\n',
};

describe('issue 719: config files are scanned for secrets', () => {
  it('Spring application.yml and .properties, and a Mule config YAML', (t) => {
    const dir = tree(t, SPRING);
    const found = sec(dir);
    assert.deepEqual(at(found, 'src/main/resources/application.yml').map(f => f.location).sort(), ['src/main/resources/application.yml:5', 'src/main/resources/application.yml:7']);
    assert.deepEqual(at(found, 'src/main/resources/application.properties').map(f => f.location), ['src/main/resources/application.properties:1']);
    assert.deepEqual(at(found, 'src/main/resources/config/dev.yaml').map(f => f.location), ['src/main/resources/config/dev.yaml:2']);
    for (const f of found) assert.equal(f.severity, 'error', f.location);
  });

  it('placeholder forms and safe defaults are not secrets', (t) => {
    const lines = [
      'a:', '  password: "${DB_PASSWORD}"', '  password2: ${DB_PASSWORD:}', '  secret: "${secure::db.secret}"', "  token: p('secure::db.token')",
      '  client_secret: "{cipher}AQB3kJZx2Rt7KpVb5Nc"', '  api_key: ENC(q8Wd3LmZx2Rt7KpVb5NcY6)', '  secret_key: vault:secret/data/app#key',
      '  password3: "${{ secrets.DB_PASSWORD }}"', '  password4: "{{ .Values.db.password }}"', '  password5: "%env(DB_PASSWORD)%"',
      "  password6: \"<%= ENV['DB_PASSWORD'] %>\"", '  password7:', '  password8: null', '  password9: ~', '',
    ].join('\n');
    const dir = tree(t, { 'config/app.yaml': lines });
    assert.deepEqual(sec(dir).map(f => `${f.location} ${f.severity}`), []);
  });

  it('a literal default inside ${VAR:default} is still a secret', (t) => {
    const dir = tree(t, { 'config/app.yaml': 'db:\n  password: ${DB_PASSWORD:Hx7kQ2vLp9zRw4Tn}\n' });
    assert.deepEqual(sec(dir).map(f => `${f.location} ${f.severity}`), ['config/app.yaml:2 error']);
  });

  it('a well-known default is a low-confidence warning; lockfiles, examples and test resources do not fail', (t) => {
    const dir = tree(t, {
      'docker-compose.yml': 'services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: postgres\n',
      'pnpm-lock.yaml': 'packages:\n  /x:\n    password: Hx7kQ2vLp9zRw4Tn\n',
      'config/app.yaml.example': 'password: Hx7kQ2vLp9zRw4Tn\n',
      'src/test/resources/application.yml': 'spring:\n  datasource:\n    password: Hx7kQ2vLp9zRw4Tn\n',
    });
    const found = sec(dir);
    const compose = at(found, 'docker-compose.yml');
    assert.equal(compose.length, 1);
    assert.equal(compose[0].severity, 'warn');
    assert.equal(compose[0].confidence, 'low');
    assert.equal(at(found, 'pnpm-lock.yaml').length, 0);
    assert.equal(at(found, 'config/app.yaml.example').length, 0);
    assert.equal(at(found, 'src/test/resources/application.yml')[0]?.context, 'test-path');
  });

  it('the A/B false positives: CloudFormation tags, ${VAR:?msg}, shell substitution, an OpenAPI example, a dev phrase', (t) => {
    const dir = tree(t, {
      'infra/template.yaml': 'Resources:\n  Fn:\n    Properties:\n      Environment:\n        Variables:\n          TOKEN_SECRET: !Ref TokenSecretParam\n          SIGNING_SECRET: !Sub "{{resolve:secretsmanager:${Arn}}}"\n',
      'infra/compose.yaml': 'services:\n  cache:\n    environment:\n      REDIS_PASSWORD: ${REDIS_PASSWORD:?set REDIS_PASSWORD in your local env file}\n      ROOT_SECRET: ${ROOT_SECRET?set it first please now}\n      TOKEN_SECRET: local-development-token-secret-value\n',
      'scripts/setup.sh': '#!/bin/sh\nredis_password="$(openssl rand -hex 24)"\n',
      'docs/openapi.yaml': 'paths:\n  /login:\n    post:\n      requestBody:\n        content:\n          application/json:\n            example:\n              email: a@b.test\n              password: Zp2Wm7x41k8Jd93\n',
    });
    const found = sec(dir);
    assert.deepEqual(found.filter(f => f.severity === 'error').map(f => f.location), []);
    assert.deepEqual(found.map(f => f.location).sort(), ['docs/openapi.yaml:9', 'infra/compose.yaml:6']);
  });

  it('the #715 value shapes apply to config values too', (t) => {
    const dir = tree(t, { 'config/routes.yaml': 'links:\n  forgotPassword: /forgot-password\n  accessToken: https://auth.sandbox.payments.test/oauth2/token\n' });
    const found = sec(dir);
    assert.ok(found.length === 2 && found.every(f => f.severity === 'warn' && f.confidence === 'low'), JSON.stringify(found.map(f => [f.location, f.severity])));
  });

  it('appsettings.json keys, Mule flow XML attributes and a Salesforce flow variable', (t) => {
    const dir = tree(t, {
      'appsettings.Development.json': '{\n  "Partner": {\n    "ClientSecret": "q8Wd3LmZx2Rt7KpVb5NcY6",\n    "Url": "https://partner.test"\n  }\n}\n',
      'package.json': '{ "name": "x", "password": "Hx7kQ2vLp9zRw4Tn" }\n',
      'pom.xml': '<project><properties><db.password>Hx7kQ2vLp9zRw4Tn</db.password></properties></project>\n',
      'src/main/mule/orders.xml': '<mule xmlns="http://www.mulesoft.org/schema/mule/core">\n  <db:config name="db"><db:generic-connection url="jdbc:postgresql://db/orders" user="orders" password="Hx7kQ2vLp9zRw4Tn"/></db:config>\n  <db:config name="db2"><db:generic-connection password="${secure::db.password}"/></db:config>\n</mule>\n',
      'force-app/main/default/flows/Sync_Partner.flow-meta.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata">\n    <variables><name>apiKey</name><dataType>String</dataType><value><stringValue>q8Wd3LmZx2Rt7KpVb5NcY6</stringValue></value></variables>\n    <variables><name>label</name><value><stringValue>q8Wd3LmZx2Rt7KpVb5NcY6</stringValue></value></variables>\n</Flow>\n',
    });
    const found = sec(dir);
    assert.deepEqual(at(found, 'appsettings.Development.json').map(f => f.location), ['appsettings.Development.json:3']);
    assert.equal(at(found, 'package.json').length, 0, 'package.json is not a config the scan reads by key');
    assert.equal(at(found, 'pom.xml').length, 0, 'pom.xml is not read');
    assert.deepEqual(at(found, 'src/main/mule/orders.xml').map(f => f.location), ['src/main/mule/orders.xml:2']);
    assert.deepEqual(at(found, 'force-app/main/default/flows/Sync_Partner.flow-meta.xml').map(f => f.location), ['force-app/main/default/flows/Sync_Partner.flow-meta.xml:3']);
  });
});

describe('issue 718: files DocGuard recognizes but does not analyze are disclosed', () => {
  const MIXED = {
    'package.json': '{"name":"orders","version":"1.0.0"}\n',
    'sfdx-project.json': '{"packageDirectories":[{"path":"force-app","default":true}],"sourceApiVersion":"61.0"}\n',
    'force-app/main/default/lwc/orderList/orderList.js': "import { LightningElement } from 'lwc';\nexport default class OrderList extends LightningElement {}\n",
    'force-app/main/default/lwc/orderList/orderList.html': '<template><p>orders</p></template>\n',
    'force-app/main/default/classes/PartnerClient.cls': "public with sharing class PartnerClient {\n    private static final String password = 'Hx7kQ2vLp9zRw4Tn';\n}\n",
    'mule/src/main/resources/dwl/to-order.dwl': '%dw 2.0\noutput application/json\n---\n{ id: payload.id }\n',
    'mule/src/main/mule/orders.xml': '<mule xmlns="http://www.mulesoft.org/schema/mule/core"><flow name="f"/></mule>\n',
  };

  it('guard JSON has an unanalyzed block, the text output one line, and SEC012 counts what the secret scan skipped', (t) => {
    const dir = tree(t, MIXED);
    assert.equal(run(dir, ['init', '--skip-prompts', '--no-spec-kit']).status, 0);
    const before = run(dir, ['guard', '--format', 'json']);
    const data = JSON.parse(before.stdout);
    const byLang = Object.fromEntries((data.unanalyzed || []).map(u => [u.language, u]));
    assert.deepEqual(byLang.dataweave, { language: 'dataweave', name: 'DataWeave', files: 1, missing: ['secrets', 'traceability'], example: 'mule/src/main/resources/dwl/to-order.dwl' });
    assert.ok(byLang['mule-flow'], 'Mule flow XML is named');
    assert.equal(byLang['mule-flow'].missing.includes('secrets'), false, 'Mule flow XML is scanned for secrets');
    assert.equal(byLang.apex, undefined, 'Apex is fully read');
    const [sec012] = data.findings.filter(f => f.code === 'SEC012');
    assert.ok(sec012, 'SEC012 fires');
    assert.equal(sec012.effectiveSeverity, 'info');
    assert.match(sec012.message, /DataWeave \(1\)/);
    assert.match(run(dir, ['guard']).stdout, /Not analyzed by DocGuard: .*DataWeave/);
    const compact = JSON.parse(run(dir, ['guard', '--format', 'json', '--compact']).stdout);
    assert.deepEqual(compact.unanalyzed.find(u => u.language === 'dataweave'), { language: 'dataweave', files: 1 });
    assert.equal(data.exitCode, compact.exitCode);
  });

  it('a MuleSoft application is named, says it has no analyzer, and does not make API-Surface apply', (t) => {
    const dir = tree(t, {
      'pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>orders-api</artifactId><version>1.0.0</version><packaging>mule-application</packaging></project>\n',
      'src/main/mule/orders.xml': '<mule xmlns="http://www.mulesoft.org/schema/mule/core"><flow name="get-order"><logger message="ok"/></flow></mule>\n',
      'src/main/resources/config/dev.yaml': 'http:\n  port: "8081"\n',
    });
    const gen = run(dir, ['generate']);
    assert.match(gen.stdout, /MuleSoft \(no DocGuard analyzer/);
    assert.equal(run(dir, ['init', '--skip-prompts', '--no-spec-kit']).status, 0);
    const data = JSON.parse(run(dir, ['guard', '--format', 'json']).stdout);
    assert.equal(data.strict.blocking.includes('apiSurface'), false);
  });
});
