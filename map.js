// map.js - 地图与定位
import { getPois } from './api.js';
import { wgs84ToGcj02, getDistance, speak, cancelSpeech } from './utils.js';
import { poiColors } from './config.js';

let map = null;
let userMarker = null;
let simMarker = null;
let poiMarkers = [];
let currentGcjPos = null;
let voiceEnabled = true;
let lastTriggeredPoiIds = {};
let watchId = null;
let currentAudio = null;
let allPois = [];
let currentFilterCategory = null;

export function initMap(containerId) {
  if (map) return map;
  map = L.map(containerId, { zoomControl: false }).setView([31.911705, 107.245033], 12);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    subdomains: ['1','2','3','4'],
    maxZoom: 18
  }).addTo(map);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  return map;
}

export function loadPoisToMap(pois) {
  allPois = pois;
  poiMarkers.forEach(m => map.removeLayer(m));
  poiMarkers = [];
  pois.forEach(p => {
    const cat = (p.category || '').split(',')[0] || '其他';
    const color = poiColors[cat] || '#999';
    const icon = L.divIcon({
      html: `<div style="background:${color}; width:20px; height:20px; border-radius:50%; border:2px solid white;"></div>`,
      iconSize: [20,20]
    });
    const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
    marker.poiData = p;
    // 绑定点击事件，调用全局函数
    marker.on('click', function() {
      if (window.showPoiDetail) {
        window.showPoiDetail(this.poiData);
      } else {
        console.warn('showPoiDetail not defined');
      }
    });
    poiMarkers.push(marker);
  });
  if (currentFilterCategory) applyFilter(currentFilterCategory);
}

export function applyFilter(category) {
  currentFilterCategory = category;
  poiMarkers.forEach(marker => {
    const poi = marker.poiData;
    if (!poi) return;
    const cats = (poi.category || '').split(',').map(c => c.trim());
    const match = cats.some(c => c === category);
    if (match) {
      if (!marker._icon) map.addLayer(marker);
      const color = { '餐饮住宿':'#FF9800', '交通枢纽':'#00BCD4', '游玩娱乐':'#FF5722', '特产购物':'#FFC107', '公共服务':'#607D8B' }[category] || '#999';
      marker.setIcon(L.divIcon({
        html: `<div style="background:${color}; width:30px; height:30px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 12px rgba(0,0,0,0.5);"></div>`,
        iconSize: [30,30]
      }));
    } else {
      if (marker._icon) map.removeLayer(marker);
    }
  });
}

export function clearFilter() {
  currentFilterCategory = null;
  poiMarkers.forEach(marker => {
    if (!marker._icon) map.addLayer(marker);
    const poi = marker.poiData;
    if (poi) {
      const cat = (poi.category || '').split(',')[0] || '其他';
      const color = poiColors[cat] || '#999';
      marker.setIcon(L.divIcon({
        html: `<div style="background:${color}; width:20px; height:20px; border-radius:50%; border:2px solid white;"></div>`,
        iconSize: [20,20]
      }));
    }
  });
}

export function locateUser() {
  if (!navigator.geolocation) {
    alert('您的浏览器不支持定位');
    return;
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0;
    silent.lang = 'zh-CN';
    speechSynthesis.speak(silent);
    setTimeout(() => speechSynthesis.cancel(), 100);
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const raw = { lat: position.coords.latitude, lng: position.coords.longitude };
      const gcj = wgs84ToGcj02(raw.lat, raw.lng);
      currentGcjPos = gcj;
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.marker([gcj.lat, gcj.lng], {
        icon: L.divIcon({
          html: '<div style="background:#2196F3; width:20px; height:20px; border-radius:50%; border:2px solid white; box-shadow:0 0 8px rgba(0,0,0,0.3);"></div>',
          iconSize: [20,20]
        })
      }).addTo(map).bindPopup('我的位置').openPopup();
      map.setView([gcj.lat, gcj.lng], 15);
      startWatching();
      checkVoiceTrigger(gcj.lat, gcj.lng);
    },
    (error) => { console.warn('定位失败:', error.message); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function startWatching() {
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const raw = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const gcj = wgs84ToGcj02(raw.lat, raw.lng);
      currentGcjPos = gcj;
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.marker([gcj.lat, gcj.lng], {
        icon: L.divIcon({
          html: '<div style="background:#2196F3; width:20px; height:20px; border-radius:50%; border:2px solid white; box-shadow:0 0 8px rgba(0,0,0,0.3);"></div>',
          iconSize: [20,20]
        })
      }).addTo(map);
      checkVoiceTrigger(gcj.lat, gcj.lng);
    },
    (err) => { console.warn('定位监听错误', err); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

export function setSimulatedPosition(lat, lng) {
  currentGcjPos = { lat, lng };
  if (simMarker) map.removeLayer(simMarker);
  simMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: '<div style="background:#FF5722; width:16px; height:16px; border-radius:50%; border:2px solid white; box-shadow:0 0 8px rgba(0,0,0,0.3);"></div>',
      iconSize: [16,16]
    })
  }).addTo(map).bindPopup('模拟位置').openPopup();
  checkVoiceTrigger(lat, lng);
  map.setView([lat, lng], 15);
}

function triggerVoice(poi) {
  if (!voiceEnabled) return;
  cancelSpeech();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (poi.voice_mp3) {
    const audio = new Audio(poi.voice_mp3);
    currentAudio = audio;
    audio.play().catch(() => speak(poi.voice_cn || poi.description || poi.name));
    return;
  }
  if (poi.voice_cn && poi.voice_cn.startsWith('http')) {
    const audio = new Audio(poi.voice_cn);
    currentAudio = audio;
    audio.play().catch(() => speak(poi.voice_cn || poi.description || poi.name));
    return;
  }
  speak(poi.voice_cn || poi.description || poi.name);
}

function checkVoiceTrigger(userLat, userLng) {
  if (!voiceEnabled || !allPois.length) return;
  const today = new Date().toISOString().slice(0,10);
  const threshold = 30 + 10;
  allPois.forEach(poi => {
    if (!poi.lat || !poi.lng) return;
    const dist = getDistance(userLat, userLng, poi.lat, poi.lng);
    if (dist <= threshold && lastTriggeredPoiIds[poi.id] !== today) {
      triggerVoice(poi);
      lastTriggeredPoiIds[poi.id] = today;
    }
  });
}

export function setVoiceEnabled(enabled) {
  voiceEnabled = enabled;
  if (!enabled) {
    cancelSpeech();
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  }
}

export function getCurrentPosition() {
  return currentGcjPos;
}

export function getPoiById(id) {
  return allPois.find(p => p.id == id);
}

export function getAllPois() {
  return allPois;
}
