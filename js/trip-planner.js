// js/trip-planner.js - 智能行程规划引擎
// 遵循所有确认规则：紧凑/舒适/深度模式、内部节点选取、午晚餐插入、跨天逻辑、交通提醒等

import { formatTime, timeToMinutes, getDistance, fetchWeatherForecast, getDayWeatherTip } from './utils.js';
import { getTransportPresets } from './api.js';
import { DAY_START, DAY_END, LUNCH_START, LUNCH_END, DINNER_START, DINNER_END, MEAL_DURATION } from './config.js';

// ============================================================
// 行程规划主类
// ============================================================
export class TripPlanner {
    /**
     * @param {Array} pois - 用户选择的景点列表（每个需含id, name, lat, lng, visit_duration, nodes?）
     * @param {string} startDate - YYYY-MM-DD
     * @param {string} startTime - HH:MM
     * @param {number} days - 计划天数
     * @param {string} mode - 'compact' | 'relaxed' | 'indepth'
     * @param {Object} travelTimes - 交通矩阵 { fromId_toId: minutes }
     * @param {Object} poiNodesMap - { poiId: [nodes] } 预加载的内部节点列表
     * @param {Array} accommodationPois - 所有住宿型POI列表
     */
    constructor(pois, startDate, startTime, days, mode, travelTimes, poiNodesMap, accommodationPois) {
        this.pois = pois;
        this.startDate = startDate;
        this.startTime = startTime;
        this.days = days;
        this.mode = mode;
        this.travelTimes = travelTimes;
        this.poiNodesMap = poiNodesMap;
        this.accommodationPois = accommodationPois;

        // 状态
        this.currentDate = new Date(startDate);
        this.currentTime = timeToMinutes(startTime);
        this.currentDay = 1;
        this.lastPoiId = 'county'; // 当前所在地
        this.isAccommodationAtScenic = false; // 是否在景区住宿
        this.dayNodes = []; // 当天节点
        this.allDays = [];
        this.warnings = [];
        this.weatherForecast = null; // 后续获取
        this.totalTravelMinutes = 0;
        this.totalVisitMinutes = 0;
        this.totalWaitingMinutes = 0;
        this.accommodationPoiMap = {}; // id -> poi
        accommodationPois.forEach(p => this.accommodationPoiMap[p.id] = p);
    }

    // 核心执行方法
    async plan() {
        // 获取天气
        this.weatherForecast = await fetchWeatherForecast();

        // 按顺序处理每个POI
        for (let poi of this.pois) {
            const nodes = this.selectNodes(poi);
            if (!nodes || nodes.length === 0) {
                this.warnings.push(`景区 ${poi.name} 无游览节点，已跳过`);
                continue;
            }
            // 计算总游览时长（使用最短时间）
            const totalDuration = nodes.reduce((sum, n) => sum + (n.suggested_duration_min || 0), 0);
            poi._selectedNodes = nodes;
            poi._totalDuration = totalDuration;

            // 安排该POI
            const result = this.schedulePoi(poi);
            if (result.error) {
                this.warnings.push(result.error);
                continue;
            }
            // 更新当前时间和位置
            this.currentTime = result.newTime;
            this.lastPoiId = poi.id;
            // 如果当前时间 >= DAY_END，自动跨天
            if (this.currentTime >= DAY_END) {
                this.finishDay();
                this.moveToNextDay();
            }
        }

        // 最后一天结束
        this.finishDay();

        // 生成天气提醒和交通/游览时长提醒
        this.addReminders();

        return {
            days: this.allDays,
            warnings: this.warnings,
            totalTravel: this.totalTravelMinutes,
            totalVisit: this.totalVisitMinutes,
            totalWaiting: this.totalWaitingMinutes
        };
    }

    // 根据模式选取节点
    selectNodes(poi) {
        const nodes = this.poiNodesMap[poi.id] || [];
        if (this.mode === 'compact') {
            return nodes.filter(n => n.node_type === 'core_view');
        } else if (this.mode === 'relaxed') {
            const core = nodes.filter(n => n.node_type === 'core_view');
            const others = nodes.filter(n => n.node_type !== 'core_view' && !['rest_area', 'wc'].includes(n.node_type));
            // 额外选2个一般景点（尽可能选有名称的）
            const selectedOthers = [];
            if (others.length > 0) {
                // 按名称长度或评分选2个（简单取前2个）
                for (let i = 0; i < Math.min(2, others.length); i++) {
                    selectedOthers.push(others[i]);
                }
            }
            return [...core, ...selectedOthers];
        } else { // indepth
            return nodes.filter(n => !['rest_area', 'wc'].includes(n.node_type));
        }
    }

    // 安排单个POI（包含交通、节点游览、就餐插入）
    schedulePoi(poi) {
        const travel = this.getTravelTime(this.lastPoiId, poi.id);
        let startTime = this.currentTime;

        // 检查出发时间+交通是否 >= 8:00
        const arrivalTime = startTime + travel;
        if (arrivalTime < DAY_START) {
            // 强制调整出发时间，使得到达时间为8:00
            const adjust = DAY_START - arrivalTime;
            this.currentTime += adjust;
            // 记录等待
            if (adjust > 0) {
                this.addWaiting(adjust);
                this.addNode({ type: 'waiting', name: '等待景区开放', startTime: startTime, endTime: this.currentTime, duration: adjust });
                startTime = this.currentTime;
            }
        }

        // 若到达时间已超过18:00，跨天
        if (arrivalTime >= DAY_END) {
            // 强制跨天，移到第二天8:00
            this.finishDay();
            this.moveToNextDay();
            // 重新计算交通（从县城出发）
            const newTravel = this.getTravelTime('county', poi.id);
            this.currentTime = DAY_START + newTravel;
            this.lastPoiId = 'county';
            return this.schedulePoi(poi); // 递归，但避免死循环（因为跨天后时间变了）
        }

        // 插入交通节点
        const travelNode = {
            type: 'transport',
            name: `前往 ${poi.name}`,
            startTime: startTime,
            endTime: startTime + travel,
            duration: travel,
            from: this.lastPoiId,
            to: poi.id
        };
        this.addNode(travelNode);
        this.totalTravelMinutes += travel;
        let currentTime = startTime + travel;

        // 交通耗时中触发午餐/晚餐：到达后立即检查
        // 检查是否跨越了午餐或晚餐窗口（包括12:30后和18:00后）
        const crossedMeal = this.checkTransportMealCross(currentTime, startTime);
        if (crossedMeal) {
            const mealNode = this.createMealNode(crossedMeal, currentTime);
            if (mealNode) {
                this.addNode(mealNode);
                currentTime = mealNode.endTime;
            }
        }

        // 游览内部节点
        const nodes = poi._selectedNodes;
        for (let node of nodes) {
            // 检查游览前是否到达用餐窗口
            const meal = this.checkVisitMealTrigger(currentTime, node.suggested_duration_min || 0);
            if (meal) {
                const mealNode = this.createMealNode(meal, currentTime);
                if (mealNode) {
                    this.addNode(mealNode);
                    currentTime = mealNode.endTime;
                }
            }

            // 游览节点
            const visitDuration = node.suggested_duration_min || 0;
            if (visitDuration > 0) {
                const visitNode = {
                    type: 'visit',
                    name: node.node_name || '游览',
                    nodeType: node.node_type,
                    startTime: currentTime,
                    endTime: currentTime + visitDuration,
                    duration: visitDuration,
                    poiId: poi.id,
                    poiName: poi.name
                };
                this.addNode(visitNode);
                this.totalVisitMinutes += visitDuration;
                currentTime += visitDuration;
            }
        }

        // 游览结束后，检查是否在午餐/晚餐窗口内（若游览刚好结束在窗口内）
        const mealAfter = this.checkMealAfterVisit(currentTime);
        if (mealAfter) {
            const mealNode = this.createMealNode(mealAfter, currentTime);
            if (mealNode) {
                this.addNode(mealNode);
                currentTime = mealNode.endTime;
            }
        }

        return { newTime: currentTime, error: null };
    }

    // 获取交通时间
    getTravelTime(fromId, toId) {
        if (fromId === toId) return 0;
        const key = `${fromId}_${toId}`;
        let t = this.travelTimes[key];
        if (t === undefined) {
            // 尝试反向
            const reverseKey = `${toId}_${fromId}`;
            t = this.travelTimes[reverseKey];
        }
        if (t === undefined) {
            // 若没有预设，则根据地理距离估算（步行速度 5km/h）
            const fromPoi = this.getPoiById(fromId);
            const toPoi = this.getPoiById(toId);
            if (fromPoi && toPoi) {
                const dist = getDistance(fromPoi.lat, fromPoi.lng, toPoi.lat, toPoi.lng);
                t = Math.round(dist / 5000 * 60); // 分钟
                console.warn(`交通 ${fromId}->${toId} 未预设，按距离估算 ${t} 分钟`);
            } else {
                t = 30; // 默认
            }
        }
        return t;
    }

    getPoiById(id) {
        if (id === 'county') return { name: '红军广场', lat: 31.911705, lng: 107.245033 };
        return this.pois.find(p => p.id === id);
    }

    // 检查交通耗时中是否跨越午餐/晚餐
    checkTransportMealCross(currentTime, startTime) {
        // 午餐：若到达时间 >= 11:30 且 < 12:30，且出发时间 < 11:30
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END && startTime < LUNCH_START) {
            return 'lunch';
        }
        // 晚餐：若到达时间 >= 17:30 且 < 18:30，且出发时间 < 17:30
        if (currentTime >= DINNER_START && currentTime < DINNER_END && startTime < DINNER_START) {
            return 'dinner';
        }
        // 若到达时间超过12:30但出发时间在午餐窗口内，已在游览过程中处理
        return null;
    }

    // 检查游览前是否触发午晚餐（窗口内）
    checkVisitMealTrigger(currentTime, remainingDuration) {
        // 午餐
        if (currentTime < LUNCH_START && currentTime + remainingDuration > LUNCH_START) {
            // 若剩余游览时间 < 60，且当前时间 < 11:30，则先游览，游览结束后再插入午餐（在 checkMealAfterVisit 处理）
            if (remainingDuration < 60) return null;
            return 'lunch';
        }
        // 若当前时间已在午餐窗口内
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END) {
            return 'lunch';
        }
        // 晚餐
        if (currentTime < DINNER_START && currentTime + remainingDuration > DINNER_START) {
            if (remainingDuration < 60) return null;
            return 'dinner';
        }
        if (currentTime >= DINNER_START && currentTime < DINNER_END) {
            return 'dinner';
        }
        return null;
    }

    // 检查游览结束后是否触发午晚餐（若剩余时间不足60）
    checkMealAfterVisit(currentTime) {
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END) {
            return 'lunch';
        }
        if (currentTime >= DINNER_START && currentTime < DINNER_END) {
            return 'dinner';
        }
        return null;
    }

    // 创建餐食节点
    createMealNode(type, startTime) {
        let start = startTime;
        let duration = MEAL_DURATION;
        if (type === 'lunch') {
            if (start < LUNCH_START) start = LUNCH_START;
            if (start + duration > DAY_END) duration = DAY_END - start;
            return { type: 'meal', name: '午餐时间', startTime: start, endTime: start + duration, duration: duration };
        } else if (type === 'dinner') {
            if (start < DINNER_START) start = DINNER_START;
            if (start + duration > DAY_END + 60) duration = 60; // 允许延长到19:00
            return { type: 'meal', name: '晚餐时间', startTime: start, endTime: start + duration, duration: duration };
        }
        return null;
    }

    // 添加节点到当天
    addNode(node) {
        this.dayNodes.push(node);
    }

    // 添加等待
    addWaiting(minutes) {
        this.totalWaitingMinutes += minutes;
    }

    // 结束当天
    finishDay() {
        if (this.dayNodes.length > 0) {
            // 检查是否需要返回县城（若当天最后一个节点不是县城且不是住宿）
            const last = this.dayNodes[this.dayNodes.length - 1];
            if (last.type !== 'accommodation' && this.lastPoiId !== 'county') {
                const returnTravel = this.getTravelTime(this.lastPoiId, 'county');
                if (returnTravel > 0) {
                    const returnNode = {
                        type: 'transport',
                        name: '返回县城',
                        startTime: this.currentTime,
                        endTime: this.currentTime + returnTravel,
                        duration: returnTravel,
                        from: this.lastPoiId,
                        to: 'county'
                    };
                    this.addNode(returnNode);
                    this.totalTravelMinutes += returnTravel;
                    this.currentTime += returnTravel;
                    this.lastPoiId = 'county';
                }
            }
            // 添加住宿节点（若不在景区住宿，则默认县城住宿）
            const accommodationNode = {
                type: 'accommodation',
                name: this.isAccommodationAtScenic ? '景区住宿' : '县城住宿',
                startTime: this.currentTime,
                endTime: this.currentTime + 1, // 占位
                location: this.isAccommodationAtScenic ? this.lastPoiId : 'county'
            };
            this.addNode(accommodationNode);

            // 存储当天
            this.allDays.push({
                day: this.currentDay,
                date: this.currentDate.toISOString().slice(0, 10),
                nodes: this.dayNodes
            });
            this.dayNodes = [];
            this.isAccommodationAtScenic = false;
            this.currentDay++;
        }
    }

    // 移到下一天
    moveToNextDay() {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentTime = DAY_START;
        // 若上一天在景区住宿，则起点为景区入口，否则为县城
        // 此处设定由调度逻辑控制，我们重置 lastPoiId 为县城（若未住宿）
        // 但若在景区住宿，应在finishDay中设置 lastPoiId = 景区id
        // 为简化，我们在调度中处理
    }

    // 添加提醒
    addReminders() {
        // 天气
        if (this.weatherForecast) {
            // 每天添加天气提示
            for (let i = 0; i < this.allDays.length; i++) {
                const day = this.allDays[i];
                const dayIndex = i;
                if (this.weatherForecast[dayIndex]) {
                    const tip = getDayWeatherTip(this.weatherForecast[dayIndex]);
                    // 将天气提醒作为特殊节点插入当天最后
                    day.nodes.push({ type: 'weather', message: tip });
                }
            }
        }

        // 交通时长提醒
        let dailyTravel = 0;
        for (let day of this.allDays) {
            dailyTravel = 0;
            let dailyVisit = 0;
            let singleLongTravel = false;
            for (let node of day.nodes) {
                if (node.type === 'transport') {
                    dailyTravel += node.duration || 0;
                    if ((node.duration || 0) > 120) singleLongTravel = true;
                }
                if (node.type === 'visit') dailyVisit += node.duration || 0;
            }
            if (singleLongTravel) {
                day.nodes.push({ type: 'reminder', message: '⚠️ 本段交通较长（超过2小时），请准备休息' });
            }
            if (dailyTravel > 180) {
                day.nodes.push({ type: 'reminder', message: '⚠️ 今日交通较多（累计超过3小时），建议途中适当休息' });
            }
            if (dailyVisit > 300) {
                day.nodes.push({ type: 'reminder', message: '⚠️ 今日游览时间较长（超过5小时），注意体力' });
            }
        }
    }

    // 住宿推荐（查找最近的住宿POI）
    findNearestAccommodation(poiId) {
        const poi = this.getPoiById(poiId);
        if (!poi) return null;
        let nearest = null;
        let minDist = Infinity;
        for (let id in this.accommodationPoiMap) {
            const acc = this.accommodationPoiMap[id];
            if (!acc.lat || !acc.lng) continue;
            const dist = getDistance(poi.lat, poi.lng, acc.lat, acc.lng);
            if (dist < minDist) {
                minDist = dist;
                nearest = acc;
            }
        }
        if (nearest && minDist <= 5000) return nearest;
        // 若超过5公里，返回县城（红军广场）
        const county = this.getPoiById('county');
        return county ? { id: 'county', name: '红军广场', lat: county.lat, lng: county.lng } : null;
    }
}

// ============================================================
// 对外暴露的工厂函数（供 UI 调用）
// ============================================================
export async function generateTripPlan(pois, startDate, startTime, days, mode, travelTimes, poiNodesMap, accommodationPois) {
    const planner = new TripPlanner(pois, startDate, startTime, days, mode, travelTimes, poiNodesMap, accommodationPois);
    return await planner.plan();
}