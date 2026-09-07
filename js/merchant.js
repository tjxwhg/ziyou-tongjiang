// js/merchant.js - 商户端核心逻辑
import { getMerchant, updateMerchant, getReservations, insertReservation, updateReservation, getFeedbacks, updateFeedback, uploadFile, getPois } from './api.js';
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
    const sd = merchant.service_data || {};
    businessCategories = sd.businessCategories || [];
    businessItems = sd.businessItems || [];
    return merchant;
}

export function getMerchantData() { return merchant; }

// ============================================================
// 业务数据
// ============================================================
export function loadBusinessData() {
    return { businessCategories: [...businessCategories], businessItems: JSON.parse(JSON.stringify(businessItems)) };
}

export async function saveBusinessData(categories, items) {
    businessCategories = categories;
    businessItems = items;
    const sd = merchant.service_data || {};
    sd.businessCategories = categories;
    sd.businessItems = items;
    sd.items = items.map(item => ({ name: item.name, price: item.price, duration: item.duration, description: item.description, image: item.image }));
    await updateMerchant(merchant.id, { service_data: sd });
    merchant.service_data = sd;
}

// ============================================================
// 预约
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
// 留言
// ============================================================
export async function fetchFeedbacks() {
    if (!merchant) return [];
    return getFeedbacks(merchant.id);
}

export async function replyFeedback(id, reply) {
    await updateFeedback(id, { reply });
}

// ============================================================
// 基本信息
// ============================================================
export async function updateInfo(updates) {
    await updateMerchant(merchant.id, updates);
    Object.assign(merchant, updates);
}

// ============================================================
// POI列表
// ============================================================
export async function loadPoiList() {
    return getPois();
}