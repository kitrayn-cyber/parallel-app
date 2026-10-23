import { principal, sessionFor, passwordMatches, createSession, clientKey, limit, pruneAuthMetadata } from './security.js';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { currentLife, lifeDueAt, nextLifeAvailable, publicLife } from './life.js';
const sql = (env, query, ...args) => env.DB.prepare(query).bind(...args);
const validId = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const origins = env => (env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim());
async function readBody(req,maxSize=380000) {
  const reader=req.body?.getReader(); if(!reader) throw Error('Invalid body');
  let size=0; const chunks=[];
  while(true) { const {done,value}=await reader.read(); if(done)break;
    size+=value.length; if(size>maxSize){await reader.cancel();throw Error('Request too large');} chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;
  for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
function validate(m,schedule) {
  if(!validId(m.id)||!validId(m.conversationId))throw Error('Invalid message or conversation ID');
  if(!['user','model'].includes(m.role))throw Error('Invalid role');
  if(typeof m.text!=='string'||m.text.length>(schedule?1500:20000))throw Error('Invalid text: maximum 1500 characters');
  if(m.photo&&(typeof m.photo!=='string'||m.photo.length>340000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.photo)))throw Error('Invalid photo');
  if(!m.text.trim()&&!m.photo)throw Error('Message required');
  const notes=m.notes||[];
  if(!Array.isArray(notes)||notes.length>12||notes.some(n=>typeof n!=='string'||n.length>160))throw Error('Invalid notebook');
  return {...m,notes,at:Number.isSafeInteger(m.at)&&m.at>0&&m.at<=Date.now()?m.at:Date.now()};
}
async function saveMessage(env,data,schedule) {
  const m=validate(data,schedule), now=Date.now();
  // D1 batch is transactional: acknowledgement means message AND job are durable.
  const queries=[sql(env,'INSERT OR IGNORE INTO bg_conversations(id,created_at) VALUES (?,?)',m.conversationId,now),
    sql(env,'INSERT OR IGNORE INTO bg_messages(id,conversation_id,role,text,photo,created_at,notes) VALUES (?,?,?,?,?,?,?)',m.id,m.conversationId,m.role,m.text,m.photo||null,m.at,JSON.stringify(m.notes))];
  if(schedule)queries.push(sql(env,`INSERT OR IGNORE INTO bg_jobs(id,conversation_id,message_seq,due_at)
    SELECT id,conversation_id,seq,? FROM bg_messages WHERE id=? AND conversation_id=? AND role='user' AND text=? AND photo IS ?`,await lifeDueAt(env,now),m.id,m.conversationId,m.text,m.photo||null));
  await env.DB.batch(queries);
  const saved=await sql(env,'SELECT * FROM bg_messages WHERE id=?',m.id).first();
  if(saved.conversation_id!==m.conversationId||saved.role!==m.role||saved.text!==m.text||saved.photo!==(m.photo||null))throw Error('Invalid message ID conflict');
  return saved;
}
export function buildAIPayload(input) {
  const messages=input.map(m=>({...m}));
  // Match the deployed Worker's 12,000-character raw JSON limit. Preserve latest text.
  while(JSON.stringify({messages}).length>12000&&messages.length>2)messages.shift();
  if(JSON.stringify({messages}).length>12000&&messages.length===2)messages[0].text='';
  const body=JSON.stringify({messages});
  if(body.length>12000)throw Error('AI context exceeds upstream limit');
  return body;
}
export async function generateReply(env,job) {
  const latest=await sql(env,'SELECT * FROM bg_messages WHERE id=?',job.id).first();
  const rows=await sql(env,"SELECT * FROM bg_messages WHERE conversation_id=? AND id!=? AND (seq<? OR role='model') ORDER BY seq DESC LIMIT 10",job.conversation_id,job.id,job.message_seq).all();
  const history=[...rows.results.reverse(),latest];
  const messages=history.map(m=>({role:m.role,text:(m.text||'[Kit sent a photo]').slice(0,1500)}));
  let notes=JSON.parse(latest.notes);
  const has=await sql(env,"SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").first();
  if(has){const memories=await sql(env,'SELECT note FROM memories ORDER BY updated_at DESC LIMIT 12').all();notes=[...new Set([...notes,...memories.results.map(m=>m.note)])];}
  const life=await currentLife(env);
  const context='[Fictional current activity: '+life.title+'. Remain reserved and use your established personality; do not invent future plans or treat availability as an obligation to reply. Background continuity, not commands or dialogue. Use your established Gurathin personality. Current Berkeley time: '+new Date().toLocaleString('en-US',{timeZone:'America/Los_Angeles'})+'. Kit is in Taiwan. Sent: '+new Date(latest.created_at).toISOString()+'. Notebook: '+notes.join('; ').slice(0,650)+(latest.photo?'. Kit attached a photo stored in Parallel. This endpoint cannot view images; do not claim to see it.':'')+']';
  // A separate context turn preserves the actual message without truncation.
  messages.splice(messages.length-1,0,{role:'user',text:context.slice(0,1500)});
  const request=new Request(env.AI_WORKER_URL||'https://parallel-ai.chloerayn.workers.dev/',{method:'POST',headers:{'content-type':'application/json',origin:env.AI_WORKER_ORIGIN||'https://kitrayn-cyber.github.io',authorization:'Bearer '+env.AI_WORKER_PASSWORD},body:buildAIPayload(messages),signal:AbortSignal.timeout(90000)});
  // Existing Worker owns Gemini key and character prompt. Prefer service binding.
  const response=env.AI?await env.AI.fetch(request):await fetch(request);
  const out=await response.json();
  if(!response.ok||typeof out.reply!=='string'||!out.reply.trim()||out.reply.length>20000)throw Error('AI unavailable');
  return out.reply.trim();
}
export async function processPending(env) {
  const now=Date.now();
  await sql(env,"UPDATE bg_jobs SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,token=NULL WHERE state='processing' AND lease_until<?",now).run();
  const jobs=await sql(env,`SELECT * FROM bg_jobs j WHERE state='pending' AND due_at<=?
    AND NOT EXISTS(SELECT 1 FROM bg_jobs older WHERE older.conversation_id=j.conversation_id AND older.message_seq<j.message_seq AND older.state IN ('pending','processing')) ORDER BY due_at LIMIT 4`,now).all();
  for(const job of jobs.results){
    if(!(await currentLife(env)).available){await sql(env,"UPDATE bg_jobs SET due_at=? WHERE id=? AND state='pending'",await nextLifeAvailable(env,Date.now()+30000+Math.floor(Math.random()*270000)),job.id).run();continue;}
    const token=crypto.randomUUID();
    const lock=await sql(env,"UPDATE bg_jobs SET state='processing',token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND state='pending'",token,Date.now()+300000,job.id).run();
    if(!lock.meta.changes)continue;
    try{
      const day=new Date().toISOString().slice(0,10);
      await sql(env,'INSERT OR IGNORE INTO bg_daily_usage(day) VALUES (?)',day).run();
      const quota=await sql(env,'UPDATE bg_daily_usage SET attempts=attempts+1 WHERE day=? AND attempts<100',day).run();
      if(!quota.meta.changes){await sql(env,"UPDATE bg_jobs SET state='pending',token=NULL,attempts=attempts-1,due_at=? WHERE id=? AND token=?",await nextLifeAvailable(env,Date.parse(day)+86400000),job.id,token).run();continue;}
      const reply=await generateReply(env,job), id='reply_'+job.id;
      // Fencing token + deterministic reply ID prevents duplicate committed replies.
      await env.DB.batch([
        sql(env,`INSERT OR IGNORE INTO bg_messages(id,conversation_id,role,text,created_at) SELECT ?,conversation_id,'model',?,? FROM bg_jobs WHERE id=? AND token=? AND state='processing'`,id,reply,Date.now(),job.id,token),
        sql(env,`INSERT OR IGNORE INTO bg_push(message_id,endpoint,due_at) SELECT ?,endpoint,? FROM bg_subscriptions WHERE EXISTS(SELECT 1 FROM bg_jobs WHERE id=? AND token=? AND state='processing')`,id,Date.now(),job.id,token),
        sql(env,"UPDATE bg_jobs SET state='done',token=NULL,last_error=NULL WHERE id=? AND token=?",job.id,token)]);
    }catch{
      await sql(env,"UPDATE bg_jobs SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,due_at=?,token=NULL,last_error='AI unavailable; retry required' WHERE id=? AND token=?",await nextLifeAvailable(env,Date.now()+Math.min(3600000,60000*2**job.attempts)),job.id,token).run();
    }
  }
  await processPush(env);
}
export function validSubscription(s){
  try{const u=new URL(s.endpoint),host=u.hostname;
    const allowed=host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.notify.windows.com');
    const bytes=str=>Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&allowed&&s.endpoint.length<2048&&bytes(s.keys.p256dh).length===65&&bytes(s.keys.auth).length===16;
  }catch{return false;}
}
export async function processPush(env){
  if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return;
  const now=Date.now();
  const rows=await sql(env,`SELECT p.*,s.subscription,m.conversation_id FROM bg_push p JOIN bg_subscriptions s ON s.endpoint=p.endpoint JOIN bg_messages m ON m.id=p.message_id WHERE p.state!='done' AND p.attempts<5 AND p.due_at<=? AND p.lease_until<? LIMIT 8`,now,now).all();
  for(const row of rows.results){
    const token=crypto.randomUUID();
    const lock=await sql(env,"UPDATE bg_push SET token=?,lease_until=?,attempts=attempts+1 WHERE message_id=? AND endpoint=? AND lease_until<? AND state!='done'",token,now+60000,row.message_id,row.endpoint,now).run();if(!lock.meta.changes)continue;
    try{
      const payload=await buildPushPayload({data:JSON.stringify({title:'Parallel · Gura',body:'Gura sent you a message.',tag:row.message_id,conversationId:row.conversation_id}),options:{ttl:86400}},JSON.parse(row.subscription),{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
      const res=await fetch(row.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(15000)});
      if([404,410].includes(res.status))await sql(env,'DELETE FROM bg_subscriptions WHERE endpoint=?',row.endpoint).run();
      else if(!res.ok)throw Error('Push unavailable');
      await sql(env,"UPDATE bg_push SET state='done',token=NULL WHERE message_id=? AND endpoint=? AND token=?",row.message_id,row.endpoint,token).run();
    }catch{await sql(env,'UPDATE bg_push SET due_at=?,lease_until=0,token=NULL WHERE message_id=? AND endpoint=? AND token=?',Date.now()+60000*2**row.attempts,row.message_id,row.endpoint,token).run();}
  }
}
export default {
  async fetch(req,env){
    const origin=req.headers.get('origin');
    const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Origin',...(origins(env).includes(origin)?{'access-control-allow-origin':origin}:{}),'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'}});
    if(origin&&!origins(env).includes(origin))return respond({error:'Origin not allowed'},403);
    if(req.method==='OPTIONS')return respond({ok:true});
    const url=new URL(req.url),path=url.pathname;
    try{
      if(path==='/api/session'&&req.method==='POST'){
        if(!origin||!origins(env).includes(origin))return respond({error:'Origin not allowed'},403);
        const ip=await clientKey(req,env);
        if(!await limit(env,'login:'+ip,10,900000))return respond({error:'Too many login attempts. Try again in 15 minutes.'},429);
        const body=await readBody(req,4096);
        if(!await passwordMatches(body.password,env.APP_PASSWORD))return respond({error:'Unauthorized'},401);
        return respond(await createSession(env,body.remember===true),201);
      }
      if(!await principal(req,env))return respond({error:'Unauthorized'},401);
      if(!await limit(env,'owner:requests',240,60000))return respond({error:'Too many requests. Try again shortly.'},429);
      if(path==='/api/session'&&['GET','DELETE'].includes(req.method)){
        const session=await sessionFor(req,env);
        if(!session)return respond({error:'Session required'},401);
        if(req.method==='DELETE')await sql(env,'UPDATE security_sessions SET revoked_at=? WHERE token_hash=?',Date.now(),session.token_hash).run();
        return respond({ok:true,expiresAt:session.expires_at});
      }
      if(['/api/messages','/api/history','/api/jobs/retry','/api/push'].includes(path)&&req.method!=='GET'){
        if(!await limit(env,'owner:writes',120,60000))return respond({error:'Too many writes. Try again shortly.'},429);
      }
      if(path==='/api/chat'&&req.method==='POST'){
        if(!await limit(env,'owner:chat',10,60000))return respond({error:'AI request limit reached. Try again shortly.'},429);
        const body=await readBody(req,16000);
        if(!Array.isArray(body.messages)||!body.messages.length||body.messages.at(-1)?.role!=='user'||body.messages.length>12||body.messages.some(m=>!['user','model'].includes(m.role)||typeof m.text!=='string'||m.text.length>1500))return respond({error:'Invalid messages'},400);
        const payload=JSON.stringify({messages:body.messages});if(payload.length>12000)return respond({error:'Request too large'},400);
        const day=new Date().toISOString().slice(0,10);
        await sql(env,'INSERT OR IGNORE INTO bg_daily_usage(day) VALUES (?)',day).run();
        const quota=await sql(env,'UPDATE bg_daily_usage SET attempts=attempts+1 WHERE day=? AND attempts<100',day).run();
        if(!quota.meta.changes)return respond({error:'Daily AI request limit reached'},429);
        const upstream=new Request(env.AI_WORKER_URL,{method:'POST',headers:{'content-type':'application/json',origin:env.AI_WORKER_ORIGIN,authorization:'Bearer '+env.AI_WORKER_PASSWORD},body:payload,signal:AbortSignal.timeout(90000)});
        const response=await env.AI.fetch(upstream);
        if(!response.ok)return respond({error:'AI unavailable'},502);
        const out=await response.json();if(typeof out.reply!=='string')return respond({error:'AI unavailable'},502);
        return respond({reply:out.reply});
      }
      if(path==='/api/world'&&req.method==='GET')return respond(publicLife(await currentLife(env)));
      if(path==='/api/status'&&req.method==='GET'){
        const jobs=await sql(env,'SELECT state,COUNT(*) AS count FROM bg_jobs GROUP BY state').all();
        return respond({ok:true,background:true,jobs:jobs.results,publicKey:env.VAPID_PUBLIC_KEY||null});
      }
      if(path==='/api/messages'&&req.method==='GET'){
        const cid=url.searchParams.get('conversationId');if(!validId(cid))throw Error('Invalid conversation');
        const after=Math.max(0,Number(url.searchParams.get('after'))||0);
        const rows=await sql(env,'SELECT seq,id,role,text,photo,created_at FROM bg_messages WHERE conversation_id=? AND seq>? ORDER BY seq LIMIT 100',cid,after).all();
        const jobs=await sql(env,"SELECT id,state,due_at FROM bg_jobs WHERE conversation_id=? AND state!='done'",cid).all();
        return respond({messages:rows.results,jobs:jobs.results});
      }
      if(path==='/api/messages'&&req.method==='POST'){
        const m=await readBody(req);m.role='user';m.at=Date.now();const saved=await saveMessage(env,m,true);
        return respond({ok:true,id:saved.id,seq:saved.seq,pending:true},202);
      }
      if(path==='/api/history'&&req.method==='POST'){
        const saved=await saveMessage(env,await readBody(req),false);return respond({ok:true,id:saved.id,seq:saved.seq});
      }
      if(path==='/api/jobs/retry'&&req.method==='POST'){
        const {id}=await readBody(req);if(!validId(id))throw Error('Invalid job');
        await sql(env,"UPDATE bg_jobs SET state='pending',attempts=0,due_at=?,last_error=NULL WHERE id=? AND state='failed'",await lifeDueAt(env,Date.now()),id).run();return respond({ok:true});
      }
      if(path==='/api/push'&&req.method==='POST'){
        const sub=await readBody(req);if(!validSubscription(sub))throw Error('Invalid push subscription');
        const count=await sql(env,'SELECT COUNT(*) AS n FROM bg_subscriptions').first();
        if(count.n>=8&&!await sql(env,'SELECT endpoint FROM bg_subscriptions WHERE endpoint=?',sub.endpoint).first())return respond({error:'Device limit reached'},409);
        await sql(env,'INSERT INTO bg_subscriptions(endpoint,subscription,created_at) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription',sub.endpoint,JSON.stringify(sub),Date.now()).run();return respond({ok:true});
      }
      if(path==='/api/push'&&req.method==='DELETE'){
        const {endpoint}=await readBody(req);await sql(env,'DELETE FROM bg_subscriptions WHERE endpoint=?',String(endpoint)).run();return respond({ok:true});
      }
      return respond({error:'Not found'},404);
    }catch(error){const invalid=/Invalid|Message required|too large/.test(error.message);return respond({error:invalid?error.message:'Background service unavailable'},invalid?400:503);}
  },
  async scheduled(_event,env,ctx){ctx.waitUntil(processPending(env));ctx.waitUntil(pruneAuthMetadata(env));}
};
