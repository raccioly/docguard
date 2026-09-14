import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildIssueUrl } from '../cli/commands/feedback.mjs';

// @req docs-canonical/REQUIREMENTS.md#FR-002 — confident findings can be challenged without sharing source data.
describe('feedback contribution workflow', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir,{recursive:true,force:true}); dir = null; });
  function run(args) {
    if (!dir) {
      dir=mkdtempSync(join(tmpdir(),'docguard-feedback-review-'));
      writeFileSync(join(dir,'.docguard.json'), JSON.stringify({profile:'starter',projectName:'private-customer',diskCache:false}));
    }
    return spawnSync(process.execPath,[join(process.cwd(),'cli/docguard.mjs'),'feedback','--dir',dir,'--format','json',...args],{encoding:'utf8'});
  }
  it('shared URLs exclude all source-derived strings', () => {
    const f={code:'SEC001',validator:'private-validator',confidence:'high',message:'secret-project password=secret',location:'/private-client/secret.ts:3',redactedContext:'still-sensitive-context',suggestion:{text:'sensitive suggestion'}};
    const {url,searchUrl}=buildIssueUrl(f);
    const decoded=decodeURIComponent(url);
    for(const secret of ['private-validator','secret-project','password=secret','private-client','secret.ts','still-sensitive-context','sensitive suggestion']) assert.ok(!decoded.includes(secret),secret);
    assert.ok(url.length<1800);
    assert.ok(searchUrl.includes('SEC001'));
    assert.ok(!searchUrl.includes('is%3Aopen'));
  });
  it('allows all confident findings and preview creates no feedback directory', () => {
    const r=run(['--all','--preview']);
    assert.equal(r.status,0,r.stderr);
    const data=JSON.parse(r.stdout);
    assert.equal(data.classification, 'false_positive');
    assert.ok(data.reportable.length>0);
    assert.equal(data.preview,true);
    assert.equal(existsSync(join(dir,'.docguard/feedback')),false);
    for(const item of data.reportable) {
      assert.ok(item.searchUrl);
      assert.equal(item.saved, false);
      assert.equal(item.error, null);
      assert.equal(item.file, null);
    }
    const selected=run(['--code',data.reportable[0].code,'--preview']);
    assert.ok(JSON.parse(selected.stdout).reportable.every(f=>f.code===data.reportable[0].code));
  });
  it('keeps ambiguous and policy feedback distinct and requires fixtures for absent findings', () => {
    for (const classification of ['ambiguous', 'policy-disagreement']) {
      const r = run(['--all', '--classification', classification, '--preview']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).classification, classification.replace('-', '_'));
    }
    for (const classification of ['false-negative', 'unsupported-syntax']) {
      const r = run(['--classification', classification, '--code', 'SEC001', '--preview']);
      assert.equal(r.status, 1);
      assert.match(JSON.parse(r.stdout).error, /requires --fixture-manifest/);
    }
  });
  it('rejects invalid and missing code values instead of silently selecting other findings', () => {
    for(const args of [['--code','NOTREAL'],['--code']]) {
      const r=run(args);assert.equal(r.status,1);assert.ok(JSON.parse(r.stdout).error);
      assert.equal(existsSync(join(dir,'.docguard/feedback')),false);
    }
  });
  it('reports saved files only after their diagnostic records exist', () => {
    const r = run(['--all']);
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.equal(data.preview, false);
    assert.ok(data.reportable.length > 0);
    for (const item of data.reportable) {
      assert.equal(item.saved, true);
      assert.equal(item.error, null);
      const record = JSON.parse(readFileSync(join(dir, item.file), 'utf8'));
      assert.equal(record.finding.code, item.code);
      assert.equal(record.issueUrl, item.url);
    }
  });
  it('fails with per-entry errors when the feedback directory is blocked', () => {
    run(['--all', '--preview']);
    writeFileSync(join(dir, '.docguard'), 'not a directory');
    const r = run(['--all']);
    assert.equal(r.status, 1);
    const data = JSON.parse(r.stdout);
    assert.equal(data.preview, false);
    assert.ok(data.reportable.length > 0);
    for (const item of data.reportable) {
      assert.equal(item.saved, false);
      assert.equal(item.file, null);
      assert.match(item.error, /Unable to save feedback record/);
      assert.ok(item.url);
    }
    const preview = run(['--all', '--preview']);
    assert.equal(preview.status, 0, preview.stderr);
    for (const item of JSON.parse(preview.stdout).reportable) {
      assert.equal(item.saved, false);
      assert.equal(item.error, null);
    }
    const text = run(['--all', '--format', 'text']);
    assert.equal(text.status, 1);
    assert.match(text.stderr, /Unable to save feedback record/);
    assert.doesNotMatch(text.stdout, /Local copy/);
  });

});
