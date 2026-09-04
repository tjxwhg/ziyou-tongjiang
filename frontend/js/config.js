// js/config.js - 前端全局配置
export const SUPABASE_URL = 'https://aermnnksvhezfykxefla.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcm1ubmtzdmhlemZ5a3hlZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQ4ODEsImV4cCI6MjA5NzY1MDg4MX0.c2Wemu90PiezEaXn2Hv3tBL-D5YFXYTVxei14CI-Rvk';

// 后端API地址（请根据实际部署修改）
export const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api' 
    : 'https://your-backend-domain.com/api';  // 部署时替换为实际域名

// 景点类型偏好（自然、人文、民俗、景观、游玩、购物等）
export const PREF_CATEGORIES = ['自然景区', '人文历史', '民俗风情', '景观地标', '游玩娱乐', '购物消费'];

// 用餐偏好
export const PREF_CUISINE = ['川菜', '火锅', '小吃', '家常', '简餐'];

// 原有POI分类（用于地图筛选）
export const POI_CATEGORIES = ['自然景区', '人文历史', '民俗风情', '景观地标', '游玩娱乐', '购物消费', '餐饮住宿', '交通枢纽', '公共服务'];

// 行程约束
export const DAY_START = 480;   // 8:00
export const DAY_END = 1080;    // 18:00
export const LUNCH_START = 690; // 11:30
export const LUNCH_END = 750;   // 12:30
export const DINNER_START = 1050; // 17:30
export const DINNER_END = 1110; // 18:30
export const MEAL_DURATION = 60;
export const NEW_ARRIVAL_CUTOFF = 1020; // 17:00
export const MAX_RETURN_TIME = 1260; // 21:00

// 长耗时景点关键词（已弃用，保留兼容性）
export const LONG_SPOT_NAMES = ['空山天盆', '诺水河溶洞', '王坪烈士陵园', '红军烈士陵园'];

// 县城景点关键词（用于住宿推荐）
export const COUNTY_SPOT_KEYWORDS = ['轿房沟美食街', '银耳博物馆', '红四方面军总指挥部旧址纪念馆', '省委党校旧址纪念馆', '通江花月夜'];

// 地图POI颜色
export const poiColors = {
    '自然景区': '#2E7D32',
    '人文历史': '#6A1B9A',
    '民俗风情': '#E65100',
    '景观地标': '#0D47A1',
    '游玩娱乐': '#FF5722',
    '购物消费': '#F9A825',
    '餐饮住宿': '#FF9800',
    '交通枢纽': '#00BCD4',
    '公共服务': '#607D8B'
};

// 数据等级定义
export const DATA_LEVELS = {
    L1: { label: '完整数据', color: '#c8e6c9' },
    L2: { label: '有内部路线', color: '#fff9c4' },
    L3: { label: '基础信息', color: '#ffcdd2' }
};
