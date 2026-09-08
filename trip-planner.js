// js/trip-planner.js - 智能行程规划引擎
import { formatTime, timeToMinutes, getDistance, fetchWeatherForecast, getDayWeatherTip } from './utils.js';
import { getTransportPresets } from './api.js';
import { DAY_START, DAY_END, LUNCH_START, LUNCH_END, DINNER_START, DINNER_END, MEAL_DURATION } from './config.js';

// ============================================================
// 行程规划主类
// ============================================================
export class TripPlanner {
    /**
     * @param {Array} pois - 用户选择的景点列表
     * @param {string} startDate - YYYY-MM-DD
     * @param {string} startTime - HH:MM
     * @param {string} mode - 'compact' | 'relaxed' | 'indepth'
     * @param {Object} travelTimes - 交通矩阵 { fromId_toId: minutes }
     * @param {Object} poiNodesMap - { poiId: [nodes] }
     * @param {Array} accommodationPois - 所有住宿型POI列表
     */
    constructor(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois) {
        // 参数空值保护
        this.pois = pois || [];
        this.startDate = startDate || new Date().toISOString().slice(0, 10);
        this.startTime = startTime || '08:00';
        this.mode = mode || 'relaxed';
        this.travelTimes = travelTimes || {};
        this.poiNodesMap = poiNodesMap || {};
        this.accommodationPois = accommodationPois || [];

        // 状态
        this.currentDate = new Date(this.startDate);
        this.currentTime = timeToMinutes(this.startTime) || DAY_START;
        this.currentDay = 1;
        this.lastPoiId = 'county';
        this.isAccommodationAtScenic = false;
        this.dayNodes = [];
        this.allDays = [];
        this.warnings = [];
        this.weatherForecast = null;
        this.totalTravelMinutes = 0;
        this.totalVisitMinutes = 0;
        this.totalWaitingMinutes = 0;
        this.accommodationPoiMap = {};
        this.accommodationPois.forEach(p => {
            if (p && p.id) this.accommodationPoiMap[p.id] = p;
        });
        this.maxDays = 5; // 最大天数限制
    }

    // 核心执行方法
    async plan() {
        // 获取天气
        this.weatherForecast = await fetchWeatherForecast();

        // 按顺序处理每个POI
        for (let poi of this.pois) {
            // 检查是否超出最大天数
            if (this.currentDay > this.maxDays) {
                this.warnings.push(`行程超过 ${this.maxDays} 天，剩余景点 ${poi ? poi.name : '未知'} 未安排`);
                break;
            }

            const nodes = this.selectNodes(poi);
            if (!nodes || nodes.length === 0) {
                // 如果没有节点，使用POI本身作为一个游览节点
                const fallbackNode = {
                    node_name: poi ? poi.name : '未知景点',
                    node_type: 'poi',
                    suggested_duration_min: (poi && poi.visit_duration) || 60,
                    isFallback: true
                };
                poi._selectedNodes = [fallbackNode];
                poi._totalDuration = fallbackNode.suggested_duration_min;
            } else {
                // 计算总游览时长（使用最短时间）
                const totalDuration = nodes.reduce((sum, n) => sum + (n.suggested_duration_min || 0), 0);
                poi._selectedNodes = nodes;
                poi._totalDuration = totalDuration;
            }

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
                // 如果跨天后天数超出限制，停止安排
                if (this.currentDay > this.maxDays) {
                    this.warnings.push(`行程超过 ${this.maxDays} 天，剩余景点已停止安排`);
                    break;
                }
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
        if (!poi || !poi.id) return null;
        const nodes = this.poiNodesMap[poi.id] || [];
        if (this.mode === 'compact') {
            const core = nodes.filter(n => n.node_type === 'core_view');
            if (core.length > 0) return core;
            // 无核心节点则返回所有非休息区/洗手间的节点
            const others = nodes.filter(n => !['rest_area', 'wc'].includes(n.node_type));
            return others.length > 0 ? others : null;
        } else if (this.mode === 'relaxed') {
            const core = nodes.filter(n => n.node_type === 'core_view');
            const others = nodes.filter(n => n.node_type !== 'core_view' && !['rest_area', 'wc'].includes(n.node_type));
            // 核心 + 2个一般景点
            const selectedOthers = [];
            for (let i = 0; i < Math.min(2, others.length); i++) {
                selectedOthers.push(others[i]);
            }
            const result = [...core, ...selectedOthers];
            return result.length > 0 ? result : null;
        } else { // indepth
            const filtered = nodes.filter(n => !['rest_area', 'wc'].includes(n.node_type));
            return filtered.length > 0 ? filtered : null;
        }
    }

    // 安排单个POI（包含交通、节点游览、就餐插入）
    schedulePoi(poi) {
        if (!poi) return { newTime: this.currentTime, error: '无效的景点' };
        const travel = this.getTravelTime(this.lastPoiId, poi.id);
        let startTime = this.currentTime;

        // 检查出发时间+交通是否 >= 8:00
        const arrivalTime = startTime + travel;
        if (arrivalTime < DAY_START) {
            // 强制调整出发时间，使得到达时间为8:00
            const adjust = DAY_START - arrivalTime;
            this.currentTime += adjust;
            if (adjust > 0) {
                this.addWaiting(adjust);
                this.addNode({ type: 'waiting', name: '等待景区开放', startTime: startTime, endTime: this.currentTime, duration: adjust });
                startTime = this.currentTime;
            }
        }

        // 若到达时间已超过18:00，跨天
        if (arrivalTime >= DAY_END) {
            this.finishDay();
            this.moveToNextDay();
            // 重新计算交通（从县城出发）
            const newTravel = this.getTravelTime('county', poi.id);
            this.currentTime = DAY_START + newTravel;
            this.lastPoiId = 'county';
            return this.schedulePoi(poi);
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
        const crossedMeal = this.checkTransportMealCross(currentTime, startTime);
        if (crossedMeal) {
            const mealNode = this.createMealNode(crossedMeal, currentTime);
            if (mealNode) {
                this.addNode(mealNode);
                currentTime = mealNode.endTime;
            }
        }

        // 游览内部节点
        const nodes = poi._selectedNodes || [];
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
                    name: node.node_name || poi.name,
                    nodeType: node.node_type || 'poi',
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

        // 游览结束后，检查是否在午餐/晚餐窗口内（若游览结束刚好在窗口内）
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
            const reverseKey = `${toId}_${fromId}`;
            t = this.travelTimes[reverseKey];
        }
        if (t === undefined) {
            const fromPoi = this.getPoiById(fromId);
            const toPoi = this.getPoiById(toId);
            if (fromPoi && toPoi && fromPoi.lat && fromPoi.lng && toPoi.lat && toPoi.lng) {
                const dist = getDistance(fromPoi.lat, fromPoi.lng, toPoi.lat, toPoi.lng);
                t = Math.round(dist / 5000 * 60);
            } else {
                t = 30;
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
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END && startTime < LUNCH_START) return 'lunch';
        if (currentTime >= DINNER_START && currentTime < DINNER_END && startTime < DINNER_START) return 'dinner';
        return null;
    }

    // 检查游览前是否触发午晚餐（窗口内）
    checkVisitMealTrigger(currentTime, remainingDuration) {
        // 午餐
        if (currentTime < LUNCH_START && currentTime + remainingDuration > LUNCH_START) {
            if (remainingDuration < 60) return null;
            return 'lunch';
        }
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END) return 'lunch';
        // 晚餐
        if (currentTime < DINNER_START && currentTime + remainingDuration > DINNER_START) {
            if (remainingDuration < 60) return null;
            return 'dinner';
        }
        if (currentTime >= DINNER_START && currentTime < DINNER_END) return 'dinner';
        return null;
    }

    // 检查游览结束后是否触发午晚餐（若剩余时间不足60）
    checkMealAfterVisit(currentTime) {
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END) return 'lunch';
        if (currentTime >= DINNER_START && currentTime < DINNER_END) return 'dinner';
        return null;
    }

    // 创建餐食节点
    createMealNode(type, startTime) {
        let start = startTime;
        let duration = MEAL_DURATION;
        if (type === 'lunch') {
            if (start < LUNCH_START) start = LUNCH_START;
            if (start + duration > DAY_END) duration = DAY_END - start;
            if (duration <= 0) return null;
            return { type: 'meal', name: '午餐时间', startTime: start, endTime: start + duration, duration: duration };
        } else if (type === 'dinner') {
            if (start < DINNER_START) start = DINNER_START;
            if (start + duration > DAY_END + 60) duration = 60;
            if (duration <= 0) return null;
            return { type: 'meal', name: '晚餐时间', startTime: start, endTime: start + duration, duration: duration };
        }
        return null;
    }

    // 添加节点到当天
    addNode(node) {
        if (node) this.dayNodes.push(node);
    }

    // 添加等待
    addWaiting(minutes) {
        this.totalWaitingMinutes += minutes;
    }

    // 结束当天
    finishDay() {
        if (this.dayNodes.length === 0) return;
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
            endTime: this.currentTime + 1,
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

    // 移到下一天
    moveToNextDay() {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentTime = DAY_START;
        // 重置lastPoiId为县城（若前一天在景区住宿，由调度逻辑处理）
        this.lastPoiId = 'county';
    }

    // 添加提醒
    addReminders() {
        if (this.weatherForecast) {
            for (let i = 0; i < this.allDays.length; i++) {
                const day = this.allDays[i];
                const dayIndex = i;
                if (this.weatherForecast[dayIndex]) {
                    const tip = getDayWeatherTip(this.weatherForecast[dayIndex]);
                    day.nodes.push({ type: 'weather', message: tip });
                }
            }
        }

        for (let day of this.allDays) {
            let dailyTravel = 0;
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
        const county = this.getPoiById('county');
        return county ? { id: 'county', name: '红军广场', lat: county.lat, lng: county.lng } : null;
    }
}

// ============================================================
// 对外暴露的工厂函数
// ============================================================
export async function generateTripPlan(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois) {
    if (!pois || pois.length === 0) {
        return { days: [], warnings: ['没有选择景点'], totalTravel: 0, totalVisit: 0, totalWaiting: 0 };
    }
    const planner = new TripPlanner(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois);
    return await planner.plan();
}