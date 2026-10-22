// Parallel background message service: separate from the existing AI Worker.
// Requires D1 DB, APP_PASSWORD, AI_WORKER_URL and AI_WORKER_PASSWORD secrets.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,POST,OPTIONS"}});
function berkeley(at=new Date()){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(at);const x=k=>p.find(y=>y.type===k)?.value;return {minutes:Number(x('hour'))*60+Number(x('minute')),weekday:x('weekday')}}
function available(at=new Date()){const {minutes:t,weekday:d}=berkeley(at);if(t<390||t>=1350)return false;if(d==='Sat'||d==='Sun')return true;return(t>=390&&t<480)||(t>=720&&t<780)||(t>=1140&&t<1350)}
function nextAvailable(ms){for(let i=0;i<=2880;i++){const t=ms+i*60000;if(available(new Date(t)))return t}return ms+86400000}
function delay(){return 30000+Math.floor(Math.random()*330000)}
async function authorize(request,env){const supplied=(request.headers.get('authorization')||'').replace(/^Bearer /i,'');return !!env.APP_PASSWORD&&supplied===env.APP_PASSWORD}
async function processPending(env){const now=Date.now();const rows=await env.DB.prepare("SELECT id FROM outgoing_jobs WHERE state='pending' AND due_at<=? ORDER BY due_at LIMIT 8").bind(now).all();for(const item of rows.results||[]){const job=await env.DB.prepare("SELECT * FROM outgoing_jobs WHERE id=?").bind(item.id).first();if(!job||job.state!=='pending')continue;if(!available()){await env.DB.prepare("UPDATE outgoing_jobs SET due_at=? WHERE id=?").bind(nextAvailable(now+60000),job.id).run();continue}
 const lock=await env.DB.prepare("UPDATE outgoing_jobs SET state='processing' WHERE id=? AND state='pending'").bind(job.id).run();if(!lock.meta?.changes)continue;
 try{const context=await env.DB.prepare("SELECT role,text FROM chat_messages WHERE id<=? ORDER BY id DESC LIMIT 12").bind(job.last_message_id).all();const messages=(context.results||[]).reverse().map(x=>({role:x.role==='user'?'user':'model',text:x.text}));
 const response=await fetch(env.AI_WORKER_URL,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+env.AI_WORKER_PASSWORD},body:JSON.stringify({messages})});
 const out=await response.json();if(!response.ok||typeof out.reply!=='string'||!out.reply.trim())throw Error('AI request unsuccessful');
 await env.DB.prepare("INSERT INTO chat_messages (role,text,created_at) VALUES ('model',?,?)").bind(out.reply.trim(),Date.now()).run();
 await env.DB.prepare("UPDATE outgoing_jobs SET state='done' WHERE id=?").bind(job.id).run();
 }catch(e){await env.DB.prepare("UPDATE outgoing_jobs SET state='pending',due_at=?,attempts=attempts+1 WHERE id=?").bind(Date.now()+15*60000,job.id).run();}}
}
export default {
 async fetch(request,env){if(request.method==='OPTIONS')return json({ok:true});if(!await authorize(request,env))return json({error:'Unauthorized'},401);const path=new URL(request.url).pathname;
 if(path==='/api/messages'&&request.method==='GET'){const after=Math.max(0,Number(new URL(request.url).searchParams.get('after'))||0);const rows=await env.DB.prepare('SELECT id,role,text,created_at FROM chat_messages WHERE id>? ORDER BY id ASC LIMIT 100').bind(after).all();return json({messages:rows.results||[]})}
 if(path==='/api/messages'&&request.method==='POST'){let data;try{data=await request.json()}catch{return json({error:'Invalid JSON'},400)}const body=String(data?.text||'').trim();if(!body||body.length>1500)return json({error:'Text must be 1–1500 characters'},400);
 const inserted=await env.DB.prepare("INSERT INTO chat_messages (role,text,created_at) VALUES ('user',?,?)").bind(body,Date.now()).run();
 const id=inserted.meta.last_row_id;const pending=await env.DB.prepare("SELECT id FROM outgoing_jobs WHERE state IN ('pending','processing') LIMIT 1").first();
 if(!pending){const due=nextAvailable(Date.now()+delay());await env.DB.prepare("INSERT INTO outgoing_jobs (last_message_id,due_at,state) VALUES (?,?,'pending')").bind(id,due).run()}
 else await env.DB.prepare("UPDATE outgoing_jobs SET last_message_id=? WHERE id=? AND state='pending'").bind(id,pending.id).run();
 return json({ok:true,id,pending:true},202)}
 if(path==='/api/status')return json({ok:true,background:true});
 return json({error:'Not found'},404)},
 async scheduled(_event,env,ctx){ctx.waitUntil(processPending(env))}
};
