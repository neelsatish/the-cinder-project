import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWorkspace, migrateNotes, textToHtml, workspaceStorageKey } from '../apps/forge/src/forgeData.ts';
const legacy = { id:'legacy-one', title:'Lesson', body:'<script>alert(1)</script>\r\nA & B', topic:'Science', createdAt:'2026-09-05T00:00:00Z' };
test('legacy text stays text, including hostile tags and line endings', () => {
  assert.equal(textToHtml(legacy.body), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>A &amp; B</p>');
});
test('migration preserves IDs, original records, and drops retired capture widget', () => {
  const result=decodeWorkspace(JSON.stringify({ version:1, notes:[legacy], widgets:['capture','studio'] }));
  assert.equal(result.studioNotes[0].id,legacy.id);
  assert.deepEqual(result.notes,[legacy]);
  assert.deepEqual(result.widgets,['studio']);
  assert.equal(result.studioNotes[0].bodyHtml,textToHtml(legacy.body));
  assert.deepEqual(decodeWorkspace(JSON.stringify(result)).studioNotes,result.studioNotes);
});
test('duplicates cannot create duplicate migrated notes; edited and deleted documents win', () => {
  const once=migrateNotes([legacy,legacy],[]);
  assert.equal(once.length,1);
  const updated={...once[0],bodyHtml:'<p>Edited</p>',deletedAt:'2026-09-05'};
  assert.deepEqual(migrateNotes([legacy],[updated]),[updated]);
});
test('malformed or future storage is rejected instead of silently replaced', () => {
  for (const raw of ['{','null','[]','{"version":2}','{"studioNotes":[null]}','{"notes":[{"id":"x","body":3}]}']) assert.throws(()=>decodeWorkspace(raw), /preserved/);
  assert.equal(decodeWorkspace(null).studioNotes.length,0);
});
test('the retired focus widget becomes the plain timer once', () => {
  const result=decodeWorkspace(JSON.stringify({version:1,widgets:['focus','timer','activity']}));
  assert.deepEqual(result.widgets,['timer','activity']);
});
test('student workspaces use separate storage keys', () => {
  assert.notEqual(workspaceStorageKey('student-a'), workspaceStorageKey('student-b'));
});
