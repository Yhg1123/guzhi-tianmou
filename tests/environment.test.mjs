import test from "node:test";
import assert from "node:assert/strict";
import { weatherUrl, parseWeather, parseWeatherSnapshot, parseSensorData, summarizeEnvironment, environmentColor, environmentSnapshot, refreshCadence, connectionStatus, trendWindow } from "../src/environment.js";
import { readFile } from "node:fs/promises";
import { referenceSites } from "../src/referenceSites.js";
import { appendReferenceSites, emptyProject, serializeProject, restoreProject } from "../src/project.js";

const sites = [{ id: "first", lat: 40, lng: 116 }, { id: "second", lat: 35, lng: 109 }];
const response = (temperature = 0, humidity = 0) => ({ current_units: { time: "unixtime", temperature_2m: "°C", relative_humidity_2m: "%", precipitation: "mm", wind_speed_10m: "m/s" }, current: { time: 1700000000, temperature_2m: temperature, relative_humidity_2m: humidity, precipitation: 0, wind_speed_10m: 0 }, hourly_units: { time: "unixtime", temperature_2m: "°C", relative_humidity_2m: "%" }, hourly: { time: [1699996400, 1700000000, 1700003600], temperature_2m: [-1, temperature, null], relative_humidity_2m: [45, humidity, null] } });
const now = Date.parse("2026-10-26T01:00:00Z");
const sensor = (readings) => ({ schema: 1, source: "测试设备（单元测试数据）", units: { temperature: "°C", humidity: "%" }, readings });
const reading = (overrides = {}) => ({ siteId: "first", timestamp: "2026-10-26T00:00:00Z", temperature: 0, humidity: 0, ...overrides });

test("trend windows distinguish 48 hours of observations from past-plus-forecast weather", () => {
  const record = {timestamp:now,history:[-49,-48,-25,-24,0,24,25].map((hour)=>({timestamp:now+hour*3600000,temperature:hour}))};
  assert.deepEqual(trendWindow(record,true,48).map(x=>x.temperature),[-24,0,24]);
  assert.deepEqual(trendWindow(record,true,24).map(x=>x.temperature),[-24,0]);
  assert.deepEqual(trendWindow(record,false,48).map(x=>x.temperature),[-48,-25,-24,0]);
  assert.deepEqual(trendWindow(record,false,24).map(x=>x.temperature),[-24,0]);
  assert.deepEqual(trendWindow(null,false,24),[]);
});

test("automatic refresh cadence is bounded by source and states never call archived or failed data connected", () => {
  assert.equal(refreshCadence("weather",60),60000);
  assert.equal(refreshCadence("sensor",30),30000);
  assert.equal(refreshCadence("weather",1),60000);
  assert.equal(refreshCadence("weather",-1),60000);
  const current = { records:[{timestamp:now}],now,mode:"weather",automatic:true };
  assert.equal(connectionStatus(current).key,"connected");
  assert.equal(connectionStatus({...current,offline:true}).key,"archive");
  assert.equal(connectionStatus({...current,error:"network"}).key,"retrying");
  assert.equal(connectionStatus({...current,loading:true}).key,"syncing");
  assert.equal(connectionStatus({...current,automatic:false}).key,"paused");
  assert.equal(connectionStatus({...current,records:[]}).key,"empty");
  assert.equal(connectionStatus({...current,records:[{timestamp:now-3600001}]}).key,"delayed");
  assert.equal(connectionStatus({...current,records:[{timestamp:now+3600000}]}).key,"delayed");
  assert.equal(connectionStatus({...current,mode:"sensor",endpoint:""}).key,"local");
});

test("archived weather keeps source time and validates site identity and units before fallback", async () => {
  const archive = JSON.parse(await readFile(new URL("../public/samples/environment-weather-reference.json", import.meta.url), "utf8"));
  const parsed = parseWeatherSnapshot(archive, referenceSites, archive.fetchedAt);
  assert.equal(parsed.fetchedAt, archive.fetchedAt); assert.equal(parsed.records.length,3);
  assert.deepEqual(parsed.records[0],archive.records[0]);
  assert.throws(()=>parseWeatherSnapshot(archive,[{...referenceSites[0],lat:0},...referenceSites.slice(1)],archive.fetchedAt),/不匹配/);
  assert.throws(()=>parseWeatherSnapshot({...archive,units:{temperature:"°F",humidity:"%"}},referenceSites,archive.fetchedAt),/单位/);
  assert.throws(()=>parseWeatherSnapshot(archive,referenceSites,archive.fetchedAt-600000),/无效/);
});

test("weather URLs preserve coordinate pairing and request explicit UTC timestamps and units", () => {
  const params = new URL(weatherUrl(sites)).searchParams;
  assert.equal(params.get("latitude"), "40,35"); assert.equal(params.get("longitude"), "116,109");
  assert.equal(params.get("timeformat"), "unixtime"); assert.equal(params.get("wind_speed_unit"), "ms");
  assert.throws(() => weatherUrl([])); assert.throws(() => weatherUrl([{ lat: 95, lng: 116 }]));
  assert.throws(() => weatherUrl(Array.from({length:31},()=>sites[0])));
});
test("weather parsing distinguishes valid zeros from missing or invalid values", () => {
  const rows = parseWeather([response(),response(null,150)],sites);
  assert.equal(rows[0].temperature,0); assert.equal(rows[0].humidity,0); assert.equal(rows[0].windSpeed,0); assert.equal(rows[0].timestamp,1700000000000);
  assert.equal(rows[1].temperature,null); assert.equal(rows[1].humidity,null);
  assert.equal(rows[0].history[2].temperature,null);
  assert.deepEqual(summarizeEnvironment(rows,"temperature"),{count:1,min:0,max:0,mean:0});
  assert.deepEqual(summarizeEnvironment([],"temperature"),{count:0,min:null,max:null,mean:null});
  assert.equal(environmentColor(null,"temperature"),"#9aa9a3"); assert.notEqual(environmentColor(0,"temperature"),"#9aa9a3");
});
test("weather response mismatch and incompatible units fail before any replacement", () => {
  assert.throws(()=>parseWeather(response(),sites),/不匹配/);
  const bad=response(); bad.current_units.temperature_2m="°F";
  assert.throws(()=>parseWeather(bad,sites.slice(0,1)),/单位/);
  const invalid=response(); invalid.current.time=null; assert.throws(()=>parseWeather(invalid,sites.slice(0,1)),/时间/);
});
test("onsite observations retain per-site chronology and require source, units and zoned time", () => {
  const parsed = parseSensorData(sensor([reading(),reading({siteId:"second",temperature:18,humidity:null}),reading({timestamp:"2026-10-26T00:30:00Z",temperature:2,humidity:50})]),now);
  assert.equal(parsed[0].temperature,2); assert.equal(parsed[0].history[0].temperature,0);
  assert.equal(parsed[1].humidity,null); assert.equal(parsed[1].source,"测试设备（单元测试数据）");
  assert.throws(()=>parseSensorData({...sensor([reading()]),units:{}},now),/units/);
  assert.throws(()=>parseSensorData(sensor([reading({timestamp:"2026-10-26T00:00:00"})]),now),/时区/);
  assert.throws(()=>parseSensorData(sensor([reading({timestamp:"2026-10-27T00:00:00Z"})]),now),/未来/);
  assert.throws(()=>parseSensorData(sensor([reading({humidity:101})]),now),/湿度/);
  assert.throws(()=>parseSensorData(sensor([reading({temperature:null,humidity:null})]),now),/至少/);
  assert.throws(()=>parseSensorData(sensor([reading(),reading()]),now),/重复/);
  assert.throws(()=>parseSensorData(sensor([]),now),/readings/);
});
test("public reference append is idempotent, preserves notes and never overwrites colliding records", () => {
  const original=emptyProject(); original.notes[original.datasets.sites[0].id]="需保留的原笔记"; original.sources.sites.sha256="old-file-hash";
  const first=appendReferenceSites(original); assert.equal(first.added,3);
  assert.deepEqual(first.project.notes,original.notes); assert.equal(first.project.sources.sites.sha256,""); assert.match(first.project.sources.sites.citation,/old-file-hash/);
  assert.equal(appendReferenceSites(first.project).added,0);
  const restored=restoreProject(JSON.stringify(serializeProject(first.project)));
  for(const site of referenceSites){const copy=restored.datasets.sites.find(item=>item.id===site.id);assert.equal(copy.lat,site.lat);assert.equal(copy.recordSource,site.recordSource);assert.equal(copy.isDemo,false);assert.equal(copy.elevation_m,null);}
  const collision=emptyProject(); collision.datasets.sites.push({...referenceSites[0],name:"用户已有记录",lat:20});
  const appended=appendReferenceSites(collision); assert.equal(appended.added,2); assert.equal(appended.project.datasets.sites.find(item=>item.id===referenceSites[0].id).lat,20);
});

test("onsite snapshot round trips with history, while weather snapshots cannot become sensor observations", () => {
  const original=parseSensorData(sensor([reading(),reading({timestamp:"2026-10-26T00:30:00Z",temperature:2})]),now);
  const snapshot=environmentSnapshot("sensor",sites,original,now);
  const restored=parseSensorData(JSON.parse(JSON.stringify(snapshot)),now);
  assert.deepEqual(restored,original);
  assert.throws(()=>parseSensorData(environmentSnapshot("weather",sites,original,now),now),/天气模型/);
});
