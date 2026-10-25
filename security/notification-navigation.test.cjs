const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
test('notification clicks reuse running app; concurrent cold clicks open one window',async()=>{
 const handlers={},scope='https://parallel.test/parallel-app/';let windows=[],opened=0,focused=0,navigated=0;
 const client=url=>({url,postMessage(data){this.last=data;},async focus(){focused++;},async navigate(){navigated++;}});
 const self={registration:{scope},location:{origin:'https://parallel.test'},addEventListener:(t,f)=>handlers[t]=f,clients:{async matchAll(){return windows;},async openWindow(url){opened++;const c=client(url);windows.push(c);return c;}}};
 vm.runInNewContext(fs.readFileSync(ROOT+'/sw.js','utf8'),{self,URL,Promise});
 const tap=cid=>{let p;handlers.notificationclick({notification:{data:{conversationId:cid},close(){}},waitUntil(v){p=v;}});return p;};
 windows=[client(scope)];await tap('current');assert.equal(opened,0);assert.equal(focused,1);assert.equal(navigated,0);assert.equal(windows[0].last.conversationId,'current');
 windows=[];await Promise.all([tap('archive'),tap('archive')]);assert.equal(opened,1);assert.equal(new URL(windows[0].url).searchParams.get('conversation'),'archive');
});
test('browser opens current, archived and remote chats; deduplicates and preserves storage',async()=>{
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
 const origin='https://kitrayn-cyber.github.io',app=origin+'/parallel-app/',api='https://parallel-background.chloerayn.workers.dev';
 const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true});
 try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const original=[{from:'me',text:'Kept message',at:1,bgId:'one',bgCid:'current',bgSynced:true}],archive=[{from:'them',text:'Archived reply',at:2,bgId:'two',bgCid:'archive',bgSynced:true}];
 await context.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.origin===origin){const file=path.resolve(ROOT,u.pathname.replace('/parallel-app/','')||'index.html');assert.ok(file.startsWith(ROOT+'/'));if(!fs.existsSync(file))return route.fulfill({status:404,body:''});return route.fulfill({status:200,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)});}
 assert.equal(u.origin,api);let result={};
 if(u.pathname==='/api/session')result={token:'ps_FAKE_LOCAL_SESSION',expiresAt:Date.now()+3600000};
 else if(u.pathname==='/api/messages'){assert.equal(route.request().method(),'GET');result={messages:u.searchParams.get('conversationId')==='remote'?[{id:'remote_reply',seq:1,role:'model',text:'Stored reply',created_at:3}]:[],jobs:[]};}
 else assert.fail('Unexpected API request '+u.pathname);
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});});
 await context.addInitScript(({original,archive,api})=>{const listeners=[];window.__notify=data=>listeners.forEach(f=>f({data}));Object.defineProperty(navigator,'serviceWorker',{value:{addEventListener:(t,f)=>{if(t==='message')listeners.push(f);},ready:Promise.resolve({pushManager:{getSubscription:async()=>null}}),register:async()=>({})}});
 if(!localStorage.getItem('fixture')){localStorage.setItem('fixture','1');for(const [k,v]of Object.entries({'parallel-background-url-v1':api,'parallel-conversation-id-v1':'current','parallel-archive-conversation-id-v1':'archive','parallel-prototype-messages':JSON.stringify(original),'parallel-previous-conversation':JSON.stringify(archive),'parallel-gura-memory-v1':JSON.stringify(['Kept notebook']),'parallel-session-v2':JSON.stringify({token:'ps_FAKE_LOCAL_SESSION',expiresAt:Date.now()+3600000})}))localStorage.setItem(k,v);}}, {original,archive,api});
 await page.goto(app+'?conversation=current');await page.waitForFunction(()=>!document.querySelector('.os-chat').classList.contains('hidden'));await page.waitForFunction(()=>!document.getElementById('parallelLock'));assert.deepEqual(await page.evaluate(()=>messages),original);
 const open=async id=>{await page.evaluate(id=>window.__notify({type:'parallel-open-conversation',conversationId:id}),id);await page.waitForFunction(id=>localStorage.getItem('parallel-conversation-id-v1')===id,id);};
 await open('archive');assert.deepEqual(await page.evaluate(()=>messages),archive);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('parallel-previous-conversation'))),original);
 await open('remote');await open('remote');await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>messages.filter(m=>m.bgId==='remote_reply').length),1);
 await open('current');assert.deepEqual(await page.evaluate(()=>messages),original);
 await page.goto(app+'?conversation=archive');await page.waitForFunction(()=>localStorage.getItem('parallel-conversation-id-v1')==='archive');assert.equal(await page.locator('.os-chat').evaluate(e=>e.classList.contains('hidden')),false);
 await open('current');
 await page.evaluate(()=>{parallelSession=null;window.__notify({type:'parallel-open-conversation',conversationId:'remote'});});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>localStorage.getItem('parallel-conversation-id-v1')),'current');
 await page.evaluate(()=>{parallelSession='ps_FAKE_LOCAL_SESSION';window.dispatchEvent(new Event('online'));});await page.waitForFunction(()=>localStorage.getItem('parallel-conversation-id-v1')==='remote');
 await page.evaluate(()=>window.__notify({type:'parallel-open-conversation',conversationId:'https://untrusted.test/'}));await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>localStorage.getItem('parallel-conversation-id-v1')),'remote');
 await open('current');
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('parallel-gura-memory-v1'))),['Kept notebook']);assert.ok(await page.evaluate(()=>localStorage.getItem('parallel-session-v2')));assert.deepEqual(errors,[]);
 await context.close();
 }finally{await browser.close();}
});
