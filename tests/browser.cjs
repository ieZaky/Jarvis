const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const home = mkdtempSync(join(tmpdir(),'jarvis-ui-'));
  const server = spawn('python',['-u','jarvis.py','--no-browser'],{
    env:{...process.env,JARVIS_HOME:home,JARVIS_PORT:'0'},stdio:['ignore','pipe','pipe']
  });
  let browser, url, output = '';
  const errors = [];
  try {
    url = await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('Server launch timed out: '+output)),15000);
      server.stdout.on('data',chunk => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      server.on('error',reject);
      server.on('exit',code => { clearTimeout(timer); reject(new Error('Server exited: '+code)); });
      server.stderr.on('data',chunk => { output += chunk.toString(); });
    });
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(url);
    await page.getByText('Local server connected',{exact:true}).waitFor();
    assert.equal(await page.title(),'Jarvis · Personal assistant');
    assert.ok(!page.url().includes('token='));
    await page.locator('#prompt').fill('/calc 6*7');
    await page.locator('#send').click();
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    assert.match(await page.locator('#messages').innerText(),/42/);

    await page.locator('[data-tab="tasks"]').click();
    await page.locator('#task-title').fill('Run browser regression');
    await page.locator('#task-form button').click();
    await page.getByText('Run browser regression',{exact:true}).waitFor();
    await page.locator('#task-list button').click();
    await page.locator('#task-list .done').waitFor();

    await page.locator('[data-tab="memories"]').click();
    await page.locator('#memory-text').fill('<img src=x onerror=alert(1)>');
    await page.locator('#memory-form button').click();
    await page.locator('#memory-list .card').waitFor();
    assert.equal(await page.locator('#memory-list img').count(),0);
    assert.match(await page.locator('#memory-list').innerText(),/<img/);

    await page.locator('[data-tab="chat"]').click();
    await page.locator('#prompt').fill('/open https://example.com');
    await page.locator('#send').click();
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    await page.locator('[data-tab="activity"]').click();
    await page.getByRole('button',{name:'Decline',exact:true}).click();
    await page.getByText('OPEN URL · rejected',{exact:true}).waitFor();
    await page.reload();
    await page.getByText('Local server connected',{exact:true}).waitFor();
    assert.match(await page.locator('#messages').innerText(),/42/);

    mkdirSync('test-results',{recursive:true});
    await page.screenshot({path:'test-results/jarvis-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'test-results/jarvis-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('Browser workflows passed: chat, tasks, escaping, actions, persistence, responsive layout.');
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise(resolve => {
      if (server.exitCode !== null || server.signalCode !== null) resolve();
      else server.once('exit',resolve);
    });
    rmSync(home,{recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
