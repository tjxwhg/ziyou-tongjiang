// js/trip-planner.js - 智能行程规划引擎（修复版）
import { formatTime, timeToMinutes, getDistance, fetchWeatherForecast, getDayWeatherTip } from './utils.js';
import { DAY_START, DAY_END, LUNCH_START, LUNCH_END, DINNER_START, DINNER_END, MEAL_DURATION } from './config.js';

// ============================================================
// 行程规划主类
// ============================================================
export class TripPlanner {
    constructor(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois) {
        this.pois = pois || [];
        this.startDate = startDate || new Date().toISOString().slice(0, 10);
        this.startTime = startTime || '08:00';
        this.mode = mode || 'relaxed';
        this.travelTimes = travelTimes || {};
        this.poiNodesMap = poiNodesMap || {};
        this.accommodationPois = accommodationPois || [];

        this.currentDate = new Date(this.startDate);
        this.currentTime = timeToMinutes(this.startTime) || DAY_START;
        this.currentDay = 1;
        this.lastPoiId = 'county';
        this.dayNodes = [];
        this.allDays = [];
        this.warnings = [];
        this.weatherForecast = null;
        this.totalTravelMinutes = 0;
        this.totalVisitMinutes = 0;
        this.totalWaitingMinutes = 0;
        this.accommodationPoiMap = {};
        this.accommodationPois.forEach(p => { if (p && p.id) this.accommodationPoiMap[p.id] = p; });
        this.maxDays = 5;
    }

    async plan() {
        this.weatherForecast = await fetchWeatherForecast();

        for (let poi of this.pois) {
            if (this.currentDay > this.maxDays) {
                this.warnings.push(`行程超过 ${this.maxDays} 天，剩余景点 ${poi ? poi.name : '未知'} 未安排`);
                break;
            }

            // 选择节点
            const nodes = this.selectNodes(poi);
            if (!nodes || nodes.length === 0) {
                const fallbackNode = {
                    node_name: poi ? poi.name : '未知景点',
                    node_type: 'poi',
                    suggested_duration_min: (poi && poi.visit_duration) || 60,
                    isFallback: true
                };
                poi._remainingNodes = [fallbackNode];
                poi._totalDuration = fallbackNode.suggested_duration_min;
            } else {
                poi._remainingNodes = nodes.slice(); // 复制节点列表
                poi._totalDuration = nodes.reduce((sum, n) => sum + (n.suggested_duration_min || 0), 0);
            }

            // 安排该POI（迭代处理）
            this.schedulePoiIterative(poi);
        }

        this.finishDay();
        this.addReminders();

        return {
            days: this.allDays,
            warnings: this.warnings,
            totalTravel: this.totalTravelMinutes,
            totalVisit: this.totalVisitMinutes,
            totalWaiting: this.totalWaitingMinutes
        };
    }

    // 迭代安排一个POI（支持分段跨天）
    schedulePoiIterative(poi) {
        if (!poi || !poi._remainingNodes || poi._remainingNodes.length === 0) return;

        let remainingNodes = poi._remainingNodes;
        let nodeIndex = 0;

        while (nodeIndex < remainingNodes.length) {
            // 检查是否超出最大天数
            if (this.currentDay > this.maxDays) {
                this.warnings.push(`行程超过 ${this.maxDays} 天，剩余节点 ${remainingNodes[nodeIndex].node_name} 未安排`);
                break;
            }

            // 计算交通
            const travel = this.getTravelTime(this.lastPoiId, poi.id);
            let startTime = this.currentTime;

            // 调整出发时间以保证到达 >= 8:00
            if (startTime + travel < DAY_START) {
                const adjust = DAY_START - (startTime + travel);
                this.currentTime += adjust;
                if (adjust > 0) {
                    this.addWaiting(adjust);
                    this.addNode({ type: 'waiting', name: '等待景区开放', startTime: startTime, endTime: this.currentTime, duration: adjust });
                    startTime = this.currentTime;
                }
            }

            // 若到达时间已超过18:00，跨天
            if (startTime + travel >= DAY_END) {
                // 先结束当天，移到下一天
                this.finishDay();
                this.moveToNextDay();
                // 重新计算交通（从县城出发）
                this.lastPoiId = 'county';
                continue; // 重新循环，从下一天开始
            }

            // 插入交通
            const arrivalTime = startTime + travel;
            const travelNode = {
                type: 'transport',
                name: `前往 ${poi.name}`,
                startTime: startTime,
                endTime: arrivalTime,
                duration: travel,
                from: this.lastPoiId,
                to: poi.id
            };
            this.addNode(travelNode);
            this.totalTravelMinutes += travel;
            let currentTime = arrivalTime;
            this.lastPoiId = poi.id;

            // 交通后检查就餐
            const crossedMeal = this.checkTransportMealCross(currentTime, startTime);
            if (crossedMeal) {
                const mealNode = this.createMealNode(crossedMeal, currentTime);
                if (mealNode) {
                    this.addNode(mealNode);
                    currentTime = mealNode.endTime;
                }
            }

            // 游览当前节点（可能只游览一部分）
            const node = remainingNodes[nodeIndex];
            const remainingDuration = node.suggested_duration_min || 0;
            let visitTime = remainingDuration;

            // 检查当天剩余时间（到18:00）
            let maxToday = DAY_END - currentTime;
            if (maxToday <= 0) {
                // 当天无剩余时间，跨天
                this.finishDay();
                this.moveToNextDay();
                this.lastPoiId = 'county';
                continue;
            }

            // 游览时间不能超过当天剩余时间
            let todayVisit = Math.min(visitTime, maxToday);
            let remaining = visitTime - todayVisit;

            // 检查午餐/晚餐插入（在游览前）
            const mealBefore = this.checkVisitMealTrigger(currentTime, todayVisit);
            if (mealBefore) {
                const mealNode = this.createMealNode(mealBefore, currentTime);
                if (mealNode) {
                    this.addNode(mealNode);
                    currentTime = mealNode.endTime;
                    // 重新计算剩余可游览时间
                    maxToday = DAY_END - currentTime;
                    todayVisit = Math.min(visitTime, maxToday);
                    remaining = visitTime - todayVisit;
                }
            }

            if (todayVisit > 0) {
                const visitNode = {
                    type: 'visit',
                    name: node.node_name || poi.name,
                    nodeType: node.node_type || 'poi',
                    startTime: currentTime,
                    endTime: currentTime + todayVisit,
                    duration: todayVisit,
                    poiId: poi.id,
                    poiName: poi.name
                };
                this.addNode(visitNode);
                this.totalVisitMinutes += todayVisit;
                currentTime += todayVisit;
            }

            // 游览后检查就餐
            const mealAfter = this.checkMealAfterVisit(currentTime);
            if (mealAfter) {
                const mealNode = this.createMealNode(mealAfter, currentTime);
                if (mealNode) {
                    this.addNode(mealNode);
                    currentTime = mealNode.endTime;
                }
            }

            // 更新当前时间
            this.currentTime = currentTime;

            if (remaining > 0) {
                // 该节点未游览完，剩余部分保存到节点中，跨天继续
                node.suggested_duration_min = remaining;
                // 结束当天，移到下一天
                this.finishDay();
                this.moveToNextDay();
                this.lastPoiId = 'county';
                // 不推进nodeIndex，继续处理同一节点
            } else {
                // 节点已游览完，推进到下一个节点
                nodeIndex++;
            }

            // 如果当前时间 >= DAY_END，强制跨天
            if (this.currentTime >= DAY_END) {
                this.finishDay();
                this.moveToNextDay();
                this.lastPoiId = 'county';
            }
        }
    }

    // 选择节点（根据模式）
    selectNodes(poi) {
        if (!poi || !poi.id) return null;
        const nodes = this.poiNodesMap[poi.id] || [];
        if (this.mode === 'compact') {
            const core = nodes.filter(n => n.node_type === 'core_view');
            if (core.length > 0) return core;
            const others = nodes.filter(n => !['rest_area', 'wc'].includes(n.node_type));
            return others.length > 0 ? others : null;
        } else if (this.mode === 'relaxed') {
            const core = nodes.filter(n => n.node_type === 'core_view');
            const others = nodes.filter(n => n.node_type !== 'core_view' && !['rest_area', 'wc'].includes(n.node_type));
            const selectedOthers = [];
            for (let i = 0; i < Math.min(2, others.length); i++) {
                selectedOthers.push(others[i]);
            }
            const result = [...core, ...selectedOthers];
            return result.length > 0 ? result : null;
        } else {
            const filtered = nodes.filter(n => !['rest_area', 'wc'].includes(n.node_type));
            return filtered.length > 0 ? filtered : null;
        }
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

    // 检查交通跨越就餐
    checkTransportMealCross(currentTime, startTime) {
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END && startTime < LUNCH_START) return 'lunch';
        if (currentTime >= DINNER_START && currentTime < DINNER_END && startTime < DINNER_START) return 'dinner';
        return null;
    }

    // 游览前触发就餐
    checkVisitMealTrigger(currentTime, remainingDuration) {
        if (currentTime < LUNCH_START && currentTime + remainingDuration > LUNCH_START) {
            if (remainingDuration < 60) return null;
            return 'lunch';
        }
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END) return 'lunch';
        if (currentTime < DINNER_START && currentTime + remainingDuration > DINNER_START) {
            if (remainingDuration < 60) return null;
            return 'dinner';
        }
        if (currentTime >= DINNER_START && currentTime < DINNER_END) return 'dinner';
        return null;
    }

    // 游览后触发就餐
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

    addNode(node) {
        if (node) this.dayNodes.push(node);
    }

    addWaiting(minutes) {
        this.totalWaitingMinutes += minutes;
    }

    finishDay() {
        if (this.dayNodes.length === 0) return;
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
        const accommodationNode = {
            type: 'accommodation',
            name: this.isAccommodationAtScenic ? '景区住宿' : '县城住宿',
            startTime: this.currentTime,
            endTime: this.currentTime + 1,
            location: this.isAccommodationAtScenic ? this.lastPoiId : 'county'
        };
        this.addNode(accommodationNode);

        this.allDays.push({
            day: this.currentDay,
            date: this.currentDate.toISOString().slice(0, 10),
            nodes: this.dayNodes
        });
        this.dayNodes = [];
        this.isAccommodationAtScenic = false;
        this.currentDay++;
    }

    moveToNextDay() {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentTime = DAY_START;
        this.lastPoiId = 'county';
    }

    addReminders() {
        if (this.weatherForecast) {
            for (let i = 0; i < this.allDays.length; i++) {
                const day = this.allDays[i];
                if (this.weatherForecast[i]) {
                    const tip = getDayWeatherTip(this.weatherForecast[i]);
                    day.nodes.push({ type: 'weather', message: tip });
                }
            }
        }
        for (let day of this.allDays) {
            let dailyTravel = 0, dailyVisit = 0, singleLongTravel = false;
            for (let node of day.nodes) {
                if (node.type === 'transport') {
                    dailyTravel += node.duration || 0;
                    if ((node.duration || 0) > 120) singleLongTravel = true;
                }
                if (node.type === 'visit') dailyVisit += node.duration || 0;
            }
            if (singleLongTravel) day.nodes.push({ type: 'reminder', message: '⚠️ 本段交通较长（超过2小时），请准备休息' });
            if (dailyTravel > 180) day.nodes.push({ type: 'reminder', message: '⚠️ 今日交通较多（累计超过3小时），建议途中适当休息' });
            if (dailyVisit > 300) day.nodes.push({ type: 'reminder', message: '⚠️ 今日游览时间较长（超过5小时），注意体力' });
        }
    }
}

// ============================================================
// 对外工厂函数
// ============================================================
export async function generateTripPlan(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois) {
    if (!pois || pois.length === 0) {
        return { days: [], warnings: ['没有选择景点'], totalTravel: 0, totalVisit: 0, totalWaiting: 0 };
    }
    const planner = new TripPlanner(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois);
    return await planner.plan();
}
