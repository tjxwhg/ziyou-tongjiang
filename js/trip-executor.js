// js/trip-executor.js - 实时导航引擎
// 注：D3（到达 POI 判定）已禁用（2026-10-16），因导航功能未上线。
//     待接入真实导航 SDK 后再重新设计。
import { saveDeviationRecord } from './api.js';
import { getCurrentUser } from './auth.js';
import { getDistance, timeToMinutes, speak } from './utils.js';
import { getAllPois } from './map.js';

let navData = null;
let navInterval = null;
let currentNodeIndex = 0;
let isNavigating = false;
let deviationCounter = 0;
let currentPosition = null;
let watchId = null;
let navStartTime = null;

const DEVIATION_THRESHOLD = 15;
const REPORT_INTERVAL = 60000;

// ⏸️ D3 禁用开关（保留以便未来启用）
const D3_ARRIVAL_ENABLED = false;
const D3_ARRIVAL_RADIUS = 50;   // 米

export function initNavigation(tripData) {
    navData = tripData;
    currentNodeIndex = 0;
    isNavigating = true;
    deviationCounter = 0;
    navStartTime = nowMinutes();
    startGpsTracking();
    renderNavStatus();
    if (navInterval) clearInterval(navInterval);
    navInterval = setInterval(reportProgress, REPORT_INTERVAL);
}

export function startNavigation(tripData) {
    if (!tripData) {
        alert('没有可导航的行程');
        return;
    }
    initNavigation(tripData);
}

export function stopNavigation() {
    isNavigating = false;
    if (navInterval) { clearInterval(navInterval); navInterval = null; }
    stopGpsTracking();
    navData = null;
    const content = document.getElementById('navContent');
    if (content) {
        content.innerHTML = `
            <div class="text-center text-secondary py-4">
                <i class="fas fa-map-pin fa-2x mb-2"></i>
                <p>导航已结束</p>
                <button class="btn btn-primary-custom" onclick="window.closePanel('navPanel')">关闭</button>
            </div>
        `;
    }
}

export function endNavigation() {
    stopNavigation();
}

function nowMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

function startGpsTracking() {
    if (!navigator.geolocation) return;
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            currentPosition = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            };
            // ⏸️ D3 已禁用：不调用 checkProximity()
            // checkProximity();
            advanceToNextNode();
            updateNavUI(calculateProgress());
        },
        (err) => console.warn('GPS错误:', err),
        { enableHighAccuracy: true, maximumAge: 10000 }
    );
}

function stopGpsTracking() {
    if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

// ⏸️ D3 禁用：到达 POI 判定（保留以便未来启用）
// 启用条件：接入真实导航 SDK 后，重新设计 GPS 定位 + 到达判定逻辑
function checkProximity() {
    if (!D3_ARRIVAL_ENABLED) return;   // ★ 禁用开关
    if (!navData || !currentPosition || !isNavigating) return;
    if (currentPosition.accuracy && currentPosition.accuracy > 100) return;
    const allPois = getAllPois();
    const days = navData.days || [];
    for (let day of days) {
        if (!day.nodes) continue;
        for (let node of day.nodes) {
            if (node.poi_id && !node.completed) {
                const poi = allPois.find(p => String(p.id) === String(node.poi_id));
                if (poi) {
                    const dist = getDistance(currentPosition.lat, currentPosition.lng, poi.lat, poi.lng);
                    if (dist < D3_ARRIVAL_RADIUS) {
                        node.completed = true;
                        triggerArrivalAlert(poi, node);
                        break;
                    }
                }
            }
        }
    }
}

function advanceToNextNode() {
    if (!navData || !navData.days) return;
    for (const day of navData.days) {
        if (!day.nodes) continue;
        const idx = day.nodes.findIndex(n => n.type === 'visit' && !n.completed);
        if (idx >= 0) {
            currentNodeIndex = idx;
            return;
        }
    }
}

function triggerArrivalAlert(poi, node) {
    speak(`已到达 ${poi.name}，建议停留 ${node.duration || 30} 分钟`);
}

async function reportProgress() {
    if (!navData || !isNavigating) return;
    const user = await getCurrentUser();
    if (!user) return;

    const progress = calculateProgress();
    const deviation = calculateDeviation();

    if (Math.abs(deviation) > DEVIATION_THRESHOLD) {
        deviationCounter++;
        if (deviationCounter >= 2) {
            await triggerReplan(deviation);
            deviationCounter = 0;
        }
    } else {
        deviationCounter = 0;
    }

    try {
        await saveDeviationRecord('current', deviation, 'time_deviation', null);
    } catch (e) { console.warn('上报偏差失败:', e); }

    updateNavUI(progress);
}

function calculateProgress() {
    if (!navData) return 0;
    const days = navData.days || [];
    let totalNodes = 0, completedNodes = 0;
    for (let day of days) {
        if (!day.nodes) continue;
        for (let node of day.nodes) {
            if (node.type !== 'visit') continue;
            totalNodes++;
            if (node.completed) completedNodes++;
        }
    }
    return totalNodes > 0 ? (completedNodes / totalNodes) * 100 : 0;
}

function calculateDeviation() {
    if (!navData || !navStartTime) return 0;
    const days = navData.days || [];
    for (const day of days) {
        if (!day.nodes) continue;
        for (const node of day.nodes) {
            if (node.type === 'visit' && !node.completed && node.startTime !== undefined) {
                const planned = navStartTime + (node.startTime - (navData.days[0]?.nodes?.[0]?.startTime || node.startTime));
                return nowMinutes() - planned;
            }
        }
    }
    return 0;
}

function getCurrentPoiId() {
    const days = navData.days || [];
    for (let day of days) {
        if (!day.nodes) continue;
        for (let node of day.nodes) {
            if (!node.completed && node.type === 'visit') return node.poi_id || null;
        }
    }
    return null;
}

async function triggerReplan(deviation) {
    try {
        await saveDeviationRecord('current', deviation, 'replan_triggered', null);
        alert('行程已自动调整，请查看最新安排');
    } catch (e) { console.warn('重规划失败:', e); }
}

function renderNavStatus() {
    const timeline = document.getElementById('navTimeline');
    if (!timeline) return;
    let html = '';
    const days = navData.days || [];
    days.forEach(day => {
        html += `<div class="day-block">`;
        html += `<div class="day-title">📅 第${day.day}天</div>`;
        if (day.nodes) {
            day.nodes.forEach((node, idx) => {
                if (node.type !== 'visit') return;
                const isCurrent = idx === currentNodeIndex;
                html += `
                    <div class="node-item ${isCurrent ? 'fw-bold text-green' : ''}" id="nav-node-${idx}">
                        <span class="node-time">${node.startTime !== undefined ? formatTime(node.startTime) : '--'}</span>
                        <span class="node-icon"><i class="fas ${isCurrent ? 'fa-location-dot' : 'fa-circle'}"></i></span>
                        <span>${node.poiName || node.name || '未命名'}</span>
                        ${node.completed ? ' <span class="badge bg-success">✓</span>' : ''}
                    </div>
                `;
            });
        }
        html += `</div>`;
    });
    timeline.innerHTML = html;
    updateNavUI(calculateProgress());
}

function updateNavUI(progress) {
    const bar = document.getElementById('navProgressBar');
    const text = document.getElementById('navProgressText');
    if (bar) bar.style.width = progress + '%';
    if (text) text.textContent = Math.round(progress) + '%';
}

function formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
