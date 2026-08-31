// ============================================
//  config.js - 全局配置文件
//  使用前请替换以下两个值为您的 Supabase 项目信息
// ============================================

// 您的 Supabase 项目 URL（可在 Dashboard → Settings → API 中找到）
export const SUPABASE_URL = 'https://aermnnksvhezfykxefla.supabase.co';   // 请替换为您的实际 URL

// 您的 Supabase 项目 anon public 密钥（同样在 API 设置中）
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcm1ubmtzdmhlemZ5a3hlZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQ4ODEsImV4cCI6MjA5NzY1MDg4MX0.c2Wemu90PiezEaXn2Hv3tBL-D5YFXYTVxei14CI-Rvk';   // 请替换为您的实际 anon key

// ============================================
//  以下为业务常量（无需修改）
// ============================================

export const POI_CATEGORIES = ['自然景区', '红色景区', '文博场馆', '餐饮住宿', '交通枢纽', '游玩娱乐', '特产购物', '公共服务'];
export const EXCLUDED_TRANSPORT_CATS = ['公共服务', '游玩娱乐', '特产购物'];

export const DAY_START = 480;            // 8:00
export const DAY_END = 1080;             // 18:00
export const LUNCH_START = 690;          // 11:30
export const LUNCH_END = 750;            // 12:30
export const DINNER_START = 1050;        // 17:30
export const DINNER_END = 1110;          // 18:30
export const MEAL_DURATION = 60;
export const NEW_ARRIVAL_CUTOFF = 1020;  // 17:00
export const MAX_RETURN_TIME = 1260;     // 21:00

export const COUNTY = { lat: 31.911705, lng: 107.245033, name: '红军广场', id: 'county' };
export const LONG_SPOT_NAMES = ['空山天盆', '诺水河溶洞', '王坪烈士陵园', '红军烈士陵园'];
export const COUNTY_SPOT_KEYWORDS = ['轿房沟美食街', '银耳博物馆', '红四方面军总指挥部旧址纪念馆', '省委党校旧址纪念馆', '通江花月夜'];
export const ALLOWED_CATEGORIES = ['自然景区', '红色景区', '文博场馆'];
export const NON_VISIT_CATEGORIES = ['交通枢纽', '餐饮住宿', '公共服务', '特产购物', '游玩娱乐'];

export const poiColors = {
  '自然景区': '#2E7D32',
  '红色景区': '#9C27B0',
  '文博场馆': '#9C27B0',
  '餐饮住宿': '#FF9800',
  '停车场': '#00BCD4',
  '公共服务': '#607D8B'
};
