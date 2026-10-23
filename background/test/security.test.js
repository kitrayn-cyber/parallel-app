import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker,{processPending} from '../src/worker.js';
import {pruneAuthMetadata} from '../src/security.js';
function setup(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_background.sql','0002_security.sql','0003_life.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const DB={prepare(q){return {bind(...a){return {async first(){return db.prepare(q).get(...a)||null;},async all(){return {results:db.prepare(q).all(...a)};},async run(){const r=db.prepare(q).run(...a);return {meta:{changes:Number(r.changes)}};}};}};},async batch(queries){db.exec('BEGIN');try{const out=[];for(const q of queries)out.push(await q.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
 let upstream=0;
 const env={DB,APP_PASSWORD:'fixture-password',ENABLE_LEGACY_PASSWORD_AUTH:'false',ALLOWED_ORIGINS:'https://parallel.test',AI_WORKER_URL:'https://ai.test/',AI_WORKER_ORIGIN:'https://parallel.test',AI_WORKER_PASSWORD:'fixture-upstream',AI:{async fetch(req){upstream++;assert.equal(req.headers.get('Authorization'),'Bearer fixture-upstream');return Response.json({reply:'Preserved character'});}}};
 const request=(path,{method,data,token,ip='192.0.2.1',origin='https://parallel.test'}={})=>worker.fetch(new Request('https://worker.test'+path,{method:method||(data?'POST':'GET'),headers:{Origin:origin,'CF-Connecting-IP':ip,...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env);
 const login=async(remember=false)=>{const res=await request('/api/session',{data:{password:'fixture-password',remember}});assert.equal(res.status,201);return res.json();};
 return {db,env,request,login,upstream:()=>upstream};
}
test('sessions are random, hashed, bounded, revocable and do not call Gemini at login',async()=>{
 const {db,request,login,upstream}=setup(),before=Date.now();
 const first=await login(),second=await login(true);assert.notEqual(first.token,second.token);
 assert.match(first.token,/^ps_[A-Za-z0-9_-]{43}$/);assert.ok(first.expiresAt<=Date.now()+12*3600000);assert.ok(second.expiresAt>=before+14*86400000);
 const rows=db.prepare('SELECT * FROM security_sessions').all();assert.equal(rows.length,2);assert.ok(!JSON.stringify(rows).includes(first.token));assert.ok(!JSON.stringify(rows).includes('fixture-password'));assert.equal(upstream(),0);
 assert.equal((await request('/api/status',{token:first.token})).status,200);assert.equal((await request('/api/status',{token:'fixture-password'})).status,401);
 assert.equal((await request('/api/session',{method:'DELETE',token:first.token})).status,200);assert.equal((await request('/api/status',{token:first.token})).status,401);assert.equal((await request('/api/status',{token:second.token})).status,200);
 db.exec('UPDATE security_sessions SET expires_at=0');assert.equal((await request('/api/status',{token:second.token})).status,401);
});
test('persistent atomic login limit does not disclose raw IPs or call Gemini',async()=>{
 const {db,request,upstream}=setup();
 const responses=await Promise.all(Array.from({length:11},()=>request('/api/session',{data:{password:'wrong'}})));
 assert.equal(responses.filter(r=>r.status===401).length,10);assert.equal(responses.filter(r=>r.status===429).length,1);assert.equal(upstream(),0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM security_sessions').get().n,0);assert.ok(!JSON.stringify(db.prepare('SELECT * FROM security_rate_limits').all()).includes('192.0.2.1'));
 assert.equal((await request('/api/session',{data:{password:'fixture-password'},origin:'https://evil.test',ip:'192.0.2.2'})).status,403);
});
test('foreground proxy uses sessions and shares the scheduled Gemini spending cap',async()=>{
 const {db,request,login,upstream}=setup();const {token}=await login();
 assert.equal((await request('/api/chat',{data:{messages:[{role:'user',text:'Hello'}]},token})).status,200);assert.equal(upstream(),1);
 db.prepare('UPDATE bg_daily_usage SET attempts=100').run();assert.equal((await request('/api/chat',{data:{messages:[{role:'user',text:'Hello'}]},token})).status,429);assert.equal(upstream(),1);
 assert.equal((await request('/api/chat',{data:{messages:[]},token:'wrong'})).status,401);
});
test('migration and session revocation preserve old data, pending jobs and notification subscriptions',async()=>{
 const {db,env,request,login}=setup();db.exec(readFileSync(new URL('../../database/schema.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO conversations(id) VALUES ('old');INSERT INTO messages(id,conversation_id,sender,body) VALUES ('old-message','old','kit','keep');INSERT INTO memories(id,note) VALUES ('memory','keep');");
 const {token}=await login();await request('/api/messages',{token,data:{id:'queued',conversationId:'active',text:'Keep scheduled message'}});
 db.prepare('INSERT INTO bg_subscriptions VALUES (?,?,?)').run('https://web.push.apple.com/preserve','{"preserve":true}',1);db.prepare('INSERT INTO bg_push(message_id,endpoint,due_at) VALUES (?,?,?)').run('queued','https://web.push.apple.com/preserve',1);
 const tables=['conversations','messages','memories','bg_conversations','bg_messages','bg_jobs','bg_subscriptions','bg_push'];const snapshot=()=>tables.map(t=>db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all());const before=snapshot();
 db.exec(readFileSync(new URL('../migrations/0002_security.sql',import.meta.url),'utf8'));await request('/api/session',{method:'DELETE',token});assert.deepEqual(snapshot(),before);
 db.prepare('INSERT INTO security_rate_limits VALUES (?,?,?)').run('expired-fixture',0,1);db.prepare('INSERT INTO security_sessions(token_hash,created_at,expires_at) VALUES (?,?,?)').run('expired-fixture',0,0);await pruneAuthMetadata(env);assert.deepEqual(snapshot(),before);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM security_sessions WHERE token_hash='expired-fixture'").get().n,0);
 db.exec('UPDATE bg_jobs SET due_at=0');const now=Date.now;Date.now=()=>Date.parse('2026-10-24T20:00:00Z');try{await processPending(env);}finally{Date.now=now;}assert.equal(db.prepare("SELECT state FROM bg_jobs WHERE id='queued'").get().state,'done');
});
test('browser credential migration touches only credential keys and pins the destination',()=>{
 const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8'),client=readFileSync(new URL('../../background-client.js',import.meta.url),'utf8');
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.ok(html.includes("'sha256-"+createHash('sha256').update(script[1]).digest('base64')+"'"));
 assert.ok(!html.includes('localStorage.setItem(REMEMBER_KEY,pass)'));assert.ok(!html.includes('parallelPassword'));assert.ok(html.includes('localStorage.removeItem(REMEMBER_KEY)'));assert.ok(html.includes("SESSION_API+'/api/chat'"));assert.ok(client.includes('url.origin!==SESSION_API'));assert.ok(!html.includes('localStorage.clear('));
});
