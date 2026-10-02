import test from 'node:test';
import assert from 'node:assert/strict';
import * as projectApi from '../src/project.js';
import { parseGeoJson } from '../src/geodata.js';
const parse = (records) => parseGeoJson(JSON.stringify({type:'FeatureCollection',features:records.map(([id,name,lng=1])=>({type:'Feature',...(id === null ? {} : {id}),properties:{name,period:'Han',location:'Town',site_type:'City'},geometry:{type:'Point',coordinates:[lng,2]}}))}), 'sites').features;
test('explicit site ids survive reorder and coordinate correction',()=>{
 const a=parse([['a','A'],['b','B']]); const b=parse([['b','B',3],['a','A',4]]);
 assert.equal(a[0].id,b[1].id); assert.equal(a[1].id,b[0].id);
});
test('duplicate and unsafe explicit ids reject instead of quietly reassigning',()=>{
 assert.throws(()=>parse([['a','A'],['a','B']]),/ID/);
 assert.throws(()=>parse([['__proto__','A']]),/ID/);
});
test('layer replacement keeps notes and legacy site identities across reorder',()=>{
 const p=projectApi.emptyProject(); p.datasets.sites=parse([['a','A'],['b','B']]).map((s,i)=>({...s,id:`${s.id}-${i+1}`,sourceId:undefined}));
 p.notes={ [p.datasets.sites[0].id]:'field note', removed:'retained archive note' };
 assert.equal(typeof projectApi.replaceDataset,'function');
 const next=projectApi.replaceDataset(p,'sites',parse([['b','B',3],['a','A',4]]),{name:'updated'});
 assert.equal(next.datasets.sites[1].id,p.datasets.sites[0].id);
 assert.deepEqual(next.notes,p.notes); assert.equal(next.archiveId,p.archiveId);
});
test('unique idless records keep identity on correction; ambiguous records do not inherit',()=>{
 assert.equal(typeof projectApi.replaceDataset,'function');
 const p=projectApi.emptyProject(); p.datasets.sites=parse([[null,'A'],[null,'B']]);
 const next=projectApi.replaceDataset(p,'sites',parse([[null,'B',3],[null,'A',4]]),{});
 assert.equal(next.datasets.sites[1].id,p.datasets.sites[0].id);
 const ambiguous=projectApi.replaceDataset(p,'sites',parse([[null,'A'],[null,'A']]),{});
 assert.ok(ambiguous.datasets.sites.every(s=>s.id !== p.datasets.sites[0].id));
});
test('backup retains orphan notes and complete long notes without truncation',()=>{
 const p=projectApi.emptyProject(); p.notes={orphan:'original '.repeat(1000)};
 const restored=projectApi.restoreProject(JSON.stringify(projectApi.serializeProject(p)));
 assert.deepEqual(restored.notes,p.notes);
});
test('new project namespaces are isolated and upgrading old data preserves contents',()=>{
 const a=projectApi.emptyProject(),b=projectApi.emptyProject();
 assert.ok(a.archiveId); assert.notEqual(a.archiveId,b.archiveId);
 assert.equal(typeof projectApi.ensureProjectIdentity,'function');
 const old={...a}; delete old.archiveId; delete old.legacyArchiveMigration;
 const migrated=projectApi.ensureProjectIdentity(old);
 assert.equal(migrated.legacyArchiveMigration,true); assert.deepEqual(migrated.datasets,old.datasets);
 assert.equal(projectApi.ensureProjectIdentity(migrated).archiveId,migrated.archiveId);
});
test('append adds distinct sites and preserves notes; duplicate sites fail without mutation',()=>{
 assert.equal(typeof projectApi.importDataset,'function');
 const p=projectApi.emptyProject(); p.datasets.sites=parse([['a','A']]); p.notes.a='record';
 const next=projectApi.importDataset(p,'sites',parse([['b','B']]),{name:'new'},'append');
 assert.deepEqual(next.datasets.sites.map(s=>s.id),['a','b']); assert.equal(next.notes.a,'record');
 assert.throws(()=>projectApi.importDataset(p,'sites',parse([['a','A',3]]),{},'append'),/重复/);
 assert.equal(p.datasets.sites.length,1); assert.equal(p.datasets.sites[0].lng,1);
});
test('append clears misleading dataset-level temporal claims and records both sources',()=>{
 assert.equal(typeof projectApi.importDataset,'function');
 const p=projectApi.emptyProject(); p.sources.sites={name:'old.geojson',timing:'historical',period:'Han',citation:'old report',sha256:'oldhash'};
 const next=projectApi.importDataset(p,'sites',parse([['new','New']]),{name:'new.geojson',sha256:'newhash'},'append');
 assert.equal(next.sources.sites.timing,'unknown'); assert.equal(next.sources.sites.sha256,'');
 assert.equal(next.sources.sites.imports.length,2); assert.equal(next.sources.sites.count,6);
});
test('corrupt stored projects fail validation rather than replacing saved data with defaults',()=>{
 assert.throws(()=>projectApi.ensureProjectIdentity({schema:3}),/项目/);
 const broken=projectApi.emptyProject(); broken.datasets.sites[0]={...broken.datasets.sites[0],lng:999};
 assert.throws(()=>projectApi.ensureProjectIdentity(broken),/无效/);
});
test('idless identity survives backup before subsequent layer correction',()=>{
 const p=projectApi.emptyProject(); p.datasets.sites=parse([[null,'A']]); p.notes[p.datasets.sites[0].id]='note';
 const restored=projectApi.restoreProject(JSON.stringify(projectApi.serializeProject(p)));
 assert.equal(restored.datasets.sites[0].sourceId,null);
 const corrected=projectApi.replaceDataset(restored,'sites',parse([[null,'A',4]]),{});
 assert.equal(corrected.datasets.sites[0].id,p.datasets.sites[0].id);
});
test('append cannot create a layer that backup restore rejects for vertex size',()=>{
 const p=projectApi.emptyProject(); p.datasets.sites=p.datasets.sites.slice(0,1);
 const line=(id,n)=>({type:'Feature',id,properties:{name:'line'},geometry:{type:'LineString',coordinates:Array.from({length:n},()=>[1,2])}});
 p.datasets.waterways=[line('old',60000)];
 assert.throws(()=>projectApi.importDataset(p,'waterways',[line('new',60000)],{name:'new'},'append'),/顶点/);
});
test('legacy source identity survives backup and does not steal colliding new raw IDs',()=>{
 const p=projectApi.emptyProject(); p.datasets.sites=[{...parse([['monument','A']])[0],id:'monument-1',sourceId:undefined}];
 const restored=projectApi.restoreProject(JSON.stringify(projectApi.serializeProject(p)));
 const updated=projectApi.replaceDataset(restored,'sites',parse([['monument','A',4]]),{});
 assert.equal(updated.datasets.sites[0].id,'monument-1');
 assert.throws(()=>projectApi.replaceDataset(p,'sites',parse([['monument-1','Different']]),{}),/冲突/);
});
test('known source ids also reject canonical collisions after a legacy migration',()=>{
 const p=projectApi.emptyProject(); p.datasets.sites=[{...parse([['monument','A']])[0],id:'monument-1'}];
 assert.throws(()=>projectApi.replaceDataset(p,'sites',parse([['monument-1','Different']]),{}),/冲突/);
});
test('duplicate source aliases reject rather than assign an archive by incoming order',()=>{
 const p=projectApi.emptyProject(); p.datasets.sites=[{...parse([['x','A']])[0],id:'archive-a'}];
 const incoming=[{...parse([['b','B']])[0],sourceId:'x'},{...parse([['c','C']])[0],sourceId:'x'}];
 assert.throws(()=>projectApi.replaceDataset(p,'sites',incoming,{}),/重复|冲突/);
 assert.throws(()=>projectApi.replaceDataset(p,'sites',[...incoming].reverse(),{}),/重复|冲突/);
});
test('site and project identity limits match archive storage limits',()=>{
 assert.throws(()=>parse([['x'.repeat(4097),'A']]),/ID/);
 const invalid=projectApi.emptyProject(); invalid.archiveId={bad:'namespace'};
 assert.throws(()=>projectApi.ensureProjectIdentity(invalid),/项目/);
});
