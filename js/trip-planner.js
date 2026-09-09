// js/trip-planner.js - 智能行程规划引擎（完整修复版）
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
        // 标记当前是否已插入午餐和晚餐（每日重置）
        this.lunchInserted = false;
        this.dinnerInserted = false;
        this.currentDayMeals = {}; // 记录每天已插入的餐食
        this.weatherData = null; // 存储天气详情
    }

    // ========== 主规划方法 ==========
    async plan() {
        // 获取天气数据（含紫外线等）
        this.weatherData = await fetchWeatherForecast();
        // 保留原始天气数据用于天气提醒
        const queue = [...this.pois];
        let processCount = 0;
        const MAX_ATTEMPTS = 20;
        // 重置每日餐食标记
        this.lunchInserted = false;
        this.dinnerInserted = false;

        while (queue.length > 0 && this.currentDay <= this.maxDays && processCount < MAX_ATTEMPTS) {
            processCount++;
            const poi = queue.shift();
            if (!poi || !poi.id) continue;

            // 17:00后不规划新景点
            if (this.currentTime >= 1020) { // 17:00
                this.warnings.push(`⏰ 已超过17:00，${poi.name} 移到明天规划`);
                if (this.dayNodes.length > 0) this.finishDay();
                this.moveToNextDay();
                queue.unshift(poi);
                continue;
            }

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

            // 若到达时间 >= 18:00，则当天无法游览，移到第二天
            if (arrivalTime >= DAY_END) {
                if (this.dayNodes.length > 0) this.finishDay();
                this.moveToNextDay();
                queue.unshift(poi);
                continue;
            }

            // 若到达时间 < 8:00，则添加等待
            if (arrivalTime < DAY_START) {
                const adjust = DAY_START - arrivalTime;
                if (adjust > 0) {
                    this.addWaiting(adjust);
                    this.addNode({ type: 'waiting', name: '等待景区开放', startTime: this.currentTime, endTime: this.currentTime + adjust, duration: adjust });
                    this.currentTime += adjust;
                    arrivalTime = this.currentTime + travel;
                }
            }

            // 插入交通节点
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

            // 交通结束后检查是否触发午餐/晚餐（交通过程中触发）
            const crossedMeal = this.checkTransportMealCross(this.currentTime, this.currentTime - travel);
            if (crossedMeal) {
                const mealNode = this.createMealNode(crossedMeal, this.currentTime);
                if (mealNode) {
                    this.addNode(mealNode);
                    this.currentTime = mealNode.endTime;
                    if (crossedMeal === 'lunch') this.lunchInserted = true;
                    if (crossedMeal === 'dinner') this.dinnerInserted = true;
                }
            }

            // 选择游览节点
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

            // 如果总时长为0，强制使用 visit_duration
            if (poi._totalDuration === 0) {
                const fallbackDur = poi.visit_duration || 60;
                const fallbackNode = {
                    node_name: poi.name,
                    node_type: 'poi',
                    suggested_duration_min: fallbackDur,
                    isFallback: true
                };
                poi._selectedNodes = [fallbackNode];
                poi._totalDuration = fallbackDur;
            }

            let remaining = poi._totalDuration;
            let idx = 0;
            let visitStartTime = this.currentTime; // 记录游览开始时间
            let firstVisitNode = true; // 是否是该景区的第一个游览节点

            while (remaining > 0 && this.currentTime < DAY_END) {
                // 检查餐食触发（游览过程中触发）
                const meal = this.checkVisitMealTrigger(this.currentTime, remaining, firstVisitNode);
                if (meal) {
                    const mealNode = this.createMealNode(meal, this.currentTime);
                    if (mealNode) {
                        this.addNode(mealNode);
                        this.currentTime = mealNode.endTime;
                        if (meal === 'lunch') this.lunchInserted = true;
                        if (meal === 'dinner') this.dinnerInserted = true;
                        continue;
                    }
                }

                const node = poi._selectedNodes[idx];
                if (!node) break;
                const nodeDur = node.suggested_duration_min || 0;
                const seg = Math.min(nodeDur, remaining, DAY_END - this.currentTime);
                if (seg <= 0) break;

                // 构建游览节点描述
                let nodeName = node.node_name || poi.name;
                // 如果是第一个节点，显示完整描述
                const visitDesc = firstVisitNode ? `${nodeName}（${seg}分钟）` : `${nodeName}（剩余${seg}分钟）`;
                this.addNode({
                    type: 'visit',
                    name: visitDesc,
                    nodeType: node.node_type || 'poi',
                    startTime: this.currentTime,
                    endTime: this.currentTime + seg,
                    duration: seg,
                    poiId: poi.id,
                    poiName: poi.name,
                    totalDuration: poi._totalDuration,
                    remainingAfter: remaining - seg
                });
                this.totalVisitMinutes += seg;
                this.currentTime += seg;
                remaining -= seg;
                idx++;
                firstVisitNode = false;
                if (remaining > 0 && idx >= poi._selectedNodes.length) {
                    break;
                }
            }

            // 游览结束后检查餐食
            const mealAfter = this.checkMealAfterVisit(this.currentTime);
            if (mealAfter) {
                const mealNode = this.createMealNode(mealAfter, this.currentTime);
                if (mealNode) {
                    this.addNode(mealNode);
                    this.currentTime = mealNode.endTime;
                    if (mealAfter === 'lunch') this.lunchInserted = true;
                    if (mealAfter === 'dinner') this.dinnerInserted = true;
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
            totalWaiting: this.totalWaitingMinutes,
            weather: this.weatherData
        };
    }

    // ========== 辅助方法 ==========

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

    // ========== 餐食触发检查 ==========

    checkTransportMealCross(currentTime, startTime) {
        // 交通耗时中触发，不限定时间
        if (!this.lunchInserted && startTime < LUNCH_START && currentTime >= LUNCH_START) return 'lunch';
        if (!this.dinnerInserted && startTime < DINNER_START && currentTime >= DINNER_START) return 'dinner';
        return null;
    }

    checkVisitMealTrigger(currentTime, remainingDuration, isFirstNode) {
        // 出发时间超过12:30，不安排午餐
        if (!this.lunchInserted && this.startTime >= 750) {
            // 跳过午餐
        } else if (!this.lunchInserted) {
            // 浏览时间开始未到60分钟且触发午餐时间，在景区浏览时间超过60分钟后插入午餐
            if (isFirstNode && currentTime < LUNCH_START && currentTime + remainingDuration > LUNCH_START) {
                // 检查是否有足够时间先游览再午餐（至少30分钟）
                const minVisit = Math.min(remainingDuration, 60);
                if (minVisit > 30) {
                    // 先游览30分钟再午餐
                    return null;
                }
                return 'lunch';
            }
            // 当前时间在午餐窗口内
            if (currentTime >= LUNCH_START && currentTime < LUNCH_END) {
                return 'lunch';
            }
        }

        if (!this.dinnerInserted) {
            if (currentTime >= DINNER_START && currentTime < DINNER_END) {
                return 'dinner';
            }
        }
        return null;
    }

    checkMealAfterVisit(currentTime) {
        if (!this.lunchInserted && currentTime >= LUNCH_START && currentTime < LUNCH_END) return 'lunch';
        if (!this.dinnerInserted && currentTime >= DINNER_START && currentTime < DINNER_END) return 'dinner';
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
            location: this.lastPoiId === 'county' ? '' : '（县城）'
        });
        this.allDays.push({
            day: this.currentDay,
            date: this.currentDate.toISOString().slice(0, 10),
            nodes: this.dayNodes
        });
        this.dayNodes = [];
        this.isAccommodationAtScenic = false;
        this.currentDay++;
        // 重置每日餐食标记
        this.lunchInserted = false;
        this.dinnerInserted = false;
    }

    moveToNextDay() {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentTime = DAY_START;
        this.lastPoiId = 'county';
        this.lunchInserted = false;
        this.dinnerInserted = false;
    }

    // ========== 天气提醒（包含紫外线、气压等） ==========
    addReminders() {
        // 添加天气提醒（包含紫外线、气压、湿度等）
        if (this.weatherData && this.weatherData.length > 0) {
            for (let i = 0; i < this.allDays.length; i++) {
                const day = this.allDays[i];
                const dayIndex = i;
                if (this.weatherData[dayIndex]) {
                    const w = this.weatherData[dayIndex];
                    const tips = this.generateWeatherTips(w);
                    // 将天气信息作为特殊节点插入当天末尾
                    day.nodes.push({ type: 'weather', message: tips });
                }
            }
        }

        // 交通和游览提醒
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

    generateWeatherTips(weatherData) {
        const { weather, tempMax, tempMin, wind, uvIndex, humidity, pressure } = weatherData;
        let tips = `🌤️ 天气：${weather}，气温 ${tempMin}℃ ～ ${tempMax}℃`;

        if (wind && wind !== '--') {
            tips += `，风力 ${wind} km/h`;
        }
        if (uvIndex && uvIndex > 0) {
            if (uvIndex >= 8) tips += '，☀️ 紫外线极强，请做好防晒措施';
            else if (uvIndex >= 6) tips += '，☀️ 紫外线强，建议涂抹防晒霜';
            else if (uvIndex >= 3) tips += '，🌤️ 紫外线中等，可适当防晒';
        }
        if (humidity && humidity > 80) {
            tips += '，💧 湿度较高，注意通风';
        }
        if (pressure && pressure < 1000) {
            tips += '，📉 气压较低，注意血氧';
        } else if (pressure && pressure > 1020) {
            tips += '，📈 气压较高，注意身体调节';
        }
        if (weather.includes('雨') || weather.includes('雷') || weather.includes('雾')) {
            tips += '，☔ 有降雨或大雾，请携带雨具，注意出行安全';
        } else if (tempMax && tempMax > 33) {
            tips += '，🌡️ 气温较高，注意防暑防晒，多补充水分';
        } else if (tempMin && tempMin < 10) {
            tips += '，🧥 气温较低，注意保暖';
        } else {
            tips += '，🌿 天气适宜出行，祝您旅途愉快！';
        }
        return tips;
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

// ============================================================
// 工厂函数
// ============================================================
export async function generateTripPlan(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois) {
    if (!pois || pois.length === 0) {
        return { days: [], warnings: ['没有选择景点'], totalTravel: 0, totalVisit: 0, totalWaiting: 0 };
    }
    const planner = new TripPlanner(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois);
    return await planner.plan();
}
