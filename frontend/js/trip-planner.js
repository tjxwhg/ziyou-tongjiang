// js/trip-planner.js - 行程规划核心（完整版）
import { generatePlans as apiGeneratePlans, selectPlan as apiSelectPlan, saveTripSolution as apiSaveTripSolution, getUserTripSolutions, getPois } from './api.js';
import { getCurrentUser } from './auth.js';
import { formatTime, getDayWeatherTip } from './utils.js';
import { PREF_CATEGORIES, PREF_CUISINE } from './config.js';

// ============================================================
// 状态
// ============================================================
let currentSolutions = [];
let selectedSolutionIndex = -1;
let currentTripData = null;
let allPoisCache = [];

// ============================================================
// 初始化
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
    // 景点类型偏好
    const containers = ['prefCategories', 'settingsCategories'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = PREF_CATEGORIES.map(c => {
            const icon = { '自然景区':'🌿', '人文历史':'📜', '民俗风情':'🎎', '景观地标':'🗼', '游玩娱乐':'🎢', '购物消费':'🛍️' }[c] || '';
            return `<span class="pref-tag" data-value="${c}">${icon} ${c}</span>`;
        }).join('');
        container.querySelectorAll('.pref-tag').forEach(el => {
            el.addEventListener('click', () => el.classList.toggle('active'));
        });
    });

    // 用餐偏好
    const cuisineContainers = ['prefCuisine', 'settingsCuisine'];
    cuisineContainers.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = PREF_CUISINE.map(c => {
            const icon = { '川菜':'🌶️', '火锅':'🫕', '小吃':'🍢', '家常':'🍳', '简餐':'🥪' }[c] || '';
            return `<span class="pref-tag" data-value="${c}">${icon} ${c}</span>`;
        }).join('');
        container.querySelectorAll('.pref-tag').forEach(el => {
            el.addEventListener('click', () => el.classList.toggle('active'));
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
// 景点选择列表
// ============================================================
export async function loadPoiListForSelection(pois) {
    allPoisCache = pois || await getPois();
    const container = document.getElementById('poiSelectContainer');
    if (!container) return;
    if (!allPoisCache || allPoisCache.length === 0) {
        container.innerHTML = '<div class="text-secondary text-center py-2">暂无景点数据</div>';
        return;
    }
    const sorted = [...allPoisCache].sort((a,b) => a.name.localeCompare(b.name));
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
    // 默认全选（方便测试）
    document.querySelectorAll('#poiSelectContainer input[type="checkbox"]').forEach(cb => cb.checked = true);
    updateSelectedCount();
}

function updateSelectedCount() {
    const checked = document.querySelectorAll('#poiSelectContainer input:checked').length;
    const el = document.getElementById('selectedPoiCount');
    if (el) el.textContent = `已选 ${checked} 个`;
}

export function selectAllPois(select) {
    document.querySelectorAll('#poiSelectContainer input[type="checkbox"]').forEach(cb => cb.checked = select);
    updateSelectedCount();
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

    if (!startDate) { alert('请选择出发日期'); return; }

    // 获取选中的POI ID
    const selectedPoiIds = [];
    document.querySelectorAll('#poiSelectContainer input:checked').forEach(cb => {
        selectedPoiIds.push(cb.value);
    });
    if (selectedPoiIds.length === 0) {
        alert('请至少选择一个景点');
        return;
    }

    // 获取偏好（用于后端筛选，但已选景点优先）
    const selectedCats = [];
    document.querySelectorAll('#prefCategories .pref-tag.active').forEach(el => {
        selectedCats.push(el.dataset.value);
    });
    const selectedCuisine = [];
    document.querySelectorAll('#prefCuisine .pref-tag.active').forEach(el => {
        selectedCuisine.push(el.dataset.value);
    });

    stepPrefs.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    try {
        const user = await getCurrentUser();
        const result = await apiGeneratePlans({
            poiIds: selectedPoiIds,
            startDate: startDate,
            startTime: startTime,
            days: days,
            style: style,
            allowFill: true,
            userId: user?.id || null,
            preferences: { categories: selectedCats, cuisine: selectedCuisine }
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
        relaxed: { label: '舒适型', badge: 'badge-relaxed', icon: '🌿' },
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
    } catch (e) { console.warn('加载已保存方案失败:', e); }
}
