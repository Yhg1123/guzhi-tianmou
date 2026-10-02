import test from "node:test";
import assert from "node:assert/strict";
import * as modelValidation from "../src/modelValidation.js";
const { createModelImportSession, validateModelFile, inspectModelGeometry } = modelValidation;

const model = (name = "model.splat") => ({ file: new File([new Uint8Array(64)], name), name, importedAt: "2026-10-02T00:00:00.000Z" });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("import candidates do not write or replace the committed model before viewer validation", async () => {
  const saved = [];
  const session = createModelImportSession({ persist: async (record) => { saved.push(record); } });
  const old = (await session.accept(session.stage(model("good.splat")))).model;
  const writesBeforeCandidate = saved.length;
  const candidate = session.stage(model("broken.splat"));
  assert.equal(saved.length, writesBeforeCandidate);
  assert.equal(session.snapshot().model, old);
  assert.equal(session.snapshot().candidate, candidate);
  assert.equal(session.reject(candidate), true);
  assert.equal(session.snapshot().candidate, null);
  assert.equal(session.snapshot().model, old);
  assert.equal(saved.length, writesBeforeCandidate);
});

test("viewer validation promotes and persists a ready model only once", async () => {
  const saved = [];
  const session = createModelImportSession({ persist: async (record) => { saved.push(record); } });
  const candidate = session.stage(model());
  const outcome = await session.accept(candidate);
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.saved, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].validation, "ready");
  assert.equal(session.snapshot().model, saved[0]);
  assert.equal(session.snapshot().candidate, null);
  assert.equal((await session.accept(candidate)).accepted, false);
  assert.equal(saved.length, 1);
});

test("superseded candidate and disposed navigation callbacks cannot save", async () => {
  const saved = [];
  const session = createModelImportSession({ persist: async (record) => { saved.push(record); } });
  const stale = session.stage(model("old.splat"));
  const current = session.stage(model("new.splat"));
  assert.equal((await session.accept(stale)).accepted, false);
  assert.equal(session.reject(stale), false);
  assert.equal(session.snapshot().candidate, current);
  session.dispose();
  assert.equal((await session.accept(current)).accepted, false);
  assert.equal(saved.length, 0);
});

test("old archives remain unverified until viewer success", async () => {
  const saved = [];
  const session = createModelImportSession({ persist: async (record) => { saved.push(record); } });
  const legacy = model("legacy.splat");
  session.restore(legacy);
  assert.equal(session.snapshot().model, null);
  assert.equal(session.snapshot().candidate.model.validation, "pending");
  assert.equal(saved.length, 0);
  await session.accept(session.snapshot().candidate);
  assert.equal(saved[0].validation, "ready");
});

test("storage failure keeps the verified model available for this session and reports unsaved", async () => {
  const session = createModelImportSession({ persist: async () => { throw new Error("quota"); } });
  const candidate = session.stage(model());
  const outcome = await session.accept(candidate);
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.saved, false);
  assert.match(outcome.error.message, /quota/);
  assert.equal(session.snapshot().model.validation, "ready");
  assert.equal(session.snapshot().saving, false);
});

test("concurrent validated saves are ordered and latest candidate wins", async () => {
  const first = deferred();
  const saved = [];
  const session = createModelImportSession({ persist: async (record) => {
    if (record.name === "first.splat") await first.promise;
    saved.push(record.name);
  } });
  const a = session.stage(model("first.splat"));
  const writeA = session.accept(a);
  await Promise.resolve();
  const b = session.stage(model("last.splat"));
  const writeB = session.accept(b);
  first.resolve();
  await Promise.all([writeA, writeB]);
  assert.equal(saved.at(-1), "last.splat");
  assert.equal(session.snapshot().model.name, "last.splat");
});

test("file preflight rejects unsupported, oversized and non-Gaussian files", async () => {
  await assert.rejects(validateModelFile(new File(["x"], "x.obj")), /支持/);
  await assert.rejects(validateModelFile(new File([], "x.splat")), /120 MB/);
  await assert.rejects(validateModelFile(new File(["x"], "x.splat")), /32/);
  await assert.rejects(validateModelFile(new File(["ply\nformat ascii 1.0\nend_header\n"], "x.ply")), /高斯 PLY/);
  const file = model().file;
  await validateModelFile(file);
});

test("viewer geometry validation rejects empty, non-finite and degenerate meshes", () => {
  const inspect = (points) => inspectModelGeometry(points.length, (index) => points[index]);
  assert.throws(() => inspect([]), /有效/);
  assert.throws(() => inspect([[NaN, 0, 0], [1, 1, 1]]), /有限/);
  assert.throws(() => inspect([[1, 1, 1], [1, 1, 1]]), /范围/);
  assert.deepEqual(inspect([[0, 0, 0], [2, 4, 4]]), { count: 2, center: [1, 2, 2], size: 6 });
});

// Turning a read failure into an empty, writable form would erase a saved capture list.
test("failed archive hydration never enables capture autosave", async () => {
  assert.equal(typeof modelValidation.readArchiveForEditing, "function");
  const outcome = await modelValidation.readArchiveForEditing(async () => { throw new Error("temporary read failure"); });
  assert.equal(outcome.captureReady, false);
  assert.equal(outcome.archive, null);
  assert.match(outcome.error.message, /read failure/);
  const archive = { model: null, capture: { photos: [{ name: "kept.jpg" }], checks: { permission: true } } };
  const recovered = await modelValidation.readArchiveForEditing(async () => archive);
  assert.equal(recovered.captureReady, true);
  assert.equal(recovered.archive, archive);
});

test("previous ready archives must pass the current viewer before becoming a committed model", async () => {
  const saved = [];
  const session = createModelImportSession({ persist: async (record) => { saved.push(record); } });
  const archived = { ...model("previous.splat"), validation: "ready" };
  session.restore(archived);
  assert.equal(session.snapshot().model, null);
  assert.equal(session.snapshot().candidate.model.validation, "pending");
  assert.equal(session.snapshot().candidate.model.file, archived.file);
  session.reject(session.snapshot().candidate);
  assert.equal(session.snapshot().model, null);
  assert.equal(saved.length, 0);
  assert.equal(archived.validation, "ready");
});

test("callbacks without a candidate token never change or persist an archive", async () => {
  const session = createModelImportSession({ persist: async () => { assert.fail("unexpected write"); } });
  assert.equal(session.reject(null), false);
  assert.equal((await session.accept(null)).accepted, false);
});

test("a previous successful viewer cannot mark a new file or failed reload ready", () => {
  assert.equal(typeof modelValidation.currentModelViewerStatus, "function");
  const current = model("current.splat");
  const previous = model("previous.splat");
  assert.equal(modelValidation.currentModelViewerStatus(current, { file: previous.file, status: "ready" }), "loading");
  assert.equal(modelValidation.currentModelViewerStatus(current, { file: current.file, status: "error" }), "error");
  assert.equal(modelValidation.currentModelViewerStatus(current, { file: current.file, status: "ready" }), "ready");
});
