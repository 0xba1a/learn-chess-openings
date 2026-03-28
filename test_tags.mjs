// test_tags.mjs — Playwright test for multi-tag functionality
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('http://localhost:9000/');
  await page.waitForTimeout(1000);

  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  PASS: ${msg}`);
      passed++;
    } else {
      console.log(`  FAIL: ${msg}`);
      failed++;
    }
  }

  // Test 1: DB migration — tags field in line records
  console.log('\n=== Test 1: DB Schema ===');
  const dbCheck = await page.evaluate(async () => {
    const { openDB, getAll, add, del } = await import('./js/db.js');
    await openDB();

    // Check that 'byTag' index exists on lines store
    const db = indexedDB.open('chess-opening-trainer');
    return new Promise((resolve) => {
      db.onsuccess = (e) => {
        const database = e.target.result;
        const tx = database.transaction('lines', 'readonly');
        const store = tx.objectStore('lines');
        const hasTagIndex = store.indexNames.contains('byTag');
        const hasOldIndex = store.indexNames.contains('byStudyTag');
        database.close();
        resolve({ hasTagIndex, hasOldIndex });
      };
    });
  });
  assert(dbCheck.hasTagIndex, 'byTag multiEntry index exists');
  assert(!dbCheck.hasOldIndex, 'byStudyTag index removed');

  // Test 2: addLine with tags array
  console.log('\n=== Test 2: addLine with tags ===');
  const lineTest = await page.evaluate(async () => {
    const dag = await import('./js/dag.js');
    const db = await import('./js/db.js');

    const lineId = await dag.addLine(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      ['e4', 'e5'],
      'white',
      ['Control center', 'Mirror'],
      ['Italian', 'Beginner']
    );

    const line = await db.get('lines', lineId);
    return {
      lineId,
      tags: line.tags,
      hasStudyTag: 'studyTag' in line,
    };
  });
  assert(Array.isArray(lineTest.tags), 'tags is an array');
  assert(lineTest.tags.length === 2, 'tags has 2 entries');
  assert(lineTest.tags.includes('Italian'), 'tags includes Italian');
  assert(lineTest.tags.includes('Beginner'), 'tags includes Beginner');
  assert(!lineTest.hasStudyTag, 'no studyTag field');

  // Test 3: addLine with single string (backward compat)
  console.log('\n=== Test 3: addLine with string tag (compat) ===');
  const compatTest = await page.evaluate(async () => {
    const dag = await import('./js/dag.js');
    const db = await import('./js/db.js');

    const lineId = await dag.addLine(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      ['d4', 'd5'],
      'white',
      ['Control center', 'Solid'],
      'London'
    );

    const line = await db.get('lines', lineId);
    return { tags: line.tags };
  });
  assert(Array.isArray(compatTest.tags), 'compat tags is an array');
  assert(compatTest.tags.length === 1, 'compat tags has 1 entry');
  assert(compatTest.tags[0] === 'London', 'compat tag is London');

  // Test 4: getDueLines filters by tag
  console.log('\n=== Test 4: getDueLines tag filter ===');
  const filterTest = await page.evaluate(async () => {
    const sm2 = await import('./js/sm2.js');

    const allDue = await sm2.getDueLines();
    const italianDue = await sm2.getDueLines(null, null, 'Italian');
    const londonDue = await sm2.getDueLines(null, null, 'London');
    const nonExistDue = await sm2.getDueLines(null, null, 'NonExistent');

    return {
      allCount: allDue.length,
      italianCount: italianDue.length,
      londonCount: londonDue.length,
      nonExistCount: nonExistDue.length,
    };
  });
  assert(filterTest.allCount >= 2, `all due lines >= 2 (got ${filterTest.allCount})`);
  assert(filterTest.italianCount >= 1, `Italian due >= 1 (got ${filterTest.italianCount})`);
  assert(filterTest.londonCount >= 1, `London due >= 1 (got ${filterTest.londonCount})`);
  assert(filterTest.nonExistCount === 0, 'NonExistent returns 0');

  // Test 5: Study page — tag chips UI present
  console.log('\n=== Test 5: Study page tag chips UI ===');
  await page.goto('http://localhost:9000/#/study');
  await page.waitForTimeout(500);
  const studyUI = await page.evaluate(() => {
    const chips = document.querySelector('#study-tag-chips');
    const input = document.querySelector('#study-tag-input');
    return { hasChips: !!chips, hasInput: !!input };
  });
  assert(studyUI.hasChips, 'Study page has tag chips container');
  assert(studyUI.hasInput, 'Study page has tag input');

  // Test 6: Browse page — tag section in detail panel
  console.log('\n=== Test 6: Browse page tag management ===');
  await page.goto('http://localhost:9000/#/browse');
  await page.waitForTimeout(1000);

  // Click on a node
  const hasNodes = await page.evaluate(() => {
    const nodes = document.querySelectorAll('.tree-pill');
    if (nodes.length > 0) {
      nodes[0].click();
      return true;
    }
    return false;
  });

  if (hasNodes) {
    await page.waitForTimeout(500);
    const browseUI = await page.evaluate(() => {
      const tagSection = document.querySelector('.detail-tag-section');
      const tagInput = document.querySelector('#detail-tag-input');
      const addBtn = document.querySelector('#btn-add-subtree-tag');
      return {
        hasTagSection: !!tagSection,
        hasTagInput: !!tagInput,
        hasAddBtn: !!addBtn,
      };
    });
    assert(browseUI.hasTagSection, 'Browse detail has tag section');
    assert(browseUI.hasTagInput, 'Browse detail has tag input');
    assert(browseUI.hasAddBtn, 'Browse detail has add tag button');
  } else {
    console.log('  SKIP: No tree nodes to click');
  }

  // Test 7: Practice page — tag filter dropdown
  console.log('\n=== Test 7: Practice page tag filter ===');
  await page.goto('http://localhost:9000/#/practice');
  await page.waitForTimeout(1000);
  const practiceUI = await page.evaluate(() => {
    const select = document.querySelector('#study-filter-select');
    const options = select ? [...select.options].map(o => o.textContent) : [];
    return { hasSelect: !!select, options };
  });
  assert(practiceUI.hasSelect, 'Practice page has tag filter dropdown');
  assert(practiceUI.options.includes('All Tags'), 'Filter has All Tags option');

  // Cleanup
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    await db.clearStore('lines');
    await db.clearStore('edges');
    await db.clearStore('nodes');
    await db.clearStore('names');
  });

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (errors.length) {
    console.log('\nPage errors:');
    errors.forEach(e => console.log(`  ${e}`));
  }
  console.log(`========================================\n`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
