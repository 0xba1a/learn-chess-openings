// test_practice_scandinavian.mjs — Playwright test: download Scandinavian Defence
// study and practice all lines to verify auto-play works without freezing.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const SERVER = 'http://localhost:9000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Collect errors
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  try {
    // -----------------------------------------------------------------------
    // Step 1: Open app and wait for DB to initialize
    // -----------------------------------------------------------------------
    console.log('Step 1: Opening app...');
    await page.goto(SERVER + '/index.html#/practice', {
      waitUntil: 'networkidle',
      timeout: 15_000,
    });
    await page.waitForTimeout(2000);

    // -----------------------------------------------------------------------
    // Step 2: Import Scandinavian Defence study data directly into IndexedDB
    // -----------------------------------------------------------------------
    console.log('Step 2: Importing Scandinavian Defence study...');
    const studyJson = readFileSync(
      'studies/scandinavian-defence-modern-variation/study.json',
      'utf-8'
    );
    const study = JSON.parse(studyJson);

    const importResult = await page.evaluate(async (studyData) => {
      const db = await import('./js/db.js');
      const { nodes, edges, lines, names } = studyData.data;
      let addedNodes = 0, addedEdges = 0, addedLines = 0;

      for (const node of nodes) {
        if ((await db.get('nodes', node.fen)) == null) {
          await db.put('nodes', node);
          addedNodes++;
        }
      }

      for (const edge of edges) {
        const existing = await db.getAllByIndex('edges', 'byParentMove', [
          edge.parentFen,
          edge.moveSan,
        ]);
        if (existing.length === 0) {
          const { id, ...edgeData } = edge;
          await db.add('edges', edgeData);
          addedEdges++;
        }
      }

      for (const line of lines) {
        const allLines = await db.getAll('lines');
        const dup = allLines.find(
          (l) =>
            l.rootFen === line.rootFen &&
            l.leafFen === line.leafFen &&
            l.color === line.color
        );
        if (dup == null) {
          const { id, ...lineData } = line;
          await db.add('lines', lineData);
          addedLines++;
        }
      }

      return { addedNodes, addedEdges, addedLines };
    }, study);

    console.log(
      `   Imported: ${importResult.addedNodes} nodes, ${importResult.addedEdges} edges, ${importResult.addedLines} lines`
    );

    if (importResult.addedLines === 0) {
      console.error('FAILED: No lines were imported!');
      await browser.close();
      process.exit(1);
    }

    // -----------------------------------------------------------------------
    // Step 3: Navigate to practice (hash change, not full reload)
    // -----------------------------------------------------------------------
    console.log('Step 3: Navigating to practice...');
    await page.evaluate(() => { window.location.hash = '#/manage'; });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.location.hash = '#/practice'; });
    await page.waitForSelector('#practice-board-container', { timeout: 10_000 });
    await page.waitForTimeout(2000);

    // -----------------------------------------------------------------------
    // Step 4: Practice all lines
    // -----------------------------------------------------------------------
    console.log('Step 4: Practicing all lines...');

    let linesCompleted = 0;
    let totalMoves = 0;
    const maxLines = 20;

    for (let lineNum = 1; lineNum <= maxLines; lineNum++) {
      // Check if practice session is active
      const state = await page.evaluate(async () => {
        const p = await import('./js/pages/practice.js');
        const s = p._getState();
        return {
          sessionActive: s.sessionActive,
          hasLine: s.currentLine != null,
          label: s.currentLine?.label || null,
          totalMoves: s.currentLine?.moves?.length || 0,
          userColor: s.userColor,
        };
      });

      // Check for completion overlays
      const done = await page.evaluate(() =>
        document.querySelector('.all-caught-up') != null ||
        document.querySelector('.session-summary-overlay') != null
      );
      if (done) {
        console.log('   All lines completed (overlay detected).');
        break;
      }

      if (!state.sessionActive || !state.hasLine) {
        await page.waitForTimeout(1000);
        const recheck = await page.evaluate(() =>
          document.querySelector('.all-caught-up') != null ||
          document.querySelector('.session-summary-overlay') != null
        );
        if (recheck) {
          console.log('   Session complete.');
          break;
        }
        console.log('   No active line, stopping.');
        break;
      }

      console.log(
        `   Line ${lineNum}: "${state.label}" (${state.totalMoves} moves, as ${state.userColor})`
      );

      // Drill through the line
      let lineMoves = 0;
      let lineStuck = false;

      for (let attempt = 0; attempt < 60; attempt++) {
        // Check if line is done
        const cur = await page.evaluate(async () => {
          const p = await import('./js/pages/practice.js');
          const s = p._getState();
          return {
            moveIndex: s.moveIndex,
            totalMoves: s.currentLine?.moves?.length || 0,
            sessionActive: s.sessionActive,
          };
        });

        if (!cur.sessionActive || cur.moveIndex >= cur.totalMoves) break;

        // Wait for user turn
        const ready = await page.evaluate(async () => {
          const p = await import('./js/pages/practice.js');
          return p._waitForUserTurn(5000);
        });

        if (!ready) {
          // Check for overlays
          const overlayDone = await page.evaluate(() =>
            document.querySelector('.line-result-overlay') != null ||
            document.querySelector('.session-summary-overlay') != null
          );
          if (overlayDone) break;

          console.error(`   STUCK: Timed out waiting for user turn`);
          const debugState = await page.evaluate(async () => {
            const p = await import('./js/pages/practice.js');
            const s = p._getState();
            return {
              moveIndex: s.moveIndex,
              status: document.querySelector('#practice-status')?.textContent,
            };
          });
          console.error('   State:', JSON.stringify(debugState));
          lineStuck = true;
          break;
        }

        // Get expected move and play it
        const moveInfo = await page.evaluate(async () => {
          const p = await import('./js/pages/practice.js');
          const s = p._getState();
          if (!s.currentLine || s.moveIndex >= s.currentLine.moves.length) return null;
          return { move: s.currentLine.moves[s.moveIndex], idx: s.moveIndex };
        });

        if (!moveInfo) break;

        const ok = await page.evaluate(async (san) => {
          const p = await import('./js/pages/practice.js');
          return p._simulateUserMove(san);
        }, moveInfo.move);

        if (!ok) {
          console.error(`   FAILED: _simulateUserMove("${moveInfo.move}") returned false`);
          lineStuck = true;
          break;
        }

        lineMoves++;
        totalMoves++;
      }

      if (lineStuck) {
        console.error('FAILED: Practice got stuck.');
        await browser.close();
        process.exit(1);
      }

      // Wait for line result overlay
      const resultShown = await page.evaluate(async () => {
        const p = await import('./js/pages/practice.js');
        return p._waitForLineComplete(10_000);
      });

      if (!resultShown) {
        console.error('   Line result overlay never appeared');
        await browser.close();
        process.exit(1);
      }

      linesCompleted++;
      console.log(`   ✓ Completed (${lineMoves} user moves)`);

      // Click "Next Line" if available
      const hasNext = await page.evaluate(
        () => document.querySelector('#btn-next-line') != null
      );
      if (hasNext) {
        await page.click('#btn-next-line');
        await page.waitForTimeout(500);
      } else {
        break;
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Report results
    // -----------------------------------------------------------------------
    console.log('\n--- RESULTS ---');
    console.log(`Lines completed: ${linesCompleted}`);
    console.log(`Total user moves played: ${totalMoves}`);

    if (pageErrors.length > 0) {
      console.log(`Page errors:`);
      pageErrors.forEach((e) => console.log(`  - ${e}`));
    }

    const success = linesCompleted > 0;

    if (success) {
      console.log(
        `\n✓ PASSED: ${linesCompleted} lines practiced successfully — no auto-play freezes.`
      );
    } else {
      console.log('\n✗ FAILED: No lines were completed.');
    }

    await browser.close();
    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error('TEST ERROR:', err.message);
    await browser.close();
    process.exit(1);
  }
})();
