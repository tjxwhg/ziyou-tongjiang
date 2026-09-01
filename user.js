// user.js - 游客端“我的”功能
import { getReservations, insertFeedback, getFeedbacks, updateReservation } from './api.js';
import { getCurrentUser } from './auth.js';

// ---------- 行程本地存储 ----------
export function getMyTrips() {
  return JSON.parse(localStorage.getItem('trips') || '[]');
}
export function saveTrip(trip) {
  const trips = getMyTrips();
  trips.push(trip);
  localStorage.setItem('trips', JSON.stringify(trips));
}
export function deleteTrip(index) {
  const trips = getMyTrips();
  trips.splice(index, 1);
  localStorage.setItem('trips', JSON.stringify(trips));
}

// ---------- 预约 ----------
export async function loadMyReservations(userId) {
  // 实际应增加 user_id 字段过滤，这里暂返回全部（可优化）
  return getReservations(null);
}

// ---------- 留言 ----------
export async function submitFeedback(message, userId, merchantId = null) {
  return insertFeedback({ user_id: userId, message, merchant_id: merchantId });
}
export async function getMyFeedbacks(userId) {
  // 同样需要过滤 user_id，但现有接口不支持，可后续扩展
  return getFeedbacks(null);
}

// ---------- 删除预约（扩展） ----------
export async function deleteReservation(id) {
  // 为了不丢失数据，改为取消状态
  await updateReservation(id, { status: 'cancelled' });
}
