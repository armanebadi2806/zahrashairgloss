import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
try { process.loadEnvFile(resolve(root,'.env')); } catch {}
const children=[
  spawn(process.execPath,['server/app.mjs'],{cwd:root,stdio:'inherit',env:process.env}),
  spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{cwd:root,stdio:'inherit',env:process.env}),
];
const stop=(signal='SIGTERM')=>children.forEach((child)=>{if(!child.killed)child.kill(signal);});
process.on('SIGINT',()=>{stop('SIGINT');process.exit(0);});
process.on('SIGTERM',()=>{stop();process.exit(0);});
children.forEach((child)=>child.on('exit',(code)=>{if(code){stop();process.exit(code);}}));
