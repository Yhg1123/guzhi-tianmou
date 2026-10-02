import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyProject } from '../src/project.js';

const compiled = await build({ entryPoints: [new URL('../src/DataCenter.jsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
const source = compiled.outputFiles[0].text.replace(/from "([^\"]+)"/g, (_, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { DataCenter } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('data center offers complete backup restore and explicit per-layer append/replace choices', () => {
  const html = renderToStaticMarkup(createElement(DataCenter, { project: emptyProject(), saveStatus: '已保存' }));
  assert.match(html, /data-center-page/);
  assert.match(html, /accept="\.heritage,\.json"/);
  assert.match(html, /照片原件/);
  assert.match(html, /512 MiB/);
  assert.equal((html.match(/value="append"/g) || []).length, 5);
  assert.equal((html.match(/value="replace"/g) || []).length, 5);
  assert.match(html, /预览导入/);
  assert.doesNotMatch(html, /JSON 备份不包含模型文件/);
});


test('new data-center mount stays locked while another restore awaits commit', () => {
  const html = renderToStaticMarkup(createElement(DataCenter, { project: emptyProject(), projectLocked: true, saveStatus: '恢复中' }));
  assert.match(html, /项目正在恢复/);
  assert.equal((html.match(/type="file"[^>]*disabled=""/g) || []).length, 6);
  assert.match(html, /class="button primary" disabled=""/);
});
