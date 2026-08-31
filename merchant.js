import { getMerchant, updateMerchant, getReservations, insertReservation, updateReservation, getFeedbacks, updateFeedback, uploadFile } from './api.js';
import { getCurrentUser } from './auth.js';

let merchant = null;

export async function initMerchant() {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  const data = await getMerchant(user.id);
  merchant = data;
  return merchant;
}

export function getMerchantData() { return merchant; }

// 业务数据
export function loadBusinessData() {
  const sd = merchant.service_data || {};
  return {
    businessCategories: sd.businessCategories || [],
    businessItems: sd.businessItems || []
  };
}

export async function saveBusinessData(categories, items) {
  const sd = merchant.service_data || {};
  sd.businessCategories = categories;
  sd.businessItems = items;
  // 兼容旧格式
  sd.items = items.map(item => ({
    name: item.name, price: item.price, duration: item.duration,
    description: item.description, image: item.image
  }));
  await updateMerchant(merchant.id, { service_data: sd });
  merchant.service_data = sd;
}

// 预约
export async function fetchReservations() {
  return getReservations(merchant.id);
}
export async function addReservation(data) {
  data.merchant_id = merchant.id;
  return insertReservation(data);
}
export async function changeReservationStatus(id, status) {
  await updateReservation(id, { status });
}

// 留言
export async function fetchFeedbacks() {
  return getFeedbacks(merchant.id);
}
export async function replyFeedback(id, reply) {
  await updateFeedback(id, { reply });
}

// 基本信息
export async function updateInfo(updates) {
  await updateMerchant(merchant.id, updates);
  Object.assign(merchant, updates);
}
