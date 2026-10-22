export const CONTRIBUTION_PREFIX = "heritage-contribution-v1:";
export const VISITS_KEY = "heritage-visits-v1";
export const MAX_PHOTOS = 12;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_BATCH_BYTES = 60 * 1024 * 1024;
export const MAX_LIBRARY_BYTES = 150 * 1024 * 1024;

export const CAPTURE_ANGLES = [
  ["front", "正面"], ["left", "左侧"], ["right", "右侧"],
  ["rear", "背面"], ["detail", "构件细节"], ["unknown", "方向不确定"],
];
export const PARTICIPATION_TASKS = [
  { id: "capture", title: "补充现状影像", tag: "探访时参与", description: "从允许到达的位置拍下整体与细节，为数字档案补充不同视角。", guidance: "保留原图，连续拍摄时让相邻画面有较多重叠；不要为了补齐方向进入封闭区域。", icon: "camera" },
  { id: "archive", title: "寻找老照片", tag: "在家也能参与", description: "翻找相册中的旧照，留下大致时间、位置和照片背后的故事。", guidance: "不确定日期可以留空并在备注中说明。扫描件保留完整画面，不用 AI 补画历史细节。", icon: "archive" },
  { id: "revisit", title: "记录时间变化", tag: "长期守护", description: "再次探访时，用相近机位记录外观变化，留下可追溯的时间线索。", guidance: "尽量记录相同位置与方向。你观察到的变化是待核验线索，后续由专业人员判断。", icon: "history" },
];

export function siteIdentity(site) {
  return JSON.stringify([site.id, site.lng, site.lat]);
}

export function validatePhotoBatch(files) {
  if (!files.length) throw new Error("请先选择照片。");
  if (files.length > MAX_PHOTOS) throw new Error(`每份资料最多 ${MAX_PHOTOS} 张照片，请分批登记。`);
  if (files.some((file) => !/\.(jpe?g|png|webp)$/i.test(file.name))) throw new Error("请选择 JPG、PNG 或 WEBP 照片。");
  if (files.some((file) => !file.size || file.size > MAX_FILE_BYTES)) throw new Error("每张照片须大于 0 且不超过 20 MB。");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) throw new Error("本批照片超过 60 MB，请减少照片后重试。");
}

export function makeContribution({ site, task, photos, angle, capturedOn, note, contributor, rights, researchConsent, publicConsent }, existing = [], now = new Date().toISOString(), id = crypto.randomUUID()) {
  if (!site || !Number.isFinite(site.lng) || !Number.isFinite(site.lat)) throw new Error("请先选择有效遗址。");
  if (!PARTICIPATION_TASKS.some((item) => item.id === task)) throw new Error("请选择参与任务。");
  if (!CAPTURE_ANGLES.some(([value]) => value === angle)) throw new Error("请选择拍摄方向。");
  if (!rights || !researchConsent) throw new Error("请确认照片提供权利与研究保护用途。");
  validatePhotoBatch(photos.map((photo) => photo.file));
  if (photos.some((photo) => !/^[a-f0-9]{64}$/.test(photo.sha256) || !Number.isInteger(photo.width) || !Number.isInteger(photo.height) || photo.width < 1 || photo.height < 1)) throw new Error("照片校验未完成，请重新选择文件。");
  const hashes = new Set(photos.map((photo) => photo.sha256));
  if (hashes.size !== photos.length) throw new Error("本批存在重复照片，请移除重复项。");
  if (existing.some((record) => record.siteKey === siteIdentity(site) && record.photos.some((photo) => hashes.has(photo.sha256)))) throw new Error("这处遗址已有相同照片的本地记录，无需重复登记。");
  if (capturedOn) {
    const parsedDate = new Date(`${capturedOn}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedOn) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== capturedOn) throw new Error("拍摄日期格式无效。");
  }
  const bytes = photos.reduce((sum, photo) => sum + photo.file.size, 0);
  if (existing.reduce((sum, record) => sum + record.bytes, 0) + bytes > MAX_LIBRARY_BYTES) throw new Error("本地照片资料超过 150 MB，请先备份需要保留的照片。");
  return {
    schema: 1, id, siteKey: siteIdentity(site),
    site: { id: site.id, name: site.name, lng: site.lng, lat: site.lat, isDemo: Boolean(site.isDemo) },
    task, angle, capturedOn: capturedOn || null, note: String(note || "").slice(0, 2000),
    contributor: String(contributor || "匿名参与者").trim().slice(0, 40) || "匿名参与者",
    consent: { rights: true, research: true, scope: "noncommercial_heritage_documentation_and_protection", publicDisplay: Boolean(publicConsent), version: "local-pilot-v1", recordedAt: now },
    photos, bytes, createdAt: now, status: "local_draft",
  };
}

export function isStoredContribution(record) {
  return record?.schema === 1 && record.status === "local_draft"
    && typeof record.id === "string" && record.id.length > 0
    && typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt))
    && typeof record.contributor === "string" && typeof record.note === "string"
    && record.site && typeof record.site.name === "string" && Number.isFinite(record.site.lng) && Number.isFinite(record.site.lat)
    && record.siteKey === siteIdentity(record.site)
    && PARTICIPATION_TASKS.some((task) => task.id === record.task) && CAPTURE_ANGLES.some(([angle]) => angle === record.angle)
    && record.consent?.rights === true && record.consent.research === true && typeof record.consent.publicDisplay === "boolean"
    && Array.isArray(record.photos) && record.photos.length > 0 && record.photos.length <= MAX_PHOTOS
    && record.photos.every((photo) => photo.file instanceof Blob && typeof photo.file.name === "string" && photo.file.size > 0 && photo.file.size <= MAX_FILE_BYTES && photo.thumbnail instanceof Blob && /^[a-f0-9]{64}$/.test(photo.sha256) && Number.isInteger(photo.width) && Number.isInteger(photo.height) && photo.width > 0 && photo.height > 0)
    && record.bytes === record.photos.reduce((sum, photo) => sum + photo.file.size, 0) && record.bytes <= MAX_BATCH_BYTES;
}

export function contributionManifest(record) {
  return { ...record, photos: record.photos.map(({ file, thumbnail, ...metadata }) => ({ ...metadata, name: file.name, size: file.size, type: file.type })), includesPhotoBytes: false, limitations: "这是本地投稿草稿，未提交服务器、未经专家审核、未用于训练；清单不含照片原图。" };
}

export function describeCoverage(records, site) {
  const relevant = records.filter((record) => record.siteKey === siteIdentity(site));
  const counts = Object.fromEntries(CAPTURE_ANGLES.map(([angle]) => [angle, 0]));
  for (const record of relevant) counts[record.angle] += record.photos.length;
  return { records: relevant.length, photos: relevant.reduce((sum, record) => sum + record.photos.length, 0), counts };
}
