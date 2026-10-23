// Optional local test: see VALIDATION.md. All Worker responses are mocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true});
 const page=await browser.newPage();const errors=[],calls=[],stored=[];let revoked=false;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin==='http://127.0.0.1:8767')return route.continue();
  assert.equal(url.origin,'https://parallel-background.chloerayn.workers.dev');calls.push({path:url.pathname,method:req.method()});
  let body={ok:true},status=200;
  if(req.method()==='OPTIONS')status=204;
  else if(url.pathname==='/api/session'&&req.method()==='POST'){const d=req.postDataJSON();assert.equal(d.password,'FAKE_TEST_PASSWORD');body={token:'ps_'+'a'.repeat(43),expiresAt:Date.now()+86400000};status=201;}
  else{assert.equal(req.headers()['authorization'],'Bearer ps_'+'a'.repeat(43));
   if(url.pathname==='/api/session'&&req.method()==='DELETE')revoked=true;
   else if(url.pathname==='/api/status')body={background:true,publicKey:null};
   else if(url.pathname==='/api/chat')body={reply:'Mock foreground reply'};
   else if(req.method()==='POST'){const d=req.postDataJSON();if(!stored.some(m=>m.id===d.id))stored.push({...d,seq:stored.length+1,created_at:d.at||Date.now()});}
   else body={messages:stored.filter(m=>m.conversationId===url.searchParams.get('conversationId')&&m.seq>Number(url.searchParams.get('after'))),jobs:[]};
  }
  await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'http://127.0.0.1:8767','access-control-allow-methods':'GET,POST,DELETE,OPTIONS','access-control-allow-headers':'authorization,content-type'},body:status===204?'':JSON.stringify(body)});
 });
 await page.addInitScript(()=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('parallel-remembered-login-v1','OLD_FAKE_PASSWORD');localStorage.setItem('parallel-prototype-messages',JSON.stringify([{from:'me',text:'Existing conversation',at:1}]));localStorage.setItem('parallel-gura-memory-v1',JSON.stringify(['Existing memory']));sessionStorage.setItem('seeded','yes');}});
 await page.goto('http://127.0.0.1:8767');
 assert.equal(await page.evaluate(()=>localStorage.getItem('parallel-remembered-login-v1')),null);
 await page.fill('#unlockPassword','FAKE_TEST_PASSWORD');await page.check('#rememberMe');await page.click('#unlockButton');await page.locator('#parallelLock').waitFor({state:'detached'});
 assert.ok(!(await page.evaluate(()=>localStorage.getItem('parallel-session-v2'))).includes('PASSWORD'));
 await page.evaluate(()=>aiReply());assert.ok(await page.evaluate(()=>messages.some(m=>m.text==='Mock foreground reply')));
 const before=calls.length;await page.evaluate(()=>{document.getElementById('bgUrl').value='https://evil.test';document.getElementById('bgConnect').click();});await page.waitForTimeout(100);assert.equal(calls.length,before);
 await page.evaluate(()=>{document.getElementById('bgUrl').value=SESSION_API;document.getElementById('bgConnect').click();});await page.waitForTimeout(400);assert.ok(stored.some(m=>m.text==='Existing conversation'));
 // Remembered login is rechecked on reopen; chats remain.
 await page.reload();await page.locator('#parallelLock').waitFor({state:'detached'});assert.ok(await page.evaluate(()=>messages.some(m=>m.text==='Existing conversation')));
 await page.evaluate(()=>document.querySelector('.forget-device').click());await page.waitForTimeout(500);assert.ok(revoked);assert.equal(await page.evaluate(()=>localStorage.getItem('parallel-session-v2')),null);assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('parallel-prototype-messages')).some(m=>m.text==='Existing conversation')));
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('parallel-gura-memory-v1'))),['Existing memory']);
 assert.deepEqual(errors,[]);console.log('PASS: browser credential migration, session login/reopen/logout, foreground proxy, pinned background sync, CSP and conversation preservation (all network calls mocked).');await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
