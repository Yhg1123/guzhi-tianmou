import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { trainedGaussianCases } from '../src/trainedGaussians.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const asset = url => readFile(new URL('../public'+url,import.meta.url));

test('the published generation is tied to a completed local run and independently triangulated photo inputs',async()=>{
  const scene=trainedGaussianCases.find(s=>s.id==='local-cb');
  assert.equal(scene.trainedInThisApp,true); assert.equal(scene.trainedByAuthor,false);
  const manifest=JSON.parse(await asset(scene.sourceManifest));
  const run=JSON.parse(await asset(scene.trainingRecordUrl));
  const log=await asset(scene.trainingLogUrl);
  assert.equal(run.status,'completed'); assert.equal(run.exitCode,0);
  assert.equal(run.photoCount,166); assert.equal(run.trainingImages,146);assert.equal(run.validationImages,20);
  assert.ok(run.checkpoints.some(c=>c.iteration===12000));
  assert.ok(Date.parse(run.endedAt)>Date.parse(run.startedAt));
  assert.equal(sha(log),run.trainingLogSha256);
  assert.match(log.toString(),/NVIDIA GeForce RTX 3050 Laptop GPU/);
  assert.match(log.toString(),/Loaded dataset with 146 training, 20 eval views/);
  assert.match(log.toString(),/Done training!/);
  assert.equal(manifest.preparation.usesFinishedGaussianModel,false);
  assert.equal(manifest.preparation.usesPublishedPointCloud,false);
  assert.equal(manifest.preparation.usesMonocularDepth,false);
  assert.ok(manifest.preparation.seedPointCount>=1000);
  assert.equal(manifest.license,'CC BY 4.0');
  assert.equal(manifest.preparation.source.revision,'0a15cffbf0c0ab505b4844f88bdbbfcc494e17d9');
  const train=new Set(manifest.preparation.photographs.filter(p=>p.split==='train').map(p=>p.name));
  const validation=new Set(manifest.preparation.photographs.filter(p=>p.split==='validation').map(p=>p.name));
  assert.equal(train.size,146);assert.equal(validation.size,20);
  for(const pair of manifest.preparation.pairs){assert.ok(train.has(pair.a)&&train.has(pair.b));assert.ok(!validation.has(pair.a)&&!validation.has(pair.b));}
  for(const p of manifest.preparation.photographs){assert.match(p.sha256,/^[a-f0-9]{64}$/);assert.match(p.processedSha256,/^[a-f0-9]{64}$/);assert.match(p.maskSha256,/^[a-f0-9]{64}$/);}
  assert.equal(run.selectedCheckpoint.psnr,Math.max(...run.validationHistory.map(v=>v.psnr)));
  assert.equal(run.selectedCheckpoint.views.length,20);
  assert.match(run.validationCaveat,/Architecture-region PSNR/);
  for(const photo of scene.photographs)assert.equal(sha(await asset(photo.previewUrl)),photo.previewSha256);
});

test('the generated Gaussian PLY preserves learned volume, anisotropic covariance, alpha and higher-order color',async()=>{
  const scene=trainedGaussianCases.find(s=>s.id==='local-cb');
  const bytes=await asset(scene.url), manifest=JSON.parse(await asset(scene.sourceManifest));
  const raw=await asset(scene.rawUrl), indices=await asset(scene.displayFilter.indicesUrl);
  assert.equal(sha(raw),scene.rawSha256);assert.equal(sha(indices),scene.displayFilter.indicesSha256);
  const rawOffset=raw.indexOf('end_header\n')+11;
  assert.equal(Number(raw.subarray(0,rawOffset).toString().match(/element vertex (\d+)/)[1]),scene.rawPointCount);
  assert.equal(sha(bytes),scene.sha256);assert.equal(manifest.sha256,scene.sha256);assert.equal(bytes.length,scene.bytes);
  const offset=bytes.indexOf('end_header\n')+11, header=bytes.subarray(0,offset).toString();
  assert.match(header,/binary_little_endian 1.0/);assert.match(header,/SH degree: 1/);
  const count=Number(header.match(/element vertex (\d+)/)[1]);
  const names=header.split('\n').filter(s=>s.startsWith('property float ')).map(s=>s.split(' ').at(-1));
  assert.equal(names.length,23);assert.equal(count,scene.pointCount);assert.ok(count>manifest.preparation.seedPointCount*2);
  assert.equal(bytes.length-offset,count*23*4);
  assert.equal(indices.length,count*4);
  let previous=-1;
  for(let i=0;i<count;i++){
    const original=indices.readUInt32LE(i*4);assert.ok(original>previous && original<scene.rawPointCount);previous=original;
    assert.ok(bytes.subarray(offset+i*92,offset+(i+1)*92).equals(raw.subarray(rawOffset+original*92,rawOffset+(original+1)*92)), 'Display cleanup must preserve the exact trained Gaussian record');
  }
  const field=(at,name)=>bytes.readFloatLE(offset+(at*23+names.indexOf(name))*4);
  const alpha=new Set(), rotations=new Set();let anisotropic=0,nonzeroSH=0;
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let at=0;at<count;at++){
    for(const name of names)assert.ok(Number.isFinite(field(at,name)),name);
    for(const [axis,name]of ['x','y','z'].entries()){const v=field(at,name);lo[axis]=Math.min(lo[axis],v);hi[axis]=Math.max(hi[axis],v);}
    const s=[0,1,2].map(i=>field(at,'scale_'+i));if(Math.max(...s)-Math.min(...s)>Math.log(3))anisotropic++;
    if(at%10===0){alpha.add(field(at,'opacity'));rotations.add([0,1,2,3].map(i=>field(at,'rot_'+i).toFixed(3)).join(','));}
    if(Math.abs(field(at,'f_rest_0'))>1e-5)nonzeroSH++;
  }
  assert.deepEqual(lo,manifest.bounds.min);assert.deepEqual(hi,manifest.bounds.max);
  assert.ok(hi.every((v,i)=>v-lo[i]>1),'The result must occupy a 3D spatial volume');
  assert.ok(alpha.size>1000 && rotations.size>1000 && anisotropic>count*.2 && nonzeroSH>count*.1);
  assert.equal(scene.shDegree,1,'The renderer must retain the trained higher-order SH instead of flattening to RGB samples');
});
