import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import worker, { processPending, validSubscription } from '../src/worker.js';
import { available, dueAt } from '../src/schedule.js';
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const migration=readFileSync(new URL('../migrations/0001_background.sql',import.meta.url),'utf8');
function setup(){
  const db=new DatabaseSync(':memory:'); db.exec(migration);
  const DB={prepare(query){return {bind(...args){return {async all(){return {results:db.prepare(query).all(...args)};},async first(){return db.prepare(query).get(...args)||null;},async run(){const r=db.prepare(query).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}};},
    async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
  let calls=0;
  const env={DB,APP_PASSWORD:'test-only',ALLOWED_ORIGINS:'https://parallel.test',AI_WORKER_PASSWORD:'upstream-test',AI:{async fetch(req){calls++; const data=await req.json();assert.ok(data.messages.at(-1).text);return Response.json({reply:'Established character response'});}}};
  const request=(path,data,method,token='test-only',origin='https://parallel.test')=>worker.fetch(new Request('https://worker.test'+path,{method:method||(data?'POST':'GET'),headers:{authorization:'Bearer '+token,origin,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env);
  return {db,env,request,calls:()=>calls};
}
const msg=(id='one',conversationId='chat')=>({id,conversationId,text:'Hello Gura',notes:['Kit likes tea']});
async function eligible(fn){const original=Date.now;Date.now=()=>Date.parse('2026-10-24T20:00:00Z');try{await fn();}finally{Date.now=original;}}
test('Berkeley schedule and artificial delay bounds, including DST',()=>{
  assert.equal(available(Date.parse('2026-10-23T16:00:00Z')),false);
  assert.equal(available(Date.parse('2026-10-24T20:00:00Z')),true);
  assert.equal(available(Date.parse('2026-11-02T15:00:00Z')),true);
  const now=Date.parse('2026-10-24T14:00:00Z');
  assert.equal(dueAt(now,()=>0)-now,30000);
  assert.ok(dueAt(now,()=>0.999999)-now<=10800000);
  assert.ok(dueAt(Date.parse('2026-10-24T07:00:00Z'),()=>0)>Date.parse('2026-10-24T10:00:00Z'));
});
test('authentication, CORS and malformed input reject writes',async()=>{
  const {db,request}=setup();
  assert.equal((await request('/api/messages',msg(),undefined,'wrong')).status,401);
  assert.equal((await request('/api/messages',msg(),undefined,'test-only','https://evil.test')).status,403);
  assert.equal((await request('/api/messages',{...msg(),text:'x'.repeat(1501)})).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bg_messages').get().n,0);
});
test('message retries are idempotent; history import never schedules; conversations isolated',async()=>{
  const {db,request}=setup();
  assert.equal((await request('/api/messages',msg())).status,202);
  assert.equal((await request('/api/messages',msg())).status,202);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bg_messages').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bg_jobs').get().n,1);
  await request('/api/history',{...msg('old','other'),role:'model',at:1});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bg_jobs').get().n,1);
  const data=await (await request('/api/messages?conversationId=chat')).json();assert.equal(data.messages.length,1);
  assert.equal((await request('/api/messages',{...msg(),text:'Changed'})).status,400);
});
test('server generates and stores one reply without a browser, concurrent cron is fenced',async()=>{
  const {db,env,request,calls}=setup();await request('/api/messages',msg());
  db.exec('UPDATE bg_jobs SET due_at=0');
  await eligible(async()=>{await Promise.all([processPending(env),processPending(env)]);await processPending(env);});
  assert.equal(calls(),1);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bg_messages WHERE role='model'").get().n,1);
  assert.equal(db.prepare('SELECT state FROM bg_jobs').get().state,'done');
});
test('expired leases recover and permanent AI failures stop after five attempts',async()=>{
  const {db,env,request}=setup();await request('/api/messages',msg());
  db.exec("UPDATE bg_jobs SET due_at=0,state='processing',lease_until=0,token='crashed'");
  await eligible(()=>processPending(env));assert.equal(db.prepare('SELECT state FROM bg_jobs').get().state,'done');
  await request('/api/messages',msg('failure'));env.AI.fetch=async()=>{throw Error('provider secret must not leak');};
  await eligible(async()=>{for(let n=0;n<5;n++){db.exec("UPDATE bg_jobs SET due_at=0 WHERE id='failure'");await processPending(env);}});
  assert.equal(db.prepare("SELECT state FROM bg_jobs WHERE id='failure'").get().state,'failed');
  const data=await (await request('/api/messages?conversationId=chat')).json();assert.ok(!JSON.stringify(data).includes('provider secret'));
  await request('/api/jobs/retry',{id:'failure'});assert.equal(db.prepare("SELECT state FROM bg_jobs WHERE id='failure'").get().state,'pending');
});
test('push endpoint validation prevents arbitrary fetch targets',()=>{
  const sub={endpoint:'https://web.push.apple.com/Q/test',keys:{p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
  assert.equal(validSubscription(sub),true);
  assert.equal(validSubscription({...sub,endpoint:'https://localhost/private'}),false);
  assert.equal(validSubscription({...sub,endpoint:'https://web.push.apple.com.evil.test/private'}),false);
  assert.equal(validSubscription({...sub,keys:{...sub.keys,auth:'bad'}}),false);
});
test('additive migration preserves pre-existing conversations and memory',()=>{
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../../database/schema.sql',import.meta.url),'utf8'));
  db.exec("INSERT INTO memories(id,note) VALUES ('memory','Do not erase'); INSERT INTO conversations(id) VALUES ('existing');");
  db.exec(migration);db.exec(migration);
  assert.equal(db.prepare('SELECT note FROM memories').get().note,'Do not erase');assert.equal(db.prepare('SELECT id FROM conversations').get().id,'existing');
});
test('push is encrypted, persisted before send, and retried independently',async()=>{
  const {db,env,request}=setup();
  const vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  env.VAPID_PUBLIC_KEY=Buffer.from(await crypto.subtle.exportKey('raw',vapid.publicKey)).toString('base64url');
  env.VAPID_PRIVATE_KEY=(await crypto.subtle.exportKey('jwk',vapid.privateKey)).d;env.VAPID_SUBJECT='mailto:local@example.test';
  const client=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const sub={endpoint:'https://web.push.apple.com/test',keys:{p256dh:Buffer.from(await crypto.subtle.exportKey('raw',client.publicKey)).toString('base64url'),auth:Buffer.alloc(16,7).toString('base64url')}};
  assert.equal((await request('/api/push',sub)).status,200);
  await request('/api/messages',msg());db.exec('UPDATE bg_jobs SET due_at=0');
  const original=globalThis.fetch;let sends=0;
  globalThis.fetch=async(url,options)=>{sends++;assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bg_messages WHERE role='model'").get().n,1);assert.ok(options.body.byteLength>0);assert.ok(!Buffer.from(options.body).toString().includes('Gura sent you'));return new Response('',{status:sends===1?503:201});};
  try{
    await eligible(()=>processPending(env));assert.equal(db.prepare('SELECT state FROM bg_push').get().state,'pending');
    db.exec('UPDATE bg_push SET due_at=0');await eligible(()=>processPending(env));
    assert.equal(db.prepare('SELECT state FROM bg_push').get().state,'done');assert.equal(sends,2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bg_messages WHERE role='model'").get().n,1);
  }finally{globalThis.fetch=original;}
});
