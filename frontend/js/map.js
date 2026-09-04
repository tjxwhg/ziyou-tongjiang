// js/map.js - 地图核心
import { getPois, getPoiInternal } from './api.js';
import { wgs84ToGcj02, getDistance, speak, cancelSpeech, formatTime } from './utils.js';
import { poiColors } from './config.js';

let map = null;
let userMarker = null;
let poiMarkers = [];
let allPois = [];
let currentGcjPos = null;
let voiceEnabled = true;
let lastTriggeredPoiIds = {};
let watchId = null;
let currentAudio = null;
let currentFilterCategory = null;
let internalPathLayer = null;
let selectedPoiId = null;

// ============================================================
// 地图初始化
// ============================================================
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

// ============================================================
// POI加载
// ============================================================
export function loadPoisToMap(pois) {
    allPois = pois;
    poiMarkers.forEach(m => map.removeLayer(m));
    poiMarkers = [];
    pois.forEach(p => {
        const cat = (p.category || '').split(',')[0] || '其他';
        const color = poiColors[cat] || '#999';
        const icon = L.divIcon({
            html: `<div style="background:${color}; width:24px; height:24px; border-radius:50%; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.2); display:flex; align-items:center; justify-content:center; font-size:12px; color:white; font-weight:bold;">${p.name.charAt(0)}</div>`,
            iconSize: [24, 24],
            className: 'poi-marker'
        });
        const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
        marker.poiData = p;
        marker.on('click', function() {
            if (window.showPoiDetail) {
                window.showPoiDetail(this.poiData);
            }
            showPoiInternal(this.poiData.id);
        });
        poiMarkers.push(marker);
    });
    if (currentFilterCategory) applyFilter(currentFilterCategory);
}

// ============================================================
// 内部路网展示
// ============================================================
export async function showPoiInternal(poiId) {
    if (internalPathLayer) {
        map.removeLayer(internalPathLayer);
        internalPathLayer = null;
    }
    try {
        const data = await getPoiInternal(poiId);
        if (!data || !data.nodes || data.nodes.length === 0) {
            console.log('该POI暂无内部路网数据');
            return;
        }
        const nodeLayer = L.layerGroup();
        data.nodes.forEach(node => {
            const color = node.node_type === 'entrance' ? '#2E7D32' :
                          node.node_type === 'exit' ? '#c62828' :
                          node.node_type === 'core_view' ? '#1565C0' :
                          node.node_type === 'rest_area' ? '#FF6F00' :
                          node.node_type === 'wc' ? '#00838F' :
                          '#999';
            const icon = L.divIcon({
                html: `<div style="background:${color}; width:16px; height:16px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
                iconSize: [16, 16]
            });
            const marker = L.marker([node.lat, node.lng], { icon }).addTo(nodeLayer);
            marker.bindPopup(`
                <b>${node.node_name}</b><br>
                类型: ${node.node_type}<br>
                建议停留: ${node.suggested_duration_min}-${node.suggested_duration_max}分钟
                ${node.audio_mp3 ? '<br><audio controls src="'+node.audio_mp3+'"></audio>' : ''}
            `);
        });
        if (data.edges && data.edges.length > 0) {
            data.edges.forEach(edge => {
                const fromNode = data.nodes.find(n => n.id === edge.from_node_id);
                const toNode = data.nodes.find(n => n.id === edge.to_node_id);
                if (fromNode && toNode) {
                    const latlngs = [[fromNode.lat, fromNode.lng], [toNode.lat, toNode.lng]];
                    L.polyline(latlngs, {
                        color: '#1565C0',
                        weight: 2,
                        opacity: 0.5,
                        dashArray: '5,5'
                    }).addTo(nodeLayer);
                }
            });
        }
        internalPathLayer = nodeLayer;
        map.addLayer(nodeLayer);
        const poi = allPois.find(p => p.id === poiId);
        if (poi) map.setView([poi.lat, poi.lng], 16);
    } catch (error) {
        console.warn('加载内部路网失败:', error);
    }
}

// ============================================================
// 分类筛选
// ============================================================
export function applyFilter(category) {
    currentFilterCategory = category;
    poiMarkers.forEach(marker => {
        const poi = marker.poiData;
        if (!poi) return;
        const cats = (poi.category || '').split(',').map(c => c.trim());
        const match = cats.some(c => c === category);
        if (match) {
            if (!marker._icon) map.addLayer(marker);
            const color = poiColors[category] || '#999';
            marker.setIcon(L.divIcon({
                html: `<div style="background:${color}; width:32px; height:32px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 16px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; font-size:14px; color:white; font-weight:bold;">${poi.name.charAt(0)}</div>`,
                iconSize: [32, 32]
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
                html: `<div style="background:${color}; width:24px; height:24px; border-radius:50%; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.2); display:flex; align-items:center; justify-content:center; font-size:12px; color:white; font-weight:bold;">${poi.name.charAt(0)}</div>`,
                iconSize: [24, 24]
            }));
        }
    });
}

// ============================================================
// 定位
// ============================================================
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
                    html: '<div style="background:#2196F3; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 12px rgba(33,150,243,0.5);"></div>',
                    iconSize: [20, 20]
                })
            }).addTo(map).bindPopup('我的位置').openPopup();
            map.setView([gcj.lat, gcj.lng], 15);
            startWatching();
        },
        (error) => console.warn('定位失败:', error.message),
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
                    html: '<div style="background:#2196F3; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 12px rgba(33,150,243,0.5);"></div>',
                    iconSize: [20, 20]
                })
            }).addTo(map);
            checkVoiceTrigger(gcj.lat, gcj.lng);
        },
        (err) => console.warn('定位监听错误', err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

function checkVoiceTrigger(lat, lng) {
    if (!voiceEnabled || !allPois.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const threshold = 40;
    allPois.forEach(poi => {
        if (!poi.lat || !poi.lng) return;
        const dist = getDistance(lat, lng, poi.lat, poi.lng);
        if (dist <= threshold && lastTriggeredPoiIds[poi.id] !== today) {
            triggerVoice(poi);
            lastTriggeredPoiIds[poi.id] = today;
        }
    });
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
    speak(poi.voice_cn || poi.description || poi.name);
}

// ============================================================
// 工具函数
// ============================================================
export function setVoiceEnabled(enabled) {
    voiceEnabled = enabled;
    if (!enabled) {
        cancelSpeech();
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    }
}

export function getAllPois() {
    return allPois;
}

export function getPoiById(id) {
    return allPois.find(p => p.id == id);
}

export function getCurrentPosition() {
    return currentGcjPos;
}
