// map.js
import L from 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
import { wgs84ToGcj02, getDistance, speak, cancelSpeech } from './utils.js';
import { poiColors, COUNTY } from './config.js';
import { getPois } from './api.js';

let mapInstance = null;
let userMarker = null;
let simMarker = null;
let poiMarkers = [];
let currentGcjPos = null;
let watchId = null;
let lastTriggeredPoiIds = {};
const TRIGGER_RADIUS = 30;
const GPS_ACCURACY_TOLERANCE = 10;
let voiceEnabled = true;
let allPois = [];

export function initMap(containerId, center = [31.911705, 107.245033], zoom = 12) {
  if (mapInstance) return mapInstance;
  mapInstance = L.map(containerId, { zoomControl: false }).setView(center, zoom);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    subdomains: ['1','2','3','4'],
    maxZoom: 18
  }).addTo(mapInstance);
  L.control.zoom({ position: 'topleft' }).addTo(mapInstance);
  return mapInstance;
}

export function setVoiceEnabled(enabled) {
  voiceEnabled = enabled;
  if (!enabled) cancelSpeech();
}

export function loadPoisToMap(pois) {
  allPois = pois;
  // 清除旧标记
  poiMarkers.forEach(m => mapInstance.removeLayer(m));
  poiMarkers = [];
  pois.forEach(p => {
    const cat = (p.category||'').split(',')[0]||'其他';
    const color = poiColors[cat]||'#999';
    const icon = L.divIcon({
      html: `<div style="background:${color}; width:20px; height:20px; border-radius:50%; border:2px solid white;"></div>`,
      iconSize: [20,20]
    });
    const marker = L.marker([p.lat,p.lng], { icon }).addTo(mapInstance);
    marker.poiData = p;
    marker.on('click', () => {
      if (typeof window.showPoiDetail === 'function') window.showPoiDetail(p);
    });
    poiMarkers.push(marker);
  });
}

export function filterPoisByCategory(category) {
  poiMarkers.forEach(marker => {
    const poi = marker.poiData;
    if (!poi) return;
    const cats = (poi.category||'').split(',').map(c => c.trim());
    const match = cats.some(c => c === category);
    if (match) {
      if (!marker._icon) mapInstance.addLayer(marker);
      const color = poiColors[category]||'#999';
      marker.setIcon(L.divIcon({
        html: `<div style="background:${color}; width:30px; height:30px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 12px rgba(0,0,0,0.5);"></div>`,
        iconSize: [30,30]
      }));
    } else {
      if (marker._icon) mapInstance.removeLayer(marker);
    }
  });
}

export function clearFilter() {
  poiMarkers.forEach(marker => {
    if (!marker._icon) mapInstance.addLayer(marker);
    const poi = marker.poiData;
    if (poi) {
      const cat = (poi.category||'').split(',')[0]||'其他';
      const color = poiColors[cat]||'#999';
      marker.setIcon(L.divIcon({
        html: `<div style="background:${color}; width:20px; height:20px; border-radius:50%; border:2px solid white;"></div>`,
        iconSize: [20,20]
      }));
    }
  });
}

export function locateUser() {
  if (!navigator.geolocation) { alert('您的浏览器不支持定位'); return; }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const raw = { lat: position.coords.latitude, lng: position.coords.longitude };
      const gcj = wgs84ToGcj02(raw.lat, raw.lng);
      currentGcjPos = gcj;
      updateUserMarker(gcj);
      mapInstance.setView([gcj.lat, gcj.lng], 15);
      startWatching();
      checkVoiceTrigger(gcj);
    },
    (error) => { console.warn('定位失败:', error.message); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function updateUserMarker(pos) {
  if (userMarker) mapInstance.removeLayer(userMarker);
  userMarker = L.marker([pos.lat, pos.lng], {
    icon: L.divIcon({
      html: '<div style="background:#2196F3; width:20px; height:20px; border-radius:50%; border:2px solid white; box-shadow:0 0 8px rgba(0,0,0,0.3);"></div>',
      iconSize: [20,20]
    })
  }).addTo(mapInstance).bindPopup('我的位置').openPopup();
}

function startWatching() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const raw = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const gcj = wgs84ToGcj02(raw.lat, raw.lng);
      currentGcjPos = gcj;
      updateUserMarker(gcj);
      checkVoiceTrigger(gcj);
    },
    (err) => { console.warn('定位监听错误', err); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function checkVoiceTrigger(pos) {
  if (!voiceEnabled || !allPois.length) return;
  const today = new Date().toISOString().slice(0,10);
  const threshold = TRIGGER_RADIUS + GPS_ACCURACY_TOLERANCE;
  allPois.forEach(poi => {
    if (!poi.lat || !poi.lng) return;
    const dist = getDistance(pos.lat, pos.lng, poi.lat, poi.lng);
    if (dist <= threshold && lastTriggeredPoiIds[poi.id] !== today) {
      triggerVoice(poi);
      lastTriggeredPoiIds[poi.id] = today;
    }
  });
}

function triggerVoice(poi) {
  if (!voiceEnabled) return;
  cancelSpeech();
  if (poi.voice_mp3) {
    const audio = new Audio(poi.voice_mp3);
    audio.play().catch(() => playTTS(poi));
    return;
  }
  if (poi.voice_cn && poi.voice_cn.startsWith('http')) {
    const audio = new Audio(poi.voice_cn);
    audio.play().catch(() => playTTS(poi));
    return;
  }
  playTTS(poi);
}

function playTTS(poi) {
  const lang = 'zh-CN';
  let text = poi.voice_cn || poi.description || poi.name;
  if (text && text.startsWith('http')) text = poi.description || poi.name;
  if (!text) return;
  speak(text, lang);
}

export function setSimulatedPosition(lat, lng) {
  currentGcjPos = { lat, lng };
  if (simMarker) mapInstance.removeLayer(simMarker);
  simMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: '<div style="background:#FF5722; width:16px; height:16px; border-radius:50%; border:2px solid white; box-shadow:0 0 8px rgba(0,0,0,0.3);"></div>',
      iconSize: [16,16]
    })
  }).addTo(mapInstance).bindPopup('模拟位置').openPopup();
  checkVoiceTrigger({lat,lng});
  mapInstance.setView([lat, lng], 15);
}

export function getCurrentPosition() { return currentGcjPos; }
export function getMap() { return mapInstance; }
