'use strict';
/*
 * Real SiYuan E2E: verify the "message separate folder path" feature.
 *
 * Feature under test (added 2026-07): in 独立文件模式 (mergeMode=NONE), a WeChat/企微
 * message (title matching ^同步助手_\d{8}) is written into a DEDICATED folder
 * (settings.messageFolder) instead of the article folder (settings.folder). Empty
 * messageFolder falls back to folder (covered by jest; here we test the separation).
 *
 * Flow (mirrors run-sync-smoke.js discipline):
 *   1. SEED   one regular article + one WeChat message, both tagged with a unique
 *             runId so cleanup can find them.
 *   2. BOOT   a real headless SiYuan v3.6.5 kernel on a throwaway workspace+port.
 *   3. SYNC   drive the plugin's REAL SyncManager with mergeMode=NONE,
 *             folder = e2e-art-<runId>, messageFolder = e2e-msg-<runId>
 *             (both static so the assertion is date-independent).
 *   4. ASSERT via /api/query/sql that:
 *             - the message doc landed under /e2e-msg-<runId>/…
 *             - the article doc landed under /e2e-art-<runId>/…
 *             - NEITHER leaked into the other's folder.
 *   5. CLEAN  delete the seeded articles (by unique runId) and stop the kernel.
 *
 * Run:  node tests/real-siyuan/run-message-path-smoke.js
 * Env:  NOTEHELPER_API_KEY (default = shared test key), SIYUAN_PORT (default 6810),
 *       RUN_ID, KEEP=1 (keep workspace + kernel for inspection).
 */
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('./lib/omniserver-client');
const { startKernel } = require('./lib/kernel');
const { compileSyncModule } = require('./lib/compile-sync');
const { installPluginGlobals } = require('./lib/plugin-globals');

const API_KEY = process.env.NOTEHELPER_API_KEY || 'o56E7690LHHXd5zvCAqoPobIuqq4';
const OMNI_BASE = 'https://obsidian.notebooksyncer.com';
const ENDPOINT = `${OMNI_BASE}/api/graphql`;
const PORT = Number(process.env.SIYUAN_PORT || 6810);
const KEEP = process.env.KEEP === '1';
const RUN_ID = process.env.RUN_ID || crypto.randomBytes(4).toString('hex');
// A single token embedded in BOTH titles so cleanup finds both with one search.
const TOKEN = `QAMP${RUN_ID}`;
const ART_TITLE = `QA-MP-${RUN_ID}-art-${TOKEN}`;
const MSG_TITLE = `同步助手_20260324_${TOKEN}-msg`; // matches isWeChatMessage: ^同步助手_\d{8}
const ART_FOLDER = `e2e-art-${RUN_ID}`;
const MSG_FOLDER = `e2e-msg-${RUN_ID}`;
const LABEL = `qamp-${RUN_ID}`;
const WORKSPACE = path.resolve(__dirname, '.runs', `ws-mp-${RUN_ID}`);

const log = (...a) => console.log('[e2e-mp]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const g = installPluginGlobals();
  const client = createClient({ apiKey: API_KEY, base: OMNI_BASE });
  let kernel = null;
  let exitCode = 1;

  try {
    // 1. SEED — one regular article + one WeChat message.
    log(`seeding article "${ART_TITLE}" + message "${MSG_TITLE}"`);
    await client.createArticle({
      title: ART_TITLE,
      url: `https://example.com/${LABEL}/art`,
      author: 'e2e-bot',
      content: `# ${ART_TITLE}\n\nRegular article body ${LABEL}.`,
      siteName: 'e2e',
      wordsCount: 5,
      labels: [LABEL],
    });
    await client.createArticle({
      title: MSG_TITLE,
      url: `https://example.com/${LABEL}/msg`,
      author: 'e2e-bot',
      content: `WeChat message body ${LABEL}. https://example.com/link`,
      siteName: 'e2e',
      wordsCount: 5,
      labels: [LABEL],
    });
    await sleep(1500); // let the seed settle before searching

    // 2. BOOT
    log(`booting headless SiYuan kernel on :${PORT} (ws=${WORKSPACE})`);
    kernel = await startKernel({ port: PORT, workspace: WORKSPACE });
    g.kernel = kernel;
    log(`kernel up: ${kernel.base} (token ${kernel.token.slice(0, 6)}…)`);

    // 3a. target notebook
    const nb = await kernel.rest('/api/notebook/createNotebook', { name: `e2e-mp-${RUN_ID}` });
    const notebookId = nb.notebook.id;
    await kernel.rest('/api/notebook/openNotebook', { notebook: notebookId });
    log(`notebook created+opened: ${notebookId}`);

    // 3b. drive the REAL plugin sync with a SEPARATE message folder
    const { SyncManager, DEFAULT_SETTINGS, MergeMode, ImageMode } = await compileSyncModule();
    const syncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: API_KEY,
      endpoint: ENDPOINT,
      targetNotebook: notebookId,
      mergeMode: MergeMode.NONE,           // independent files → message uses messageFolder
      imageMode: ImageMode.DISABLED,
      folder: ART_FOLDER,                  // article destination (static, no date var)
      messageFolder: MSG_FOLDER,           // ★ feature under test: message destination
      messageFolderDateFormat: 'yyyy-MM-dd',
      filename: '{{{title}}}',
      syncAt,
      syncTimeOffset: 0,
      initialSyncCompleted: true,
      frequency: 0,
      refreshIndexAfterSync: true,
      customQuery: '',
      logLevel: process.env.SIYUAN_STUB_VERBOSE === '1' ? 'DEBUG' : 'WARN',
    };
    const fakePlugin = { saveSettings: async () => {} };
    const sm = new SyncManager(fakePlugin, settings);

    log(`running SyncManager.sync() — folder=${ART_FOLDER}, messageFolder=${MSG_FOLDER}`);
    const result = await sm.sync(false);
    log('sync result:', JSON.stringify(result));

    // 4. ASSERT — find both docs and check their hpaths.
    const safeToken = TOKEN.replace(/'/g, "''");
    const rows = await kernel.rest('/api/query/sql', {
      stmt: `SELECT id, type, content, hpath FROM blocks WHERE type='d' AND content LIKE '%${safeToken}%'`,
    });
    log(`SQL: ${rows.length} document(s) match token ${TOKEN}`);
    rows.forEach((d) => log(`   doc: "${d.content}"  @ ${d.hpath}`));
    log(`fetch stats: ${JSON.stringify(g.stats)}`);

    const msgDoc = rows.find((d) => d.content && d.content.startsWith('同步助手_'));
    const artDoc = rows.find((d) => d.content && d.content.includes('-art-'));

    const msgFolderSeg = `/${MSG_FOLDER}/`;
    const artFolderSeg = `/${ART_FOLDER}/`;

    const problems = [];
    if (result.success === false) problems.push(`sync.success=false errors=${JSON.stringify(result.errors)}`);
    if (!msgDoc) problems.push('WeChat message document was not created');
    if (!artDoc) problems.push('regular article document was not created');

    // Core feature: message → its OWN folder; article → article folder.
    if (msgDoc && !msgDoc.hpath.includes(msgFolderSeg)) {
      problems.push(`message doc NOT under messageFolder: hpath="${msgDoc.hpath}" (expected to contain "${msgFolderSeg}")`);
    }
    if (artDoc && !artDoc.hpath.includes(artFolderSeg)) {
      problems.push(`article doc NOT under folder: hpath="${artDoc.hpath}" (expected to contain "${artFolderSeg}")`);
    }
    // Negative: no cross-contamination between the two folders.
    if (msgDoc && msgDoc.hpath.includes(artFolderSeg)) {
      problems.push(`message doc leaked into ARTICLE folder: hpath="${msgDoc.hpath}"`);
    }
    if (artDoc && artDoc.hpath.includes(msgFolderSeg)) {
      problems.push(`article doc leaked into MESSAGE folder: hpath="${artDoc.hpath}"`);
    }

    if (problems.length) throw new Error('ASSERT FAILED:\n  - ' + problems.join('\n  - '));

    log('✅ PASS — message-separate-path verified against real SiYuan:');
    log(`         message "${msgDoc.content}" → ${msgDoc.hpath}`);
    log(`         article "${artDoc.content}" → ${artDoc.hpath}`);
    exitCode = 0;
  } finally {
    // 5. CLEANUP
    if (kernel && !KEEP) {
      try { await kernel.stop(); log('kernel stopped'); } catch (e) { log('kernel stop error:', e.message); }
    } else if (kernel && KEEP) {
      log(`KEEP=1 — kernel left at ${kernel.base} (pid ${kernel.pid}); stop with: kill -TERM ${kernel.pid}`);
    }
    try {
      const ids = await client.listIdsByText(TOKEN);
      for (const id of ids) {
        try { await client.deleteArticle(id); } catch (e) { log(`delete ${id} failed: ${e.message}`); }
      }
      log(`cleaned up ${ids.length} seeded article(s)`);
    } catch (e) {
      log('cleanup search/delete error:', e.message);
    }
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => { console.error('[e2e-mp] FATAL', err && err.stack ? err.stack : err); process.exit(1); });
