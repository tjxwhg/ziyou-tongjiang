// js/trip-planner.js - 智能行程规划引擎（修复显示问题）
import { formatTime, timeToMinutes, getDistance, fetchWeatherForecast, getDayWeatherTip } from './utils.js';
import { DAY_START, DAY_END, LUNCH_START, LUNCH_END, DINNER_START, DINNER_END, MEAL_DURATION } from './config.js';

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
        this.currentTime = timeToMinutes(this.startTime);
        this.currentDay = 1;
        this.lastPoiId = 'county';
        this.dayNodes = [];
        this.allDays = [];
        this.warnings = [];
        this.weatherForecast = null;
        this.totalTravelMinutes = 0;
        this.totalVisitMinutes = 0;
        this.totalWaitingMinutes = 0;
        this.maxDays = 5;
        this.accommodationPoiMap = {};
        this.accommodationPois.forEach(p => { if (p && p.id) this.accommodationPoiMap[p.id] = p; });
        this.poiMap = {};
        this.pois.forEach(p => { if (p && p.id) this.poiMap[p.id] = p; });
        this.poiMap['county'] = { id: 'county', name: '红军广场', lat: 31.911705, lng: 107.245033 };
    }

    async plan() {
        this.weatherForecast = await fetchWeatherForecast();
        const queue = [...this.pois];
        let processCount = 0;
        const MAX_ATTEMPTS = 20;

        while (queue.length > 0 && this.currentDay <= this.maxDays && processCount < MAX_ATTEMPTS) {
            processCount++;
            const poi = queue.shift();
            if (!poi || !poi.id) continue;

            const travel = this.getTravelTime(this.lastPoiId, poi.id);
            if (travel === 0 && this.lastPoiId !== poi.id) {
                this.warnings.push(`⚠️ 从 ${this.getPoiName(this.lastPoiId)} 到 ${poi.name} 交通耗时数据缺失，跳过该景点。`);
                continue;
            }
            if (travel > 180) {
                this.warnings.push(`❌ 从 ${this.getPoiName(this.lastPoiId)} 到 ${poi.name} 交通耗时 ${travel} 分钟，超过 180 分钟限制，请检查数据。`);
                continue;
            }

            let arrivalTime = this.currentTime + travel;
            let startTime = this.currentTime;

            if (arrivalTime >= DAY_END) {
                if (this.dayNodes.length > 0) this.finishDay();
                this.moveToNextDay();
                queue.unshift(poi);
                continue;
            }

            if (arrivalTime < DAY_START) {
                const adjust = DAY_START - arrivalTime;
                if (adjust > 0) {
                    this.addWaiting(adjust);
                    this.addNode({ type: 'waiting', name: '等待景区开放', startTime: this.currentTime, endTime: this.currentTime + adjust, duration: adjust });
                    this.currentTime += adjust;
                    arrivalTime = this.currentTime + travel;
                }
            }

            if (travel > 0) {
                const fromName = this.getPoiName(this.lastPoiId);
                this.addNode({
                    type: 'transport',
                    name: `前往 ${poi.name}`,
                    startTime: this.currentTime,
                    endTime: this.currentTime + travel,
                    duration: travel,
                    from: fromName,
                    to: poi.name
                });
                this.totalTravelMinutes += travel;
                this.currentTime += travel;
            }

            const crossedMeal = this.checkTransportMealCross(this.currentTime, this.currentTime - travel);
            if (crossedMeal) {
                const mealNode = this.createMealNode(crossedMeal, this.currentTime);
                if (mealNode) {
                    this.addNode(mealNode);
                    this.currentTime = mealNode.endTime;
                }
            }

            const nodes = this.selectNodes(poi);
            if (!nodes || nodes.length === 0) {
                const fallbackNode = {
                    node_name: poi.name,
                    node_type: 'poi',
                    suggested_duration_min: poi.visit_duration || 60,
                    isFallback: true
                };
                poi._selectedNodes = [fallbackNode];
                poi._totalDuration = fallbackNode.suggested_duration_min;
            } else {
                poi._selectedNodes = nodes;
                poi._totalDuration = nodes.reduce((sum, n) => sum + (n.suggested_duration_min || 0), 0);
            }

            let remaining = poi._totalDuration;
            let idx = 0;
            while (remaining > 0 && this.currentTime < DAY_END) {
                const meal = this.checkVisitMealTrigger(this.currentTime, remaining);
                if (meal) {
                    const mealNode = this.createMealNode(meal, this.currentTime);
                    if (mealNode) {
                        this.addNode(mealNode);
                        this.currentTime = mealNode.endTime;
                        continue;
                    }
                }
                const node = poi._selectedNodes[idx];
                if (!node) break;
                const nodeDur = node.suggested_duration_min || 0;
                const seg = Math.min(nodeDur, remaining, DAY_END - this.currentTime);
                if (seg <= 0) break;
                this.addNode({
                    type: 'visit',
                    name: node.node_name || poi.name,
                    nodeType: node.node_type || 'poi',
                    startTime: this.currentTime,
                    endTime: this.currentTime + seg,
                    duration: seg,
                    poiId: poi.id,
                    poiName: poi.name
                });
                this.totalVisitMinutes += seg;
                this.currentTime += seg;
                remaining -= seg;
                idx++;
                if (remaining > 0 && idx >= poi._selectedNodes.length) {
                    break;
                }
            }

            const mealAfter = this.checkMealAfterVisit(this.currentTime);
            if (mealAfter) {
                const mealNode = this.createMealNode(mealAfter, this.currentTime);
                if (mealNode) {
                    this.addNode(mealNode);
                    this.currentTime = mealNode.endTime;
                }
            }

            this.lastPoiId = poi.id;

            if (this.currentTime >= DAY_END) {
                this.finishDay();
                this.moveToNextDay();
            }
        }

        if (queue.length > 0) {
            this.warnings.push(`⚠️ 行程超过 ${this.maxDays} 天，剩余 ${queue.length} 个景点未安排`);
        }

        if (this.dayNodes.length > 0) {
            this.finishDay();
        }

        this.addReminders();

        return {
            days: this.allDays,
            warnings: this.warnings,
            totalTravel: this.totalTravelMinutes,
            totalVisit: this.totalVisitMinutes,
            totalWaiting: this.totalWaitingMinutes
        };
    }

    getPoiName(id) {
        if (id === 'county') return '红军广场';
        const p = this.getPoiById(id);
        return p ? p.name : id;
    }

    getPoiById(id) {
        if (id === 'county') return { name: '红军广场', lat: 31.911705, lng: 107.245033 };
        return this.poiMap[id];
    }

    getTravelTime(fromId, toId) {
        if (fromId === toId) return 0;
        const fId = fromId === 'county' ? 0 : fromId;
        const tId = toId === 'county' ? 0 : toId;
        const key = `${fId}_${tId}`;
        let t = this.travelTimes[key];
        if (t === undefined) {
            const reverseKey = `${tId}_${fId}`;
            t = this.travelTimes[reverseKey];
        }
        if (t === undefined) {
            this.warnings.push(`⚠️ 未找到从 ${this.getPoiName(fromId)} 到 ${this.getPoiName(toId)} 的交通耗时，请检查后台。`);
            return 0;
        }
        return t;
    }

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

    checkTransportMealCross(currentTime, startTime) {
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END && startTime < LUNCH_START) return 'lunch';
        if (currentTime >= DINNER_START && currentTime < DINNER_END && startTime < DINNER_START) return 'dinner';
        return null;
    }

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

    checkMealAfterVisit(currentTime) {
        if (currentTime >= LUNCH_START && currentTime < LUNCH_END) return 'lunch';
        if (currentTime >= DINNER_START && currentTime < DINNER_END) return 'dinner';
        return null;
    }

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
        // 如果最后不是住宿节点，且未返回县城，则插入返回县城
        if (last.type !== 'accommodation' && this.lastPoiId !== 'county') {
            const returnTravel = this.getTravelTime(this.lastPoiId, 'county');
            if (returnTravel > 0 && returnTravel <= 180) {
                const returnNode = {
                    type: 'transport',
                    name: '返回县城',
                    startTime: this.currentTime,
                    endTime: this.currentTime + returnTravel,
                    duration: returnTravel,
                    from: this.getPoiName(this.lastPoiId),
                    to: '红军广场'
                };
                this.addNode(returnNode);
                this.totalTravelMinutes += returnTravel;
                this.currentTime += returnTravel;
                this.lastPoiId = 'county';
            } else if (returnTravel > 180) {
                this.warnings.push(`返回县城交通耗时 ${returnTravel} 分钟超过限制，请检查数据。`);
            }
        }
        // 住宿节点：不显示时间，只显示文本
        this.addNode({
            type: 'accommodation',
            name: '今天行程结束，住宿休息',
            startTime: this.currentTime,
            endTime: this.currentTime + 1,
            location: this.lastPoiId === 'county' ? '县城' : '景区'
        });
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
                    day.nodes.push({ type: 'weather', message: getDayWeatherTip(this.weatherForecast[i]) });
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

    findNearestAccommodation(poiId) {
        const poi = this.getPoiById(poiId);
        if (!poi) return null;
        let nearest = null, minDist = Infinity;
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
        return this.getPoiById('county');
    }
}

export async function generateTripPlan(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois) {
    if (!pois || pois.length === 0) {
        return { days: [], warnings: ['没有选择景点'], totalTravel: 0, totalVisit: 0, totalWaiting: 0 };
    }
    const planner = new TripPlanner(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois);
    return await planner.plan();
}
