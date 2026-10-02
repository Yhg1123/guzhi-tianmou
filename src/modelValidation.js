/** Cheap format checks only; a candidate is never verified by its filename/header. */
export async function validateModelFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["ply", "splat", "ksplat"].includes(ext)) throw new Error("支持 Gaussian PLY、SPLAT、KSPLAT 文件。");
  if (!file.size || file.size > 120 * 1024 * 1024) throw new Error("模型须大于 0 且不超过 120 MB，请先在 SuperSplat 中裁剪或压缩。");
  if (ext === "splat" && file.size % 32 !== 0) throw new Error("SPLAT 文件长度不符合标准 32 字节点记录格式。");
  if (ext === "ply") {
    const header = await file.slice(0, 65536).text();
    if (!/^ply\r?\n/.test(header) || !header.includes("end_header") || !(header.includes("scale_0") || header.includes("packed_scale"))) {
      throw new Error("这不是支持的高斯 PLY；普通点云或网格 PLY 不能直接作为 3DGS 模型。");
    }
  }
}

/** Validate parsed geometry, including all centers, before enabling archive writes. */
export function inspectModelGeometry(count, getCenter) {
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error("模型不包含有效的高斯点。");
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const point = getCenter(index);
    const x = point.x ?? point[0]; const y = point.y ?? point[1]; const z = point.z ?? point[2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error("模型包含非有限坐标，无法验证有效范围。");
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const size = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const center = [minX + (maxX - minX) / 2, minY + (maxY - minY) / 2, minZ + (maxZ - minZ) / 2];
  if (!Number.isFinite(size) || size === 0 || !center.every(Number.isFinite)) throw new Error("无法确定模型范围。");
  return { count, center, size };
}

/** One mounted project/site owns a session. Tokens cannot cross imports or navigation. */
export function createModelImportSession({ persist, onChange = () => {} }) {
  let active = true;
  let revision = 0;
  let state = { model: null, candidate: null, saving: false };
  let writes = Promise.resolve();
  const update = (patch) => {
    state = { ...state, ...patch };
    if (active) onChange(state);
  };
  const current = (token) => Boolean(token) && active && state.candidate === token;
  const session = {
    snapshot: () => state,
    restore(model) {
      if (!active || !model) return;
      // Saved validation is historical; every mounted viewer must verify its bytes again.
      session.stage(model, "archive");
    },
    stage(model, source = "import") {
      if (!active) return null;
      const candidate = { id: ++revision, source, model: { ...model, validation: "pending" } };
      update({ candidate, saving: false });
      return candidate;
    },
    reject(token) {
      if (!current(token)) return false;
      revision += 1;
      update({ candidate: null, saving: false });
      return true;
    },
    async accept(token) {
      if (!current(token)) return { accepted: false };
      const ready = { ...token.model, validation: "ready", validatedAt: new Date().toISOString() };
      update({ model: ready, candidate: null, saving: true });
      // Serialize writes so a slower earlier save can never overwrite a newer model.
      const write = writes.then(async () => {
        if (!active || revision !== token.id) return { accepted: false };
        try { await persist(ready); return { accepted: true, saved: true, model: ready }; }
        catch (error) { return { accepted: true, saved: false, model: ready, error }; }
      });
      writes = write.catch(() => {});
      const outcome = await write;
      if (!active || revision !== token.id) return { accepted: false };
      update({ saving: false });
      return outcome;
    },
    dispose() { active = false; revision += 1; },
  };
  return session;
}

/** A failed read must not be mistaken for an empty capture list that can be saved. */
export async function readArchiveForEditing(loadArchive) {
  try { return { archive: await loadArchive(), captureReady: true, error: null }; }
  catch (error) { return { archive: null, captureReady: false, error }; }
}

/** Status belongs to one file/load, never to the historical ready flag in storage. */
export function currentModelViewerStatus(model, viewerState) {
  return model?.file && viewerState?.file === model.file ? viewerState.status : "loading";
}
