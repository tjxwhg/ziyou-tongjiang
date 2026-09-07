// js/trip-planner.js - 行程规划核心（完整版）
import { getPois, saveTripSolution, getUserTripSolutions, getTransportPresets } from './api.js';
import { getCurrentUser } from './auth.js';
import { formatTime, fetchWeatherForecast, getDayWeatherTip } from './utils.js';
import { simulatedAnnealing, checkHardConstraints } from './simulated-annealing.js';
import { POI_CATEGORIES, DAY_START, DAY_END } from './config.js';
import { getAllPois } from './map.js';

// ============================================================
// 状态
// ============================================================
let currentSolutions = [];
let selectedSolutionIndex = -1;
let currentTripData = null;

// ============================================================
// 初始化规划面板
// ============================================================
export function initPlanPanel() {
    initTimeSelectors();
    initPreferenceTags();
    loadSavedSolutions();
}

function initTimeSelectors() {
    const sel = document.getElementById('planStartTime');
    if (!sel) return;
    sel.innerHTML = '';
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 10) {
            const val = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
            sel.innerHTML += `<option value="${val}">${val}</option>`;
        }
    }
    const now = new Date();
    let h = now.getHours(), m = Math.floor(now.getMinutes() / 10) * 10;
    if (m === 60) { m = 0; h = (h + 1) % 24; }
    sel.value = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    const dateInput = document.getElementById('planStartDate');
    if (dateInput) dateInput.value = now.toISOString().slice(0, 10);
}

function initPreferenceTags() {
    const prefCategories = ['自然景区', '人文历史', '民俗风情', '景观地标', '游玩娱乐', '购物消费'];
    const catContainer = document.getElementById('prefCategories');
    if (catContainer) {
        catContainer.innerHTML = prefCategories.map(c =>
            `<span class="pref-tag" data-value="${c}">${c}</span>`
        ).join('');
        catContainer.querySelectorAll('.pref-tag').forEach(el => {
            el.addEventListener('click', () => el.classList.toggle('active'));
        });
    }
    const settingsCat = document.getElementById('settingsCategories');
    if (settingsCat) {
        settingsCat.innerHTML = prefCategories.map(c =>
            `<span class="pref-tag" data-value="${c}">${c}</span>`
        ).join('');
        settingsCat.querySelectorAll('.pref-tag').forEach(el => {
            el.addEventListener('click', () => el.classList.toggle('active'));
        });
    }
    const cuisines = ['川菜', '火锅', '小吃', '家常', '简餐'];
    document.querySelectorAll('#prefCuisine .pref-tag, #settingsCuisine .pref-tag').forEach(el => {
        el.addEventListener('click', () => el.classList.toggle('active'));
    });
    loadPreferencesToUI();
}

async function loadPreferencesToUI() {
    const user = await getCurrentUser();
    if (!user) return;
    try {
        const { getUserPreferences } = await import('./api.js');
        const prefs = await getUserPreferences(user.id);
        if (prefs) {
            const cats = prefs.preferred_categories || [];
            document.querySelectorAll('#prefCategories .pref-tag, #settingsCategories .pref-tag').forEach(el => {
                if (cats.includes(el.dataset.value)) el.classList.add('active');
            });
            const cuisines = prefs.cuisine_prefs || [];
            document.querySelectorAll('#prefCuisine .pref-tag, #settingsCuisine .pref-tag').forEach(el => {
                if (cuisines.includes(el.dataset.value)) el.classList.add('active');
            });
            const paceSelect = document.getElementById('settingsPace');
            if (paceSelect && prefs.pace) paceSelect.value = prefs.pace;
        }
    } catch (e) { console.warn('加载偏好失败:', e); }
}

// ============================================================
// 加载POI选择列表
// ============================================================
export function loadPoiListForSelection(pois) {
    const container = document.getElementById('poiSelectContainer');
    if (!container) return;
    if (!pois || pois.length === 0) {
        container.innerHTML = '<div class="text-secondary text-center py-2">暂无景点数据</div>';
        return;
    }
    const sorted = [...pois].sort((a, b) => a.name.localeCompare(b.name));
    let html = '';
    sorted.forEach(p => {
        const category = p.category ? p.category.split(',')[0] : '未分类';
        html += `
            <div class="poi-select-item">
                <input type="checkbox" value="${p.id}" id="poi-chk-${p.id}" data-category="${category}">
                <label for="poi-chk-${p.id}" style="flex:1;cursor:pointer;">
                    <span class="badge bg-secondary" style="font-size:10px;">${category}</span>
                    ${p.name}
                </label>
            </div>
        `;
    });
    container.innerHTML = html;
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', updateSelectedCount);
    });
    updateSelectedCount();
}

function updateSelectedCount() {
    const checked = document.querySelectorAll('#poiSelectContainer input:checked').length;
    const el = document.getElementById('selectedPoiCount');
    if (el) el.textContent = `已选 ${checked} 个`;
}

export function selectAllPois(select) {
    document.querySelectorAll('#poiSelectContainer input[type="checkbox"]').forEach(cb => {
        cb.checked = select;
    });
    updateSelectedCount();
}

// ============================================================
// 生成行程方案
// ============================================================
export async function generatePlans() {
    const loadingEl = document.getElementById('planLoading');
    const stepPrefs = document.getElementById('stepPreferences');
    const stepCompare = document.getElementById('stepCompare');

    const startDate = document.getElementById('planStartDate').value;
    const startTime = document.getElementById('planStartTime').value;
    const days = parseInt(document.getElementById('planDays').value);
    const style = document.getElementById('planStyle').value;

    if (!startDate) { alert('请选择出发日期'); return; }

    const selectedIds = [];
    document.querySelectorAll('#poiSelectContainer input:checked').forEach(cb => {
        selectedIds.push(cb.value);
    });
    if (selectedIds.length === 0) { alert('请至少选择一个景点'); return; }

    let allPois = window.__allPois || [];
    if (!allPois || allPois.length === 0) {
        allPois = getAllPois();
    }
    if (!allPois || allPois.length === 0) {
        try {
            allPois = await getPois();
            window.__allPois = allPois;
        } catch (e) {
            alert('无法获取景点数据，请刷新重试');
            return;
        }
    }

    const selectedPois = allPois.filter(p => selectedIds.includes(p.id));
    if (selectedPois.length === 0) {
        alert('未找到选中的景点数据，请重新选择');
        return;
    }

    const selectedCats = [];
    document.querySelectorAll('#prefCategories .pref-tag.active').forEach(el => {
        selectedCats.push(el.dataset.value);
    });

    const user = await getCurrentUser();
    const userPref = {
        preferred_categories: selectedCats,
        cuisine_prefs: [],
        pace: style
    };

    const presets = await getTransportPresets();
    const travelTimes = {};
    presets.forEach(p => {
        travelTimes[`${p.from_poi_id}_${p.to_poi_id}`] = p.time_min;
    });

    const openTimes = {}, closeTimes = {};
    selectedPois.forEach(p => {
        openTimes[p.id] = p.open_time ? timeToMinutes(p.open_time) : DAY_START;
        closeTimes[p.id] = p.close_time ? timeToMinutes(p.close_time) : DAY_END;
    });

    const constraints = {
        open_times: openTimes,
        close_times: closeTimes,
        travel_times: travelTimes,
        day_start: DAY_START,
        day_end: DAY_END,
        max_days: days,
        lodging_required: true
    };

    stepPrefs.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    try {
        const result = simulatedAnnealing(selectedPois, constraints, userPref, style);
        
        if (!result || !result.sequence || result.sequence.length === 0) {
            alert('无法生成有效的行程方案，请调整选择');
            loadingEl.classList.add('hidden');
            stepPrefs.classList.remove('hidden');
            return;
        }

        const solutionData = buildSolutionData(result, selectedPois, constraints, startDate, startTime);
        currentSolutions = [{
            style: style,
            data: solutionData,
            score: result.score,
            sequence: result.sequence
        }];
        selectedSolutionIndex = -1;

        renderSolutions(currentSolutions);
        loadingEl.classList.add('hidden');
        stepCompare.classList.remove('hidden');

    } catch (error) {
        console.error('生成方案失败:', error);
        alert('生成方案失败：' + error.message);
        loadingEl.classList.add('hidden');
        stepPrefs.classList.remove('hidden');
    }
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function buildSolutionData(result, poiList, constraints, startDate, startTime) {
    const { sequence, durations } = result;
    const days = [];
    let currentDay = 1;
    let currentTime = timeToMinutes(startTime) || DAY_START;
    let dayNodes = [];
    let lastPoiId = 'county';

    for (let i = 0; i < sequence.length; i++) {
        const poiId = sequence[i];
        const poi = poiList.find(p => p.id === poiId);
        if (!poi) continue;

        const travelKey = `${lastPoiId}_${poiId}`;
        const travel = constraints.travel_times[travelKey] || 0;
        const duration = durations[poiId] || 30;

        if (currentTime + travel + duration > DAY_END) {
            if (dayNodes.length > 0) {
                days.push({ day: currentDay, date: startDate, nodes: dayNodes });
                dayNodes = [];
            }
            currentDay++;
            currentTime = DAY_START;
            lastPoiId = 'county';
            const newTravel = constraints.travel_times[`${lastPoiId}_${poiId}`] || 0;
            currentTime += newTravel;
        } else {
            currentTime += travel;
        }

        dayNodes.push({
            poi_id: poiId,
            poi_name: poi.name,
            arrival_time: formatTime(currentTime),
            departure_time: formatTime(currentTime + duration),
            duration: duration,
            travel_from: lastPoiId,
            travel_time: travel
        });

        currentTime += duration;
        lastPoiId = poiId;
    }

    if (dayNodes.length > 0) {
        days.push({ day: currentDay, date: startDate, nodes: dayNodes });
    }

    return {
        start_date: startDate,
        start_time: startTime,
        days: days,
        total_days: days.length,
        total_pois: sequence.length,
        total_duration: Object.values(durations).reduce((a, b) => a + b, 0)
    };
}

// ============================================================
// 渲染方案
// ============================================================
function renderSolutions(solutions) {
    const container = document.getElementById('solutionCompareContainer');
    if (!container) return;

    const styleLabels = {
        compact: { label: '紧凑型', badge: 'badge-compact', icon: '🚀' },
        relaxed: { label: '舒适型', badge: 'badge-relaxed', icon: '🌿' },
        indepth: { label: '深度游', badge: 'badge-indepth', icon: '🔍' }
    };

    let html = '';
    solutions.forEach((sol, idx) => {
        const info = styleLabels[sol.style] || styleLabels.relaxed;
        const data = sol.data || {};
        html += `
            <div class="solution-card" onclick="window.selectSolutionCard(${idx})" id="sol-card-${idx}">
                <div class="badge-style ${info.badge}">${info.icon} ${info.label}</div>
                <div class="stat-row"><span>📅 天数</span><span>${data.total_days || 0} 天</span></div>
                <div class="stat-row"><span>📍 景点</span><span>${data.total_pois || 0} 个</span></div>
                <div class="stat-row"><span>⏱️ 游览总时长</span><span>${Math.round((data.total_duration || 0)/60)} 小时</span></div>
                <div class="stat-row"><span>📊 评分</span><span>${sol.score ? (sol.score*100).toFixed(0) : '--'}%</span></div>
                <button class="btn btn-sm btn-outline-custom mt-2 w-100" onclick="event.stopPropagation(); window.previewSolution(${idx})">
                    <i class="fas fa-eye"></i> 预览详情
                </button>
            </div>
        `;
    });
    container.innerHTML = html;
    document.getElementById('selectSolutionBtn').disabled = true;
}

// ============================================================
// 方案操作
// ============================================================
export function selectSolutionCard(idx) {
    document.querySelectorAll('.solution-card').forEach(el => el.classList.remove('selected'));
    const card = document.getElementById(`sol-card-${idx}`);
    if (card) card.classList.add('selected');
    selectedSolutionIndex = idx;
    document.getElementById('selectSolutionBtn').disabled = false;
}

export function previewSolution(idx) {
    const sol = currentSolutions[idx];
    if (!sol) return;
    const data = sol.data || {};
    let msg = `📋 ${sol.style === 'compact' ? '紧凑型' : sol.style === 'relaxed' ? '舒适型' : '深度游'} 方案\n`;
    msg += `📅 ${data.total_days || 0} 天 | 📍 ${data.total_pois || 0} 个景点\n\n`;
    if (data.days) {
        data.days.forEach(day => {
            msg += `--- 第${day.day}天 ---\n`;
            if (day.nodes) {
                day.nodes.forEach(node => {
                    msg += `  ${node.arrival_time} - ${node.departure_time} ${node.poi_name}\n`;
                });
            }
            msg += '\n';
        });
    }
    alert(msg);
}

export function backToPreferences() {
    document.getElementById('stepCompare').classList.add('hidden');
    document.getElementById('stepDetail').classList.add('hidden');
    document.getElementById('stepPreferences').classList.remove('hidden');
    selectedSolutionIndex = -1;
    currentSolutions = [];
}

export function backToCompare() {
    document.getElementById('stepDetail').classList.add('hidden');
    document.getElementById('stepCompare').classList.remove('hidden');
}

export async function selectSolution() {
    if (selectedSolutionIndex < 0 || selectedSolutionIndex >= currentSolutions.length) {
        alert('请先选择一个方案');
        return;
    }
    const sol = currentSolutions[selectedSolutionIndex];
    const user = await getCurrentUser();
    try {
        if (user) {
            await saveTripSolution(user.id, sol.data, sol.style, sol.score);
        }
        currentTripData = sol.data;
        showTripDetail(sol.data);
        document.getElementById('stepCompare').classList.add('hidden');
        document.getElementById('stepDetail').classList.remove('hidden');
    } catch (error) {
        console.error('保存方案失败:', error);
        alert('保存方案失败：' + error.message);
    }
}

export function showTripDetail(data) {
    const container = document.getElementById('tripDetailContainer');
    if (!container) return;
    let html = '';
    if (data.days) {
        data.days.forEach(day => {
            html += `<div class="day-block"><div class="day-title">📅 第${day.day}天</div>`;
            if (day.nodes) {
                day.nodes.forEach(node => {
                    html += `
                        <div class="node-item">
                            <span class="node-time">${node.arrival_time} - ${node.departure_time}</span>
                            <span class="node-icon"><i class="fas fa-map-pin"></i></span>
                            <span>${node.poi_name}</span>
                        </div>
                    `;
                });
            }
            html += `</div>`;
        });
    }
    html += `
        <div class="card-modern mt-2">
            <div class="card-title">📊 行程摘要</div>
            <div class="stat-row"><span>总天数</span><span>${data.total_days || 0} 天</span></div>
            <div class="stat-row"><span>景点数</span><span>${data.total_pois || 0} 个</span></div>
            <div class="stat-row"><span>游览总时长</span><span>${Math.round((data.total_duration || 0)/60)} 小时</span></div>
        </div>
    `;
    container.innerHTML = html;
}

// ============================================================
// 保存与导航
// ============================================================
export async function saveTripSolution() {
    if (!currentTripData) { alert('没有可保存的行程'); return; }
    const user = await getCurrentUser();
    if (!user) { alert('请先登录'); return; }
    try {
        await saveTripSolution(user.id, currentTripData, 'custom', 0);
        alert('行程已保存');
        const { renderMyTrips } = await import('./user.js');
        renderMyTrips();
    } catch (error) { alert('保存失败：' + error.message); }
}

export function startNavigation() {
    if (!currentTripData) { alert('没有可导航的行程'); return; }
    document.getElementById('navPanel').classList.add('active');
    import('./trip-executor.js').then(module => {
        module.initNavigation(currentTripData);
    });
}

export function endNavigation() {
    document.getElementById('navPanel').classList.remove('active');
    import('./trip-executor.js').then(module => {
        module.stopNavigation();
    });
}

// ============================================================
// 偏好保存
// ============================================================
export async function savePreferences() {
    const user = await getCurrentUser();
    if (!user) { alert('请先登录'); return; }
    const selectedCats = [];
    document.querySelectorAll('#settingsCategories .pref-tag.active').forEach(el => {
        selectedCats.push(el.dataset.value);
    });
    const selectedCuisine = [];
    document.querySelectorAll('#settingsCuisine .pref-tag.active').forEach(el => {
        selectedCuisine.push(el.dataset.value);
    });
    const pace = document.getElementById('settingsPace').value;
    try {
        const { saveUserPreferences } = await import('./api.js');
        await saveUserPreferences({ user_id: user.id, preferred_categories: selectedCats, cuisine_prefs: selectedCuisine, pace: pace, updated_at: new Date().toISOString() });
        alert('偏好已保存');
    } catch (error) { alert('保存失败：' + error.message); }
}

// ============================================================
// 加载已保存方案
// ============================================================
async function loadSavedSolutions() {
    const user = await getCurrentUser();
    if (!user) return;
    try {
        const solutions = await getUserTripSolutions(user.id);
        console.log('已保存行程:', solutions.length);
    } catch (e) { console.warn('加载已保存方案失败:', e); }
}
