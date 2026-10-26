export const WEATHER_SOURCE = "Open-Meteo · 天气模型参考";
export const WEATHER_REFRESH_MS = 10 * 60 * 1000;
export const SENSOR_STALE_MS = 60 * 60 * 1000;
export const METRICS = {
  temperature: { title: "气温", unit: "°C", color: "#b66e3f", range: [-90, 70] },
  humidity: { title: "相对湿度", unit: "%", color: "#428d99", range: [0, 100] },
};
const within = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
export const metricValue = (value, key) => within(value, ...(METRICS[key]?.range || [-Infinity, Infinity]));
export function weatherUrl(sites) {
  if (!sites.length || sites.length > 30 || sites.some((site) => !Number.isFinite(site.lat) || Math.abs(site.lat) > 90 || !Number.isFinite(site.lng) || Math.abs(site.lng) > 180)) throw new Error("天气请求需要 1–30 个有效的 WGS84 点位。");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({ latitude: sites.map((s) => s.lat).join(","), longitude: sites.map((s) => s.lng).join(","), current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m", hourly: "temperature_2m,relative_humidity_2m", past_days: "1", forecast_days: "2", timeformat: "unixtime", timezone: "UTC", wind_speed_unit: "ms" });
  return url.href;
}
export function parseWeather(payload, sites) {
  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length !== sites.length) throw new Error("天气响应点位数量不匹配，未替换上次数据。");
  return items.map((item, index) => {
    if (item?.current_units?.temperature_2m !== "°C" || item.current_units.relative_humidity_2m !== "%" || item.current_units.time !== "unixtime") throw new Error("天气响应单位不符合约定，未替换上次数据。");
    const time = within(item.current?.time, 1, 9999999999);
    if (!time) throw new Error("天气响应缺少有效时间。");
    const hourly = item.hourly;
    const history = Array.isArray(hourly?.time) && hourly.time.length <= 1000 && item.hourly_units?.time === "unixtime" && item.hourly_units?.temperature_2m === "°C" && item.hourly_units?.relative_humidity_2m === "%" ? hourly.time.flatMap((t, i) => typeof t === "number" && Number.isFinite(t) ? [{ timestamp: t * 1000, temperature: metricValue(hourly.temperature_2m?.[i], "temperature"), humidity: metricValue(hourly.relative_humidity_2m?.[i], "humidity") }] : []) : [];
    return { siteId: sites[index].id, timestamp: time * 1000, interval: within(item.current.interval, 1, 86400), temperature: metricValue(item.current.temperature_2m, "temperature"), humidity: metricValue(item.current.relative_humidity_2m, "humidity"), precipitation: item.current_units.precipitation === "mm" ? within(item.current.precipitation, 0, 2000) : null, windSpeed: item.current_units.wind_speed_10m === "m/s" ? within(item.current.wind_speed_10m, 0, 200) : null, source: WEATHER_SOURCE, history, grid: { lat: item.latitude, lng: item.longitude } };
  });
}
export function parseSensorData(input, now = Date.now()) {
  if (input?.sourceType === "weather_model_not_onsite_sensor") throw new Error("天气模型快照不能作为现场传感器观测导入。");
  if (input?.schema !== 1 || typeof input.source !== "string" || !input.source.trim() || !Array.isArray(input.readings) || !input.readings.length || input.readings.length > 5000) throw new Error("需要 schema: 1、来源 source 和 1–5000 条 readings。");
  if (input.units?.temperature !== "°C" || input.units?.humidity !== "%") throw new Error("请明确标注 units.temperature 为 °C、units.humidity 为 %。");
  const groups = new Map();
  for (const reading of input.readings) {
    const timestamp = typeof reading.timestamp === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(reading.timestamp) ? Date.parse(reading.timestamp) : NaN;
    if (typeof reading.siteId !== "string" || !reading.siteId.trim() || !Number.isFinite(timestamp) || timestamp < 0 || timestamp > now + 5 * 60 * 1000) throw new Error("观测记录需包含 siteId 和带时区的有效 timestamp，不能使用未来时间。");
    const temperature = reading.temperature == null ? null : metricValue(reading.temperature, "temperature");
    const humidity = reading.humidity == null ? null : metricValue(reading.humidity, "humidity");
    if (reading.temperature != null && temperature === null || reading.humidity != null && humidity === null || temperature === null && humidity === null) throw new Error("温度须为 -90–70 °C，湿度须为 0–100 %；每条至少有一个有效指标。");
    const points = groups.get(reading.siteId) || new Map();
    if (points.has(timestamp)) throw new Error("同一点位存在重复时间，请先整理观测记录。");
    points.set(timestamp, { timestamp, temperature, humidity }); groups.set(reading.siteId, points);
  }
  return [...groups].map(([siteId, values]) => { const history = [...values.values()].sort((a, b) => a.timestamp - b.timestamp); return { siteId, ...history.at(-1), history, source: input.source.trim().slice(0, 100), precipitation: null, windSpeed: null }; });
}
export function parseWeatherSnapshot(input, sites, now = Date.now()) {
  if (input?.schema !== 1 || input.sourceType !== "weather_model_not_onsite_sensor" || !Array.isArray(input.requestedSites) || !Array.isArray(input.records) || input.records.length !== sites.length || !Number.isFinite(input.fetchedAt) || input.fetchedAt <= 0 || input.fetchedAt > now + 300000) throw new Error("天气历史快照格式无效。");
  const payload = sites.map((site) => {
    const requested = input.requestedSites.find((item) => item.id === site.id);
    const record = input.records.find((item) => item.siteId === site.id);
    if (!requested || requested.lat !== site.lat || requested.lng !== site.lng || !record || !Array.isArray(record.history) || !Number.isFinite(record.timestamp) || record.timestamp > now + 300000) throw new Error("历史天气快照与请求点位不匹配。");
    return { current_units: { time: "unixtime", temperature_2m: input.units?.temperature, relative_humidity_2m: input.units?.humidity, wind_speed_10m: input.units?.windSpeed, precipitation: input.units?.precipitation }, current: { time: record.timestamp / 1000, interval: record.interval, temperature_2m: record.temperature, relative_humidity_2m: record.humidity, wind_speed_10m: record.windSpeed, precipitation: record.precipitation }, hourly_units: { time: "unixtime", temperature_2m: input.units?.temperature, relative_humidity_2m: input.units?.humidity }, hourly: { time: record.history.map((point) => point.timestamp / 1000), temperature_2m: record.history.map((point) => point.temperature), relative_humidity_2m: record.history.map((point) => point.humidity) }, latitude: record.grid?.lat, longitude: record.grid?.lng };
  });
  return { records: parseWeather(payload, sites), fetchedAt: input.fetchedAt };
}
export function summarizeEnvironment(records, metric) {
  const values = records.map((record) => metricValue(record[metric], metric)).filter((value) => value !== null);
  return { count: values.length, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
}
export function environmentColor(value, metric) {
  if (metricValue(value, metric) === null) return "#9aa9a3";
  const steps = metric === "humidity" ? [20, 40, 60, 80] : [0, 10, 20, 30];
  return ["#617eaa", "#579994", "#82a374", "#c6a15b", "#b65f49"][steps.filter((step) => value >= step).length];
}

export function environmentSnapshot(mode, sites, records, fetchedAt) {
  const snapshot = { schema: 1, mode, sourceType: mode === "weather" ? "weather_model_not_onsite_sensor" : "user_supplied_observations_unverified", source: records[0]?.source || "未注明来源", requestedSites: sites.map(({ id, name, lat, lng, isDemo, recordSource }) => ({ id, name, lat, lng, isDemo, recordSource })), fetchedAt, units: { temperature: "°C", humidity: "%", windSpeed: "m/s", precipitation: "mm" }, records };
  if (mode === "sensor") snapshot.readings = records.flatMap((record) => record.history.map((point) => ({ siteId: record.siteId, timestamp: new Date(point.timestamp).toISOString(), temperature: point.temperature, humidity: point.humidity })));
  return snapshot;
}
