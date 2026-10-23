import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
test('compiled Worker runs with real local D1 and idempotent writes',async()=>{
  const mf=new Miniflare({modules:true,scriptPath:new URL('../dist/worker.js',import.meta.url).pathname,compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_PASSWORD:'local-test',ALLOWED_ORIGINS:'https://parallel.test'},serviceBindings:{AI:async()=>Response.json({reply:'mock reply'})}});
  try{
    const db=await mf.getD1Database('DB');
    for(const file of ['0001_background.sql','0002_security.sql'])for(const statement of readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').split(';').filter(s=>s.trim()))await db.prepare(statement).run();
    const post=()=>mf.dispatchFetch('https://local.test/api/messages',{method:'POST',headers:{authorization:'Bearer local-test',origin:'https://parallel.test','content-type':'application/json'},body:JSON.stringify({id:'runtime-message',conversationId:'runtime-chat',text:'Hello'})});
    assert.equal((await post()).status,202);assert.equal((await post()).status,202);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM bg_jobs').first()).n,1);
    assert.equal((await mf.dispatchFetch('https://local.test/api/status')).status,401);
    const response=await mf.dispatchFetch('https://local.test/api/messages?conversationId=runtime-chat',{headers:{authorization:'Bearer local-test',origin:'https://parallel.test'}});
    assert.equal((await response.json()).messages.length,1);
    const loggedIn=await mf.dispatchFetch('https://local.test/api/session',{method:'POST',headers:{origin:'https://parallel.test','content-type':'application/json'},body:JSON.stringify({password:'local-test',remember:true})});
    assert.equal(loggedIn.status,201);const session=await loggedIn.json();
    const headers={origin:'https://parallel.test',authorization:'Bearer '+session.token};
    assert.equal((await mf.dispatchFetch('https://local.test/api/status',{headers})).status,200);
    assert.equal((await mf.dispatchFetch('https://local.test/api/session',{method:'DELETE',headers})).status,200);
    assert.equal((await mf.dispatchFetch('https://local.test/api/status',{headers})).status,401);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM bg_jobs').first()).n,1);
  }finally{await mf.dispose();}
});
