// Writes secrets to an ignored local file; never prints the private key.
import { writeFileSync } from 'node:fs';
const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const raw=await crypto.subtle.exportKey('raw',pair.publicKey);
const privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
const subject=process.argv[2];
if(!subject?.startsWith('mailto:'))throw Error('Usage: node scripts/generate-vapid.js mailto:YOUR_EMAIL');
const keys={VAPID_PUBLIC_KEY:Buffer.from(raw).toString('base64url'),VAPID_PRIVATE_KEY:privateJwk.d,VAPID_SUBJECT:subject};
writeFileSync('.vapid-keys.local',JSON.stringify(keys,null,2),{mode:0o600,flag:'wx'});
console.log('Saved .vapid-keys.local (ignored by Git). Keep this file private and stable across deploys.');
