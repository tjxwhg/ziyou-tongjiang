// js/trip-planner.js - 行程规划核心
import { generatePlans as apiGeneratePlans, selectPlan as apiSelectPlan, saveTripSolution as apiSaveTripSolution, getUserTripSolutions } from './api.js';
import { getCurrentUser } from './auth.js';
import { formatTime, getDayWeatherTip } from './utils.js';
import { POI_CATEGORIES, DAY_START, DAY_END } from './config.js';

// ============================================================
// 状态
// ============================================================
let currentSolutions = [];
let selectedSolutionIndex = -1;
let currentTripData = null;
let preferencesLoaded = false;

// 偏好标签状态
let selectedCategories = [];
let selectedCuisine = [];

// ============================================================
// 初始化
// ============================================================
export function initPlanPanel() {
    // 初始化时间选择器
    initTimeSelectors();
    // 初始化偏好标签
    initPreferenceTags();
    // 加载已保存的方案
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
    let h = now.getHours(),
        m = Math.floor(now.getMinutes() / 10) * 10;
    if (m === 60) { m = 0;
        h = (h + 1) % 24; }
    sel.value = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

    const dateInput = document.getElementById('planStartDate');
    if (dateInput) {
        dateInput.value = now.toISOString().slice(0, 10);
    }
}

function initPreferenceTags() {
    const catContainer = document.getElementById('prefCategories');
    if (catContainer) {
        catContainer.innerHTML = POI_CATEGORIES.map(c =>
            `<span class="pref-tag" data-value="${c}">${c}</span>`
        ).join('');
        catContainer.querySelectorAll('.pref-tag').forEach(el => {
            el.addEventListener('click', () => {
                el.classList.toggle('active');
            });
        });
    }

    const settingsCat = document.getElementById('settingsCategories');
    if (settingsCat) {
        settingsCat.innerHTML = POI_CATEGORIES.map(c =>
            `<span class="pref-tag" data-value="${c}">${c}</span>`
        ).join('');
        settingsCat.querySelectorAll('.pref-tag').forEach(el => {
            el.addEventListener('click', () => {
                el.classList.toggle('active');
            });
        });
    }

    document.querySelectorAll('#prefCuisine .pref-tag, #settingsCuisine .pref-tag').forEach(el => {
        el.addEventListener('click', () => {
            el.classList.toggle('active');
        });
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
                if (cats.includes(el.dataset.value)) {
                    el.classList.add('active');
                }
            });
            const cuisines = prefs.cuisine_prefs || [];
            document.querySelectorAll('#prefCuisine .pref-tag, #settingsCuisine .pref-tag').forEach(el => {
                if (cuisines.includes(el.dataset.value)) {
                    el.classList.add('active');
                }
            });
            const paceSelect = document.getElementById('settingsPace');
            if (paceSelect && prefs.pace) {
                paceSelect.value = prefs.pace;
            }
        }
    } catch (e) {
        console.warn('加载偏好失败:', e);
    }
}

// ============================================================
// 生成方案
// ============================================================
export async function generatePlans() {
    const loadingEl = document.getElementById('planLoading');
    const stepPrefs = document.getElementById('stepPreferences');
    const stepCompare = document.getElementById('stepCompare');

    const startDate = document.getElementById('planStartDate').value;
    const startTime = document.getElementById('planStartTime').value;
    const days = parseInt(document.getElementById('planDays').value);
    const style = document.getElementById('planStyle').value;

    if (!startDate) {
        alert('请选择出发日期');
        return;
    }

    const selectedCats = [];
    document.querySelectorAll('#prefCategories .pref-tag.active').forEach(el => {
        selectedCats.push(el.dataset.value);
    });

    const selectedCuisine = [];
    document.querySelectorAll('#prefCuisine .pref-tag.active').forEach(el => {
        selectedCuisine.push(el.dataset.value);
    });

    const { getPois } = await import('./api.js');
    const allPois = await getPois();
    let filteredPois = allPois;
    if (selectedCats.length > 0) {
        filteredPois = allPois.filter(p => {
            const cats = (p.category || '').split(',').map(c => c.trim());
            return cats.some(c => selectedCats.includes(c));
        });
    }
    if (filteredPois.length === 0) {
        filteredPois = allPois;
    }

    const poiIds = filteredPois.map(p => p.id);

    stepPrefs.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    try {
        const user = await getCurrentUser();
        const result = await apiGeneratePlans({
            poiIds: poiIds,
            startDate: startDate,
            startTime: startTime,
            days: days,
            style: style,
            allowFill: true,
            userId: user?.id || null
        });

        if (!result.success || !result.solutions || result.solutions.length === 0) {
            alert('无法生成有效的行程方案，请调整选择');
            loadingEl.classList.add('hidden');
            stepPrefs.classList.remove('hidden');
            return;
        }

        currentSolutions = result.solutions;
        selectedSolutionIndex = -1;
        renderSolutions(result.solutions, result.weather);

        loadingEl.classList.add('hidden');
        stepCompare.classList.remove('hidden');

    } catch (error) {
        console.error('生成方案失败:', error);
        alert('生成方案失败：' + error.message);
        loadingEl.classList.add('hidden');
        stepPrefs.classList.remove('hidden');
    }
}

function renderSolutions(solutions, weather) {
    const container = document.getElementById('solutionCompareContainer');
    if (!container) return;

    const styleLabels = {
        compact: { label: '紧凑型', badge: 'badge-compact', icon: '🚀' },
        relaxed: { label: '悠闲型', badge: 'badge-relaxed', icon: '🌿' },
        indepth: { label: '深度游', badge: 'badge-indepth', icon: '🔍' }
    };

    let html = '';
    solutions.forEach((sol, idx) => {
        const info = styleLabels[sol.style] || styleLabels.relaxed;
        const data = sol.data || {};
        const totalPois = data.total_pois || 0;
        const totalDays = data.total_days || 1;
        const totalDuration = data.total_duration || 0;

        html += `
            <div class="solution-card" onclick="window.selectSolutionCard(${idx})" id="sol-card-${idx}">
                <div class="badge-style ${info.badge}">${info.icon} ${info.label}</div>
                <div class="stat-row"><span>📅 天数</span><span>${totalDays} 天</span></div>
                <div class="stat-row"><span>📍 景点</span><span>${totalPois} 个</span></div>
                <div class="stat-row"><span>⏱️ 游览总时长</span><span>${Math.round(totalDuration/60)} 小时</span></div>
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
// 方案选择与操作
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
    let msg = `📋 ${sol.style === 'compact' ? '紧凑型' : sol.style === 'relaxed' ? '悠闲型' : '深度游'} 方案\n`;
    msg += `📅 ${data.total_days || 0} 天 | 📍 ${data.total_pois || 0} 个景点\n\n`;
    if (data.days) {
        data.days.forEach(day => {
            msg += `--- 第${day.day}天 (${day.date}) ---\n`;
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
            await apiSaveTripSolution(user.id, sol.data, sol.style, sol.score);
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
            html += `
                <div class="day-block">
                    <div class="day-title">📅 第${day.day}天 (${day.date})</div>
            `;
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
    if (!currentTripData) {
        alert('没有可保存的行程');
        return;
    }
    const user = await getCurrentUser();
    if (!user) {
        alert('请先登录');
        return;
    }
    try {
        await apiSaveTripSolution(user.id, currentTripData, 'custom', 0);
        alert('行程已保存到“我的行程”');
        // 重新渲染我的行程
        const { renderMyTrips } = await import('./user.js');
        renderMyTrips();
    } catch (error) {
        alert('保存失败：' + error.message);
    }
}

export function startNavigation() {
    if (!currentTripData) {
        alert('没有可导航的行程');
        return;
    }
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
    if (!user) {
        alert('请先登录');
        return;
    }
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
        await saveUserPreferences({
            user_id: user.id,
            preferred_categories: selectedCats,
            cuisine_prefs: selectedCuisine,
            pace: pace,
            updated_at: new Date().toISOString()
        });
        alert('偏好已保存');
    } catch (error) {
        alert('保存失败：' + error.message);
    }
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
    } catch (e) {
        console.warn('加载已保存方案失败:', e);
    }
}

// ============================================================
// 导出供其他模块使用
// ============================================================
export { renderMyTrips } from './user.js'; // 重新导出以便trip-planner调用
