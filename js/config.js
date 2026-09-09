// js/config.js - 全局配置
export const SUPABASE_URL = 'https://aermnnksvhezfykxefla.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcm1ubmtzdmhlemZ5a3hlZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQ4ODEsImV4cCI6MjA5NzY1MDg4MX0.c2Wemu90PiezEaXn2Hv3tBL-D5YFXYTVxei14CI-Rvk';

export const DAY_START = 480;
export const DAY_END = 1080;
export const LUNCH_START = 690;
export const LUNCH_END = 750;
export const DINNER_START = 1050;
export const DINNER_END = 1110;
export const MEAL_DURATION = 60;
export const NEW_ARRIVAL_CUTOFF = 1020;
export const MAX_RETURN_TIME = 1260;

export const POI_CATEGORIES = ['自然景区', '人文历史', '民俗风情', '景观地标', '游玩娱乐', '购物消费', '餐饮住宿', '交通枢纽', '公共服务'];

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

export const SA_CONFIG = {
    INIT_TEMP: 1000,
    COOLING_RATE: 0.98,
    MAX_ITERATIONS: 3000,
    EARLY_STOP_THRESHOLD: 0.001
};

export const WEIGHT_TEMPLATES = {
    compact: { alpha: 0.35, beta: 0.10, gamma: 0.15, delta: 0.25, epsilon: 0.15 },
    relaxed: { alpha: 0.25, beta: 0.15, gamma: 0.30, delta: 0.15, epsilon: 0.15 },
    indepth: { alpha: 0.20, beta: 0.20, gamma: 0.20, delta: 0.20, epsilon: 0.20 }
};

// 补全缺失的导出
export const COUNTY_SPOT_KEYWORDS = ['轿房沟美食街', '银耳博物馆', '红四方面军总指挥部旧址纪念馆', '省委党校旧址纪念馆', '通江花月夜'];
export const LONG_SPOT_NAMES = ['空山天盆', '诺水河溶洞', '王坪烈士陵园', '红军烈士陵园'];
export const ALLOWED_CATEGORIES = ['自然景区', '红色景区', '文博场馆'];
export const NON_VISIT_CATEGORIES = ['交通枢纽','餐饮住宿','公共服务','特产购物','游玩娱乐'];
export const EXCLUDED_TRANSPORT_CATS = ['公共服务','游玩娱乐','特产购物'];
export const COUNTY = { lat:31.911705, lng:107.245033, name:'红军广场', id:'county' };