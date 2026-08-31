// utils.js
import { COUNTY, LONG_SPOT_NAMES, COUNTY_SPOT_KEYWORDS } from './config.js';

// 坐标转换
export function wgs84ToGcj02(lat, lon) {
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }
  function transformLon(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return ret;
  }
  const dLat = transformLat(lon - 105.0, lat - 35.0);
  const dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLatFinal = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  const dLonFinal = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLatFinal, lng: lon + dLonFinal };
}

export function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function formatTime(m) {
  let hours = Math.floor(m / 60);
  let minutes = m % 60;
  if (hours >= 24) hours = hours % 24;
  return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
}

// 天气
let weatherCache = null;
export async function fetchWeatherForecast() {
  const now = Date.now();
  if (weatherCache && (now - weatherCache.time < 3600000)) {
    return weatherCache.data;
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=31.911705&longitude=107.245033&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max&timezone=Asia/Shanghai&forecast_days=16`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('天气API请求失败');
    const data = await response.json();
    if (!data.daily || !data.daily.time) throw new Error('天气数据格式异常');
    const codes = data.daily.weathercode || [];
    const tempsMax = data.daily.temperature_2m_max || [];
    const tempsMin = data.daily.temperature_2m_min || [];
    const winds = data.daily.windspeed_10m_max || [];
    const dates = data.daily.time || [];
    const codeMap = {
      0: '晴', 1: '晴', 2: '晴间多云', 3: '多云',
      45: '雾', 48: '雾',
      51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
      61: '小雨', 63: '中雨', 65: '大雨',
      71: '小雪', 73: '中雪', 75: '大雪',
      80: '阵雨', 81: '中阵雨', 82: '强阵雨',
      95: '雷暴', 96: '雷暴加冰雹', 99: '强雷暴加冰雹'
    };
    const forecast = dates.map((date, i) => ({
      date: date,
      weather: codeMap[codes[i]] || '未知天气',
      tempMax: tempsMax[i] !== undefined ? Math.round(tempsMax[i]) : '--',
      tempMin: tempsMin[i] !== undefined ? Math.round(tempsMin[i]) : '--',
      wind: winds[i] !== undefined ? Math.round(winds[i]) : '--'
    }));
    weatherCache = { time: Date.now(), data: forecast };
    return forecast;
  } catch (e) {
    console.warn('[天气] 获取失败:', e);
    return null;
  }
}

export function getDayWeatherTip(weatherObj) {
  if (!weatherObj) return '⚠️ 天气信息获取失败，请自行关注天气变化。';
  const { weather, tempMax, tempMin, wind } = weatherObj;
  let tip = `🌤️ 天气：${weather}`;
  if (tempMin !== '--' && tempMax !== '--') tip += `，气温 ${tempMin}℃ ～ ${tempMax}℃`;
  else if (tempMax !== '--') tip += `，最高气温 ${tempMax}℃`;
  if (wind !== '--') tip += `，风力 ${wind} km/h`;
  if (weather.includes('雨') || weather.includes('雷') || weather.includes('雾')) tip += '，☔ 有降雨或大雾，建议携带雨具，注意出行安全。';
  else if (tempMax !== '--' && tempMax > 33) tip += '，☀️ 气温较高，注意防暑防晒，多补充水分。';
  else if (tempMax !== '--' && tempMax < 10) tip += '，🧥 气温较低，注意保暖。';
  else tip += '，🌿 天气适宜出行，祝您旅途愉快！';
  return tip;
}

// 语音
let utterance = null;
export function speak(text, lang = 'zh-CN') {
  if (!('speechSynthesis' in window)) return;
  cancelSpeech();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.9;
  utterance = u;
  window.speechSynthesis.speak(u);
}
export function cancelSpeech() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (utterance) utterance = null;
}

// 检测长耗时景点
export function isLongSpot(spot) {
  if (!spot || !spot.name) return false;
  return LONG_SPOT_NAMES.some(name => spot.name.includes(name));
}

// 获取县城景点列表（需要传入 allPois）
export function getCountySpots(allPois) {
  if (!allPois) return [];
  return allPois.filter(p => {
    if (!p || !p.name) return false;
    return COUNTY_SPOT_KEYWORDS.some(kw => p.name.includes(kw));
  }).map(p => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    visitDuration: p.visit_duration || 90,
    isCounty: true
  }));
}
