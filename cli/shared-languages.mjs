/**
 * Source languages that one entry describes for every scanner (specs/106-field-report-fixes).
 *
 * Each scanner used to keep its own list of extensions, so a language was read by
 * one check and not by the next: Salesforce Apex was read by none of the secret
 * scan, test detection, traceability and the phantom-completion check. A language
 * is now one entry, and each consumer asks the entry. This module is a leaf: it
 * imports nothing, so any module can use it (Constitution IV).
 *
 * The Apex extension set and the id `apex` match the websec-validator change for
 * the same field report, so the two tools name the same files the same way.
 *
 * @implements docguard.field-report-fixes#FR-003
 */

/** Salesforce Apex: classes, triggers and anonymous scripts. Java-like syntax, single-quoted strings. */
export const APEX = Object.freeze({
  id: 'apex',
  name: 'Apex',
  extensions: Object.freeze(['.cls', '.trigger', '.apex']),
  // The Java lexer reads Apex: `//` and `/* */` comments, `'…'` strings.
  lexer: 'java',
  manifest: 'sfdx-project.json',
});

/** Visualforce markup: pages and components. Scanned for secrets only. */
export const VISUALFORCE = Object.freeze({
  id: 'visualforce',
  name: 'Visualforce',
  extensions: Object.freeze(['.page', '.component']),
});

export const APEX_EXTENSIONS = APEX.extensions;

const extOf = path => (String(path).match(/\.[^./\\]+$/) || [''])[0].toLowerCase();
const baseOf = path => String(path).replace(/\\/g, '/').split('/').pop();

/** Is this path an Apex source file, by extension? */
export function isApexPath(path) {
  return APEX.extensions.includes(extOf(path));
}

/**
 * An Apex test class by name: `OrderTotalTest.cls`, `OrderTotalTests.cls`,
 * `OrderTotal_Test.cls` or `Test_OrderTotal.cls`. A `.cls` named otherwise is a
 * test only when it declares `@isTest` (`declaresApexTest`).
 */
export const APEX_TEST_NAME = /(?:^|\/)(?:[^/]*(?:Test|Tests|_Test)|Test_[^/]+)\.cls$/;

export function isApexTestName(path) {
  return APEX_TEST_NAME.test(String(path).replace(/\\/g, '/'));
}

/** Does Apex source declare a test class or method (`@isTest`, any case)? */
export function declaresApexTest(content) {
  return /@isTest\b/i.test(String(content || ''));
}

/**
 * Salesforce metadata files are `<ApiName>.<type>-meta.xml` (`Widget__c.object-meta.xml`,
 * `Weight__c.field-meta.xml`, `WidgetService.cls-meta.xml`). The deliverable a task names is
 * the API name. Returns it, or null for any other file name.
 */
export function metadataApiName(fileName) {
  const m = /^(.+?)\.[A-Za-z][\w]*-meta\.xml$/.exec(baseOf(fileName));
  return m ? m[1] : null;
}

/** Is this a Salesforce metadata file (`*.<type>-meta.xml`)? */
export function isSalesforceMetadata(path) {
  return metadataApiName(path) !== null;
}
