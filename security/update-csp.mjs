// Run after changing inline app JavaScript. No network or deployment.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const path=new URL('../index.html',import.meta.url);
let html=readFileSync(path,'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'");
const policy="default-src 'self'; script-src 'self' "+scripts.join(' ')+"; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src https://parallel-background.chloerayn.workers.dev; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
html=html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/,'');
html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+policy+'">');
writeFileSync(path,html);
