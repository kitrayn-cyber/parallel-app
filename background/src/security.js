import { timingSafeEqual } from 'node:crypto';
// Single-owner sessions. No raw token, password or IP is persisted in D1.
export const sha256 = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
};
export async function passwordMatches(provided, expected) {
  if(typeof provided!=='string'||!expected)return false;
  const [a,b]=await Promise.all([sha256(provided),sha256(expected)]);
  return timingSafeEqual(new TextEncoder().encode(a),new TextEncoder().encode(b));
}
export function bearer(req){
  const header=req.headers.get('Authorization')||'';
  return header.startsWith('Bearer ')?header.slice(7):'';
}
export async function sessionFor(req,env){
  const token=bearer(req);if(!/^ps_[A-Za-z0-9_-]{43}$/.test(token))return null;
  return env.DB.prepare('SELECT token_hash,expires_at FROM security_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await sha256(token),Date.now()).first();
}
export async function principal(req,env){
  const token=bearer(req);
  if(token.startsWith('ps_'))return await sessionFor(req,env)?'owner':null;
  // Backend-first compatibility. Disable explicitly only after old clients update.
  return env.ENABLE_LEGACY_PASSWORD_AUTH!=='false'&&await passwordMatches(token,env.APP_PASSWORD)?'owner':null;
}
export async function limit(env,key,max,windowMs){
  const now=Date.now(),window=Math.floor(now/windowMs),bucket=key+':'+window;
  const result=await env.DB.prepare(`INSERT INTO security_rate_limits(bucket,expires_at,requests) VALUES (?,?,1)
    ON CONFLICT(bucket) DO UPDATE SET requests=requests+1 WHERE requests<?`).bind(bucket,(window+1)*windowMs,max).run();
  return !!result.meta.changes;
}
export async function clientKey(req,env){
  return sha256((env.APP_PASSWORD||'')+'\u0000'+(req.headers.get('CF-Connecting-IP')||'unknown'));
}
export async function createSession(env,remember){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token='ps_'+btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const expiresAt=Date.now()+(remember?14*86400000:12*3600000);
  await env.DB.prepare('INSERT INTO security_sessions(token_hash,created_at,expires_at) VALUES (?,?,?)').bind(await sha256(token),Date.now(),expiresAt).run();
  return {token,expiresAt};
}

export async function pruneAuthMetadata(env){
  // Bounded retention cleanup touches only the NEW auth tables, never app data.
  const cutoff=Date.now()-86400000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM security_rate_limits WHERE bucket IN (SELECT bucket FROM security_rate_limits WHERE expires_at<? LIMIT 500)').bind(cutoff),
    env.DB.prepare('DELETE FROM security_sessions WHERE token_hash IN (SELECT token_hash FROM security_sessions WHERE expires_at<? LIMIT 100)').bind(cutoff)
  ]);
}
