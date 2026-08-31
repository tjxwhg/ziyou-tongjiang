import { getReservations, insertFeedback, getFeedbacks } from './api.js';

// 行程本地存储
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

// 预约（需按 user_id 过滤，此处简化）
export async function loadMyReservations(userId) {
  // 实际应加 user_id 字段，这里返回全部（仅供演示）
  return getReservations(null);
}

// 留言
export async function submitFeedback(message, userId, merchantId = null) {
  return insertFeedback({ user_id: userId, message, merchant_id: merchantId });
}
export async function getMyFeedbacks(userId) {
  // 同理需过滤 user_id
  return getFeedbacks(null);
}
