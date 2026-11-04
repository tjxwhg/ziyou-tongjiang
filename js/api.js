// js/api.js - Supabase API 操作
// ============================================================
// 2026-11-04 v1.4 清理记录（P1）
// 以下函数因"零调用 + 与现有架构不匹配"已删除：
// - 景区表系列（getScenicList 等 4 个）：景区信息统一用 L1 POI
// - getMerchantByPoi（单数）：一个 POI 可关联多商户，单数版有隐藏 bug
// - 用户偏好系列（getUserPreferences 等 2 个）：游客不登录
// - 云端行程系列（saveTripSolution 等 2 个）：游客用 localStorage
// - createMerchantRecord：商户由管理员在 Supabase 后台创建
// 如需恢复，见 v1.4 之前的 git 提交历史。
//
// 小程序适配提示（未来迁移时需替换的 API）：
// - localStorage → wx.getStorageSync / wx.setStorageSync
// - Supabase JS SDK 在小程序中需用 npm 引入方式
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// 缓存版本号（小程序适配点：localStorage → wx.storage）
// ============================================================
export function bumpCacheVersion() {
    try {
        const v = parseInt(localStorage.getItem('ztj_cache_version') || '0', 10) + 1;
        localStorage.setItem('ztj_cache_version', String(v));
    } catch (e) { /* ignore */ }
}
export function getCacheVersion() {
    try { return localStorage.getItem('ztj_cache_version') || '0'; }
    catch (e) { return '0'; }
}

// ============================================================
// 通用分页拉取（防止 PostgREST 1000 行截断，配合 A003）
// ============================================================
async function fetchAll(buildQuery, pageSize = 1000) {
    const out = [];
    let from = 0;
    while (true) {
        const { data, error } = await buildQuery().range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        out.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return out;
}

// ========== POI ==========
export async function getPois() {
    return fetchAll(() => supabase
        .from('ztj_poi')
        .select('*')
        .eq('status', 'active')
        .order('id', { ascending: true }));
}

export async function getPoi(id) {
    const { data, error } = await supabase.from('ztj_poi').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

export async function insertPoi(poi) {
    const { data, error } = await supabase.from('ztj_poi').insert(poi).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('插入失败：未返回数据');
    bumpCacheVersion();
    return data[0];
}

export async function updatePoi(id, updates) {
    const { error } = await supabase.from('ztj_poi').update(updates).eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}

export async function deletePoi(id) {
    const { error } = await supabase.from('ztj_poi').delete().eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}

// ========== 路线 ==========
export async function getRoutes() {
    return fetchAll(() => supabase
        .from('ztj_routes')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }));
}
export async function getRoute(id) {
    const { data, error } = await supabase.from('ztj_routes').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}
export async function insertRoute(route) {
    const { data, error } = await supabase.from('ztj_routes').insert(route).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('路线插入失败');
    bumpCacheVersion();
    return data[0];
}
export async function updateRoute(id, updates) {
    const { error } = await supabase.from('ztj_routes').update(updates).eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}
export async function deleteRoute(id) {
    const { error } = await supabase.from('ztj_routes').delete().eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}
export async function getRouteNodes(routeId) {
    const { data, error } = await supabase
        .from('ztj_route_nodes').select('*').eq('route_id', routeId).order('order_num');
    if (error) throw error;
    return data || [];
}
export async function insertRouteNodes(nodes) {
    if (!nodes || nodes.length === 0) return;
    const { error } = await supabase.from('ztj_route_nodes').insert(nodes);
    if (error) throw error;
}
export async function deleteRouteNodes(routeId) {
    const { error } = await supabase.from('ztj_route_nodes').delete().eq('route_id', routeId);
    if (error) throw error;
}

// ============================================================
// 交通耗时（ztj_transport_times，无方向，poi_a < poi_b）
// ============================================================
export async function getTransportTimes() {
    return fetchAll(() => supabase
        .from('ztj_transport_times')
        .select('*')
        .order('poi_a', { ascending: true })
        .order('poi_b', { ascending: true }));
}

export async function setTransportTime(poiX, poiY, timeMin) {
    const a = Math.min(Number(poiX), Number(poiY));
    const b = Math.max(Number(poiX), Number(poiY));
    const { error } = await supabase
        .from('ztj_transport_times')
        .upsert(
            { poi_a: a, poi_b: b, time_min: timeMin, updated_at: new Date().toISOString() },
            { onConflict: 'poi_a,poi_b' }
        );
    if (error) throw error;
    bumpCacheVersion();
}

export async function deleteTransportTime(poiX, poiY) {
    const a = Math.min(Number(poiX), Number(poiY));
    const b = Math.max(Number(poiX), Number(poiY));
    const { error } = await supabase
        .from('ztj_transport_times')
        .delete()
        .eq('poi_a', a)
        .eq('poi_b', b);
    if (error) throw error;
    bumpCacheVersion();
}

export async function deleteTransportTimesForPoi(poiId) {
    const id = Number(poiId);
    const { error: e1 } = await supabase
        .from('ztj_transport_times').delete().eq('poi_a', id);
    if (e1) throw e1;
    const { error: e2 } = await supabase
        .from('ztj_transport_times').delete().eq('poi_b', id);
    if (e2) throw e2;
    bumpCacheVersion();
}

/**
 * 应用"基准 + 偏移"：把基准 POI 的耗时行复制为当前 POI 的固定行。
 * 语义：基准仅作初始模板，复制完即独立，之后改基准不影响已生成数据。
 *
 * 返回：{ pairMissing, pairSource, rowCount }
 *   - pairMissing=true 表示 当前↔基准 这一对没有数据（需管理员手动补填）
 */
export async function applyBaseWithOffset(poiId, basePoiId, offset) {
    const poiIdNum = Number(poiId);
    const baseIdNum = Number(basePoiId);
    if (!Number.isFinite(poiIdNum) || !Number.isFinite(baseIdNum)) {
        throw new Error('无效的 POI 编号');
    }
    if (poiIdNum === baseIdNum) throw new Error('基准 POI 不能是自己');

    // 1. 读取基准 POI 的所有耗时行（分页）
    const PAGE_SIZE = 1000;
    let baseTimes = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('ztj_transport_times')
            .select('*')
            .or(`poi_a.eq.${baseIdNum},poi_b.eq.${baseIdNum}`)
            .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        baseTimes = baseTimes.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    // 2. 查"当前 POI ↔ 基准 POI"的现有行（fallback 1）
    const aPair = Math.min(poiIdNum, baseIdNum);
    const bPair = Math.max(poiIdNum, baseIdNum);
    const { data: currentPairData, error: cpErr } = await supabase
        .from('ztj_transport_times')
        .select('*')
        .eq('poi_a', aPair)
        .eq('poi_b', bPair)
        .maybeSingle();
    if (cpErr && cpErr.code !== 'PGRST116') throw cpErr;

    // 3. 生成 当前↔对方 的固定行（基准表 A↔B 的耗时 + 偏移）
    const newRows = [];
    const seen = new Set();
    for (const bt of baseTimes) {
        const other = Number(bt.poi_a) === baseIdNum ? Number(bt.poi_b) : Number(bt.poi_a);
        if (other === poiIdNum) continue;
        const newTime = Math.max(0, bt.time_min + offset);
        const a = Math.min(poiIdNum, other);
        const b = Math.max(poiIdNum, other);
        const key = `${a}_${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newRows.push({ poi_a: a, poi_b: b, time_min: newTime });
    }

    // 4. 确定"当前↔基准"的值：现有 → 基准表里基准↔当前 → 空
    let pairTime = null;
    let pairSource = null;
    if (currentPairData && currentPairData.time_min !== null && currentPairData.time_min !== undefined) {
        pairTime = currentPairData.time_min;
        pairSource = 'existing';
    } else {
        const baseHasCurrent = baseTimes.find(bt => {
            const a = Number(bt.poi_a), b = Number(bt.poi_b);
            return (a === baseIdNum && b === poiIdNum) || (a === poiIdNum && b === baseIdNum);
        });
        if (baseHasCurrent) {
            pairTime = baseHasCurrent.time_min;
            pairSource = 'base';
        }
    }
    if (pairTime !== null) {
        const key = `${aPair}_${bPair}`;
        if (!seen.has(key)) {
            newRows.push({ poi_a: aPair, poi_b: bPair, time_min: pairTime });
        }
    }

    // 5. 删除当前 POI 的旧数据
    const { error: delA } = await supabase
        .from('ztj_transport_times').delete().eq('poi_a', poiIdNum);
    if (delA) throw delA;
    const { error: delB } = await supabase
        .from('ztj_transport_times').delete().eq('poi_b', poiIdNum);
    if (delB) throw delB;

    // 6. 分批插入
    if (newRows.length > 0) {
        const BATCH = 500;
        for (let i = 0; i < newRows.length; i += BATCH) {
            const { error } = await supabase
                .from('ztj_transport_times')
                .insert(newRows.slice(i, i + BATCH));
            if (error) throw error;
        }
    }

    // 7. 记录基准关系到 POI 表（仅后台展示用，前端不读）
    const { error: poiError } = await supabase
        .from('ztj_poi')
        .update({ base_poi_id: baseIdNum, base_offset: offset })
        .eq('id', poiIdNum);
    if (poiError) throw poiError;

    bumpCacheVersion();

    return {
        pairMissing: pairTime === null,
        pairSource,
        rowCount: newRows.length
    };
}

export async function clearBaseRelation(poiId) {
    const { error } = await supabase
        .from('ztj_poi')
        .update({ base_poi_id: null, base_offset: 0 })
        .eq('id', poiId);
    if (error) throw error;
    bumpCacheVersion();
}

export async function getDependents(poiId) {
    const { data, error } = await supabase
        .from('ztj_poi')
        .select('id, name')
        .eq('base_poi_id', poiId);
    if (error) throw error;
    return data || [];
}

// ========== 商户 ==========
export async function getMerchant(id) {
    const { data, error } = await supabase.from('ztj_merchants').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
}
export async function updateMerchant(id, updates) {
    const { error } = await supabase.from('ztj_merchants').update(updates).eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}
export async function getMerchantsByPoi(poiId) {
    return fetchAll(() => {
        let q = supabase.from('ztj_merchants').select('*');
        if (poiId !== undefined && poiId !== null) {
            q = q.eq('poi_id', poiId);
        } else if (poiId === null) {
            q = q.is('poi_id', null);
        }
        return q.order('id', { ascending: true });
    });
}

// ========== 预约 ==========
export async function getReservations(merchantId) {
    return fetchAll(() => {
        let q = supabase.from('reservations').select('*');
        if (merchantId) q = q.eq('merchant_id', merchantId);
        return q.order('created_at', { ascending: false }).order('id', { ascending: true });
    });
}
export async function getReservationsByDevice(deviceId) {
    return fetchAll(() => supabase
        .from('reservations')
        .select('*')
        .eq('device_id', deviceId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }));
}
export async function insertReservation(res) {
    const { data, error } = await supabase.from('reservations').insert(res).select();
    if (error) throw error;
    return data[0];
}
export async function updateReservation(id, updates) {
    const { error } = await supabase.from('reservations').update(updates).eq('id', id);
    if (error) throw error;
}
export async function deleteReservation(id) {
    const { error } = await supabase.from('reservations').delete().eq('id', id);
    if (error) throw error;
}

// ========== 留言 ==========
export async function getFeedbacks(merchantId) {
    return fetchAll(() => {
        let q = supabase.from('ztj_feedbacks').select('*');
        if (merchantId) q = q.eq('merchant_id', merchantId);
        return q.order('created_at', { ascending: false }).order('id', { ascending: true });
    });
}
export async function getFeedbacksByDevice(deviceId) {
    return fetchAll(() => supabase
        .from('ztj_feedbacks')
        .select('*')
        .eq('device_id', deviceId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }));
}
export async function insertFeedback(fb) {
    const { data, error } = await supabase.from('ztj_feedbacks').insert(fb).select();
    if (error) throw error;
    return data[0];
}
export async function updateFeedback(id, updates) {
    const { error } = await supabase.from('ztj_feedbacks').update(updates).eq('id', id);
    if (error) throw error;
}
export async function deleteFeedback(id) {
    const { error } = await supabase.from('ztj_feedbacks').delete().eq('id', id);
    if (error) throw error;
}

// ========== 文件上传 ==========
export async function uploadFile(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
}

// ========== 偏差记录（被 trip-executor.js 引用，保留） ==========
export async function saveDeviationRecord(solutionId, deviationMinutes, reason, adjustedSolution) {
    const { error } = await supabase.from('real_time_deviation').insert({
        trip_solution_id: solutionId,
        deviation_minutes: deviationMinutes,
        trigger_reason: reason,
        adjusted_solution: adjustedSolution
    });
    if (error) throw error;
}