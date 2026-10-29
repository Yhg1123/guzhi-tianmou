// Run the pinned native trainer; checkpoints, not elapsed-time guesses, report progress.
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tool = join(root, 'qa/training-tools/brush-v0.3.0/brush_app.exe');
const dataset = join(root, 'qa/local-training/cb/prepared-architecture');
const output = join(root, 'qa/local-training/cb/trained-architecture');
const preparationPath=join(root,'qa/local-training/cb/prepared-architecture-preparation.json');
const preparation = JSON.parse(await readFile(preparationPath, 'utf8'));
if (preparation.photographs.length !== 166 || preparation.usesFinishedGaussianModel || preparation.usesPublishedPointCloud || preparation.usesMonocularDepth || preparation.seedPointCount < 1000) throw new Error('Unverified multi-view preparation');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (sha(await readFile(join(dataset,'init.ply'))) !== preparation.seedSha256) throw new Error('Initialization changed');
for (const photo of preparation.photographs) {
  if (sha(await readFile(join(dataset,'images',photo.processed))) !== photo.processedSha256) throw new Error('Training photograph changed: '+photo.name);
  if (sha(await readFile(join(dataset,'masks',photo.processed))) !== photo.maskSha256) throw new Error('Training mask changed: '+photo.name);
}
await mkdir(output,{recursive:true});
if((await readdir(output)).some(name=>/^model_\d+\.ply$/.test(name)))throw new Error('Output already contains a prior training run; preserve it separately before starting a new run');
const args = [dataset,'--total-steps','12000','--max-resolution','768','--max-splats','400000','--sh-degree','1','--refine-every','128','--growth-stop-iter','9500','--export-every','1000','--eval-every','1000','--eval-save-to-disk','--export-path',output,'--export-name','model_{iter}.ply','--seed','42'];
const run = {schema:1,status:'running',startedAt:new Date().toISOString(),tool:'Brush',version:'0.3.0',sourceRevision:'3edecbb2fe79d3e2c87eeab85b15e0b1dd10d486',executableSha256:sha(await readFile(tool)),archiveSha256:'b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6',args,photoCount:166,trainingImages:preparation.photographs.filter(p=>p.split==='train').length,validationImages:preparation.photographs.filter(p=>p.split==='validation').length,initialPoints:preparation.seedPointCount,preparationSha256:sha(await readFile(preparationPath)),checkpoints:[]};
const recordPath=join(output,'run.json'), logPath=join(output,'training.log');
await writeFile(logPath,`Started local multi-view Gaussian optimization ${run.startedAt}\n`);
await writeFile(recordPath,JSON.stringify(run,null,2));
const child=spawn(tool,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RUST_LOG:'warn,brush_cli=info,brush_process=info,cubecl_wgpu::runtime=info'}});
run.pid=child.pid;console.log('Training PID',child.pid,'input images',run.photoCount,'initial 3D points',run.initialPoints);
const log = (bytes) => {
  appendFile(logPath,bytes).catch(()=>{});
  for(const line of bytes.toString().split('\n')) if(/brush_cli| ERROR |panicked|out of memory/i.test(line))console.log(line.slice(0,600));
};
child.stdout.on('data',log);child.stderr.on('data',log);
let scanning=false;
const scan=async()=>{
  if(scanning)return;scanning=true;
  try {
    const files=(await readdir(output)).filter(name=>/^model_\d+\.ply$/.test(name));
    for(const name of files) {
      if(run.checkpoints.some(c=>c.file===name))continue;
      const info=await stat(join(output,name));
      const c={iteration:Number(name.match(/\d+/)[0]),file:name,bytes:info.size,observedAt:new Date().toISOString()};
      run.checkpoints.push(c);console.log('Checkpoint written',c.iteration,c.bytes,'bytes');
      await appendFile(logPath,JSON.stringify({event:'checkpoint',...c})+'\n');
    }
    run.checkpoints.sort((a,b)=>a.iteration-b.iteration);await writeFile(recordPath,JSON.stringify(run,null,2));
  }finally{scanning=false;}
};
const interval=setInterval(()=>scan().catch(e=>console.error(e.message)),3000);
const code=await new Promise((ok,reject)=>{child.on('error',reject);child.on('exit',ok);});
clearInterval(interval);while(scanning)await new Promise(ok=>setTimeout(ok,50));await scan();
run.endedAt=new Date().toISOString();run.exitCode=code;
run.status=code===0 && run.checkpoints.some(c=>c.iteration===12000)?'completed':'failed';
if(run.status==='completed')run.outputSha256=sha(await readFile(join(output,'model_12000.ply')));
await writeFile(recordPath,JSON.stringify(run,null,2));await appendFile(logPath,`Finished ${run.status} ${run.endedAt}, exit ${code}\n`);
console.log('Training',run.status);
if(run.status!=='completed')process.exitCode=1;
