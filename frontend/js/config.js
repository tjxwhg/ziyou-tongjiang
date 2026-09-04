// frontend/js/config.js - 前端全局配置
export const SUPABASE_URL = 'https://aermnnksvhezfykxefla.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcm1ubmtzdmhlemZ5a3hlZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQ4ODEsImV4cCI6MjA5NzY1MDg4MX0.c2Wemu90PiezEaXn2Hv3tBL-D5YFXYTVxei14CI-Rvk';

// 后端API地址（根据部署环境修改）
export const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : 'https://your-api-domain.com/api';

// POI分类
export const POI_CATEGORIES = ['自然景区', '红色景区', '文博场馆', '餐饮住宿', '交通枢纽', '游玩娱乐', '特产购物', '公共服务'];

// 行程约束
export const DAY_START = 480;        // 8:00
export const DAY_END = 1080;         // 18:00
export const LUNCH_START = 690;      // 11:30
export const LUNCH_END = 750;        // 12:30
export const DINNER_START = 1050;    // 17:30
export const DINNER_END = 1110;      // 18:30
export const MEAL_DURATION = 60;
export const NEW_ARRIVAL_CUTOFF = 1020; // 17:00后不新安排游览
export const MAX_RETURN_TIME = 1260;    // 21:00前必须返回

// 长耗时景点关键词
export const LONG_SPOT_NAMES = ['空山天盆', '诺水河溶洞', '王坪烈士陵园', '红军烈士陵园'];

// 县城景点关键词
export const COUNTY_SPOT_KEYWORDS = ['轿房沟美食街', '银耳博物馆', '红四方面军总指挥部旧址纪念馆', '省委党校旧址纪念馆', '通江花月夜'];

// 地图POI颜色
export const poiColors = {
    '自然景区': '#2E7D32',
    '红色景区': '#9C27B0',
    '文博场馆': '#9C27B0',
    '餐饮住宿': '#FF9800',
    '交通枢纽': '#00BCD4',
    '游玩娱乐': '#FF5722',
    '特产购物': '#FFC107',
    '公共服务': '#607D8B'
};