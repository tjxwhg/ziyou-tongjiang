// data/external-apis.js
const axios = require('axios');
const config = require('../config');

// 缓存
let weatherCache = null;
let weatherCacheTime = null;
const CACHE_DURATION = 3600000; // 1小时

/**
 * 获取实时天气（OpenWeatherMap）
 * @param {number} lat - 纬度
 * @param {number} lng - 经度
 * @returns {Promise<Object>} { temp, weather, wind, rain }
 */
async function fetchWeather(lat, lng) {
  // 检查缓存
  const now = Date.now();
  if (weatherCache && weatherCacheTime && (now - weatherCacheTime < CACHE_DURATION)) {
    return weatherCache;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${config.OPENWEATHER_API_KEY}&units=metric&lang=zh_cn`;
    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;

    const result = {
      temp: data.main.temp,
      weather: data.weather[0].description,
      wind: data.wind.speed,
      rain: data.rain ? data.rain['1h'] || 0 : 0,
      icon: data.weather[0].icon,
      updated_at: new Date().toISOString()
    };

    weatherCache = result;
    weatherCacheTime = now;
    return result;
  } catch (error) {
    console.warn('[天气API] 请求失败，返回默认天气:', error.message);
    // 降级：返回默认天气
    return {
      temp: 25,
      weather: '多云',
      wind: 5,
      rain: 0,
      icon: '04d',
      updated_at: new Date().toISOString(),
      is_fallback: true
    };
  }
}

/**
 * 获取实时交通时间（高德地图）
 * @param {Object} origin - { lat, lng }
 * @param {Object} destination - { lat, lng }
 * @param {string} mode - 'driving' | 'transit' | 'walking'
 * @returns {Promise<number>} 预计分钟数
 */
async function fetchRealTimeTraffic(origin, destination, mode = 'driving') {
  try {
    // 高德驾车路径规划 API
    const url = `https://restapi.amap.com/v3/direction/driving?origin=${origin.lng},${origin.lat}&destination=${destination.lng},${destination.lat}&extensions=base&key=${config.GAODE_API_KEY}`;
    const response = await axios.get(url, { timeout: 5000 });

    if (response.data.status === '1' && response.data.route && response.data.route.paths && response.data.route.paths.length > 0) {
      const duration = response.data.route.paths[0].duration; // 秒
      return Math.ceil(duration / 60);
    }
    throw new Error('高德返回无效数据');
  } catch (error) {
    console.warn('[交通API] 请求失败，使用默认值:', error.message);
    return null; // 返回null表示使用预设值
  }
}

/**
 * 获取POI实时状态（占位，后期可接入景区官方API）
 * @param {string} poiId
 * @returns {Promise<Object>} { is_open, crowd_level, wait_time }
 */
async function fetchPoiRealTimeStatus(poiId) {
  // 目前返回默认状态，后期可接入真实API
  return {
    is_open: true,
    crowd_level: 'medium', // low, medium, high
    wait_time: 0,
    updated_at: new Date().toISOString()
  };
}

module.exports = {
  fetchWeather,
  fetchRealTimeTraffic,
  fetchPoiRealTimeStatus
};