// js/merchant.js - 商户端核心逻辑
import {
    getMerchant, updateMerchant,
    getReservations, insertReservation, updateReservation,
    getFeedbacks, updateFeedback,
    uploadFile,
    getPois
} from './api.js';
import { getCurrentUser } from './auth.js';

let merchant = null;
let businessCategories = [];
let businessItems = [];

// ============================================================
// 初始化
// ============================================================
export async function initMerchant() {
    const user = await getCurrentUser();
    if (!user) throw new Error('未登录');
    const data = await getMerchant(user.id);
    if (!data) throw new Error('未找到商户信息');
    merchant = data;
    // 加载业务数据
    const sd = merchant.service_data || {};
    businessCategories = sd.businessCategories || [];
    businessItems = sd.businessItems || [];
    return merchant;
}

export function getMerchantData() {
    return merchant;
}

// ============================================================
// 业务数据管理
// ============================================================
export function loadBusinessData() {
    return {
        businessCategories: [...businessCategories],
        businessItems: JSON.parse(JSON.stringify(businessItems))
    };
}

export async function saveBusinessData(categories, items) {
    businessCategories = categories;
    businessItems = items;
    const sd = merchant.service_data || {};
    sd.businessCategories = categories;
    sd.businessItems = items;
    // 兼容旧格式
    sd.items = items.map(item => ({
        name: item.name,
        price: item.price,
        duration: item.duration,
        description: item.description,
        image: item.image
    }));
    await updateMerchant(merchant.id, { service_data: sd });
    merchant.service_data = sd;
}

export function addBusinessCategory(category) {
    if (!businessCategories.includes(category)) {
        businessCategories.push(category);
        return true;
    }
    return false;
}

export function removeBusinessCategory(index) {
    const cat = businessCategories[index];
    if (!cat) return false;
    // 将该分类下的项目移到"默认"分类
    if (!businessCategories.includes('默认')) {
        businessCategories.push('默认');
    }
    businessItems.forEach(item => {
        if (item.category === cat) {
            item.category = '默认';
        }
    });
    businessCategories.splice(index, 1);
    return true;
}

export function addBusinessItem(item) {
    businessItems.push(item);
}

export function updateBusinessItem(index, updates) {
    if (index >= 0 && index < businessItems.length) {
        Object.assign(businessItems[index], updates);
        return true;
    }
    return false;
}

export function deleteBusinessItem(index) {
    if (index >= 0 && index < businessItems.length) {
        businessItems.splice(index, 1);
        return true;
    }
    return false;
}

// ============================================================
// 预约管理
// ============================================================
export async function fetchReservations() {
    if (!merchant) return [];
    return getReservations(merchant.id);
}

export async function addReservation(data) {
    if (!merchant) throw new Error('未登录');
    data.merchant_id = merchant.id;
    return insertReservation(data);
}

export async function updateReservationStatus(id, status) {
    await updateReservation(id, { status });
}

// ============================================================
// 留言管理
// ============================================================
export async function fetchFeedbacks() {
    if (!merchant) return [];
    return getFeedbacks(merchant.id);
}

export async function replyFeedback(id, reply) {
    await updateFeedback(id, { reply });
}

// ============================================================
// 基本信息管理
// ============================================================
export async function updateInfo(updates) {
    await updateMerchant(merchant.id, updates);
    Object.assign(merchant, updates);
}

// ============================================================
// POI导览图上传
// ============================================================
export async function loadPoiList() {
    return getPois();
}

let guideImageFile = null;
let guideImagePreview = null;

export function setGuideImage(file) {
    guideImageFile = file;
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            guideImagePreview = e.target.result;
            resolve(guideImagePreview);
        };
        reader.readAsDataURL(file);
    });
}

export function removeGuideImage() {
    guideImageFile = null;
    guideImagePreview = null;
}

export async function submitGuide(poiId, nodesData) {
    if (!merchant) throw new Error('未登录');
    if (!poiId) throw new Error('请选择关联POI');
    
    let imageUrl = null;
    if (guideImageFile) {
        const path = `guide_${merchant.id}_${poiId}_${Date.now()}.jpg`;
        imageUrl = await uploadFile('merchant-uploads', path, guideImageFile);
    }
    
    // 解析节点数据
    let nodes = [];
    if (nodesData) {
        try {
            nodes = JSON.parse(nodesData);
        } catch (e) {
            throw new Error('节点数据格式错误，请检查JSON格式');
        }
    }
    
    // 保存到数据库（实际应保存到 guide_submissions 表）
    // 这里简化为保存到 merchant.service_data 中
    const sd = merchant.service_data || {};
    if (!sd.guide_submissions) {
        sd.guide_submissions = [];
    }
    sd.guide_submissions.push({
        poi_id: poiId,
        image_url: imageUrl,
        nodes: nodes,
        status: 'pending',
        submitted_at: new Date().toISOString()
    });
    await updateMerchant(merchant.id, { service_data: sd });
    merchant.service_data = sd;
    
    return { success: true, imageUrl };
}

export async function getGuideHistory() {
    if (!merchant) return [];
    const sd = merchant.service_data || {};
    return sd.guide_submissions || [];
}

// ============================================================
// 活动类别管理（用于预约）
// ============================================================
export function getActivityCategories() {
    const sd = merchant.service_data || {};
    return sd.categories || [];
}

export async function addActivityCategory(category) {
    const sd = merchant.service_data || {};
    if (!sd.categories) {
        sd.categories = [];
    }
    if (!sd.categories.includes(category)) {
        sd.categories.push(category);
        await updateMerchant(merchant.id, { service_data: sd });
        merchant.service_data = sd;
        return true;
    }
    return false;
}

export async function removeActivityCategory(index) {
    const sd = merchant.service_data || {};
    if (!sd.categories || index >= sd.categories.length) return false;
    sd.categories.splice(index, 1);
    await updateMerchant(merchant.id, { service_data: sd });
    merchant.service_data = sd;
    return true;
}

// ============================================================
// 导出CSV
// ============================================================
export function exportReservationsToCSV(reservations) {
    if (!reservations || reservations.length === 0) {
        alert('无预约记录可导出');
        return;
    }
    const headers = ['日期', '时段', '单位', '联系人', '电话', '人数', '活动类别', '地点', '状态', '备注'];
    const rows = reservations.map(r => {
        let category = '';
        let remark = r.remark || '';
        if (remark.includes('类别：')) {
            category = remark.split('类别：')[1]?.split('|')[0] || '';
            remark = remark.replace('类别：' + category + '|', '').replace('类别：' + category, '');
        }
        return [
            r.reservation_date,
            r.time_slot_start + (r.time_slot_end ? '~' + r.time_slot_end : ''),
            r.unit || '',
            r.name || '',
            r.phone || '',
            r.visitor_count || 0,
            category,
            r.room || '',
            r.status || 'pending',
            remark
        ];
    });
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `预约记录_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================
// 导出给前端使用
// ============================================================
export function getBusinessCategories() {
    return businessCategories;
}

export function getBusinessItems() {
    return businessItems;
}