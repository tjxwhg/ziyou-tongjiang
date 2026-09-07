// js/user.js - 用户中心（无登录）
import { getReservations, getFeedbacks, insertFeedback, getUserTripSolutions, deleteReservation, getUserPreferences, saveUserPreferences } from './api.js';

export async function renderMyTrips() {
    const container = document.getElementById('myTripsContent');
    if (!container) return;
    try {
        const solutions = await getUserTripSolutions();
        if (!solutions || solutions.length === 0) {
            container.innerHTML = '<p class="text-secondary">暂无保存的行程</p>';
            return;
        }
        let html = '';
        solutions.forEach((sol) => {
            const data = sol.solution_data || {};
            html += `
                <div class="card-modern">
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="card-title">📅 ${data.start_date || '未命名'} (${sol.style || '自定义'})</div>
                        <button class="btn btn-sm btn-danger" onclick="window.deleteTripSolution('${sol.id}')">删除</button>
                    </div>
                    <div class="card-sub">天数: ${data.total_days || 0} 天 | 景点: ${data.total_pois || 0} 个</div>
                    <button class="btn btn-sm btn-outline-custom mt-2" onclick="window.viewTripSolution('${sol.id}')">
                        <i class="fas fa-eye"></i> 查看详情
                    </button>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (e) {
        console.error('加载行程失败:', e);
        container.innerHTML = '<p class="text-danger">加载失败，请刷新重试</p>';
    }
}

export async function renderMyReservations() {
    const container = document.getElementById('myReservationsContent');
    if (!container) return;
    try {
        const data = await getReservations(null);
        if (!data || data.length === 0) {
            container.innerHTML = '<p class="text-secondary">暂无预约</p>';
            return;
        }
        const sorted = data.sort((a, b) => new Date(b.reservation_date) - new Date(a.reservation_date));
        const merchantIds = sorted.map(r => r.merchant_id).filter(id => id);
        const merchantMap = {};
        for (let id of merchantIds) {
            try {
                const { getMerchant } = await import('./api.js');
                const m = await getMerchant(id);
                merchantMap[id] = m;
            } catch (e) { merchantMap[id] = null; }
        }
        let html = '';
        sorted.forEach((r, idx) => {
            const merchant = merchantMap[r.merchant_id];
            const merchantName = merchant ? merchant.display_name || '未知商户' : '未知商户';
            const category = merchant ? merchant.business_type || '未分类' : '未分类';
            html += `
                <div class="card-modern">
                    <div onclick="window.toggleReservationDetail(${idx})" style="cursor:pointer;">
                        <div class="card-title">📅 ${r.reservation_date} | ${merchantName}</div>
                        <div class="card-sub">${category}</div>
                    </div>
                    <div id="res-detail-${idx}" class="hidden mt-2">
                        <p><b>单位：</b>${r.unit || ''}</p>
                        <p><b>联系人：</b>${r.name || ''}</p>
                        <p><b>电话：</b>${r.phone || ''}</p>
                        <p><b>人数：</b>${r.visitor_count}</p>
                        <p><b>时段：</b>${r.time_slot_start} - ${r.time_slot_end || ''}</p>
                        <p><b>备注：</b>${r.remark || ''}</p>
                        <p><b>状态：</b>${r.status}</p>
                        <button class="btn btn-sm btn-danger" onclick="window.deleteReservationHandler('${r.id}')">删除</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (e) {
        console.error('加载预约失败:', e);
        container.innerHTML = '<p class="text-danger">加载失败，请刷新重试</p>';
    }
}

export async function renderFeedbackHistory() {
    const container = document.getElementById('feedbackHistory');
    if (!container) return;
    try {
        const data = await getFeedbacks(null);
        if (!data || data.length === 0) {
            container.innerHTML = '<p class="text-secondary">暂无留言</p>';
            return;
        }
        let html = '';
        data.forEach(f => {
            html += `
                <div class="card-modern">
                    <p>${f.message}</p>
                    <small class="text-secondary">${new Date(f.created_at).toLocaleString()}</small>
                    ${f.reply ? `<div class="bg-green-light p-2 mt-2 rounded">📌 回复：${f.reply}</div>` : ''}
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (e) {
        console.error('加载留言失败:', e);
        container.innerHTML = '<p class="text-danger">加载失败</p>';
    }
}

export async function submitFeedback() {
    const msg = document.getElementById('feedbackMsg')?.value.trim();
    if (!msg) { alert('请输入内容'); return; }
    try {
        await insertFeedback({ message: msg });
        alert('提交成功');
        document.getElementById('feedbackMsg').value = '';
        renderFeedbackHistory();
    } catch (e) { alert('提交失败：' + e.message); }
}

// ========== 全局函数 ==========
window.toggleReservationDetail = (idx) => {
    const el = document.getElementById(`res-detail-${idx}`);
    if (el) el.classList.toggle('hidden');
};

window.deleteReservationHandler = async (id) => {
    if (!confirm('确认删除此预约？')) return;
    try {
        await deleteReservation(id);
        alert('已删除');
        renderMyReservations();
    } catch (e) { alert('删除失败：' + e.message); }
};

window.deleteTripSolution = async (id) => {
    if (!confirm('确认删除此行程？')) return;
    // 实际删除行程需要实现 deleteTripSolution API，此处暂不实现
    alert('删除功能暂未实现');
};

window.viewTripSolution = (id) => {
    alert('查看详情功能开发中');
};