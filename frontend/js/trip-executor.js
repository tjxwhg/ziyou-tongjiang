// js/trip-executor.js - 实时导航引擎
import { reportDeviation } from './api.js';
import { getCurrentUser } from './auth.js';
import { formatTime, getDistance, speak } from './utils.js';
import { getAllPois } from './map.js';

let navData = null;
let navInterval = null;
let currentNodeIndex = 0;
let isNavigating = false;
let deviationCounter = 0;
let watchId = null;
let currentPosition = null;
const DEVIATION_THRESHOLD = 15;
const REPORT_INTERVAL = 60000;

export function initNavigation(tripData) {
    navData = tripData;
    currentNodeIndex = 0;
    isNavigating = true;
    deviationCounter = 0;
    startGpsTracking();
    renderNavStatus();
    if (navInterval) clearInterval(navInterval);
    navInterval = setInterval(reportProgress, REPORT_INTERVAL);
}

export function stopNavigation() {
    isNavigating = false;
    if (navInterval) { clearInterval(navInterval); navInterval = null; }
    stopGpsTracking();
    navData = null;
    document.getElementById('navContent').innerHTML = `
        <div class="text-center text-secondary py-4">
            <i class="fas fa-map-pin fa-2x mb-2"></i>
            <p>导航已结束</p>
            <button class="btn btn-primary-custom" onclick="window.closePanel('navPanel')">关闭</button>
        </div>
    `;
}

function startGpsTracking() {
    if (!navigator.geolocation) return;
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            currentPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
            checkProximity();
        },
        (err) => console.warn('GPS错误:', err),
        { enableHighAccuracy: true, maximumAge: 10000 }
    );
}

function stopGpsTracking() {
    if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

function checkProximity() {
    if (!navData || !currentPosition || !isNavigating) return;
    const allPois = getAllPois();
    const days = navData.days || [];
    for (let day of days) {
        if (!day.nodes) continue;
        for (let node of day.nodes) {
            if (node.completed) continue;
            const poi = allPois.find(p => p.id === node.poi_id);
            if (poi) {
                const dist = getDistance(currentPosition.lat, currentPosition.lng, poi.lat, poi.lng);
                if (dist < 50) {
                    speak(`已到达 ${poi.name}`);
                    node.completed = true;
                    renderNavStatus();
                    break;
                }
            }
        }
    }
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
        await reportDeviation({
            tripId: 'current',
            currentPoiId: getCurrentPoiId(),
            actualTime: Date.now(),
            gps: currentPosition
        });
    } catch (e) { console.warn('上报偏差失败:', e); }
    updateNavUI(progress);
}

function calculateProgress() {
    if (!navData) return 0;
    const days = navData.days || [];
    let totalNodes = 0, completedNodes = 0;
    for (let day of days) {
        if (!day.nodes) continue;
        totalNodes += day.nodes.length;
        for (let node of day.nodes) if (node.completed) completedNodes++;
    }
    return totalNodes > 0 ? (completedNodes / totalNodes) * 100 : 0;
}

function calculateDeviation() { return 0; }

function getCurrentPoiId() {
    const days = navData.days || [];
    for (let day of days) {
        if (!day.nodes) continue;
        for (let node of day.nodes) {
            if (!node.completed) return node.poi_id || null;
        }
    }
    return null;
}

async function triggerReplan(deviation) {
    try {
        const result = await reportDeviation({
            tripId: 'current',
            currentPoiId: getCurrentPoiId(),
            actualTime: Date.now(),
            gps: currentPosition,
            forceReplan: true
        });
        if (result.adjusted && result.solution) {
            navData = result.solution;
            alert('行程已自动调整，请查看最新安排');
            renderNavStatus();
        }
    } catch (e) { console.warn('重规划失败:', e); }
}

function renderNavStatus() {
    const timeline = document.getElementById('navTimeline');
    if (!timeline) return;
    let html = '';
    const days = navData.days || [];
    days.forEach(day => {
        html += `<div class="day-block"><div class="day-title">📅 第${day.day}天</div>`;
        if (day.nodes) {
            day.nodes.forEach((node, idx) => {
                const isCurrent = !node.completed && idx === currentNodeIndex;
                html += `
                    <div class="node-item ${isCurrent ? 'fw-bold text-green' : ''}" id="nav-node-${idx}">
                        <span class="node-time">${node.arrival_time || '--'}</span>
                        <span class="node-icon"><i class="fas ${isCurrent ? 'fa-location-dot' : 'fa-circle'}"></i></span>
                        <span>${node.poi_name || '未命名'}</span>
                        ${node.completed ? ' <span class="badge bg-success">✓</span>' : ''}
                    </div>
                `;
            });
        }
        html += `</div>`;
    });
    timeline.innerHTML = html;
    updateNavUI(0);
}

function updateNavUI(progress) {
    const bar = document.getElementById('navProgressBar');
    const text = document.getElementById('navProgressText');
    if (bar) bar.style.width = progress + '%';
    if (text) text.textContent = Math.round(progress) + '%';
}

export function getNavigationStatus() {
    return {
        isNavigating: isNavigating,
        progress: calculateProgress(),
        currentPoiId: getCurrentPoiId()
    };
}
