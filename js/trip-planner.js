// js/trip-planner.js - 智能行程规划引擎（最终修复版）
import { formatTime, timeToMinutes, getDistance, fetchWeatherForecast } from './utils.js';
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
        this.weatherData = null;
        this.totalTravelMinutes = 0;
        this.totalVisitMinutes = 0;
        this.totalWaitingMinutes = 0;
        this.maxDays = 5;
        this.accommodationPoiMap = {};
        this.accommodationPois.forEach(p => { if (p && p.id) this.accommodationPoiMap[p.id] = p; });
        this.poiMap = {};
        this.pois.forEach(p => { if (p && p.id) this.poiMap[p.id] = p; });
        this.poiMap['county'] = { id: 'county', name: '红军广场', lat: 31.911705, lng: 107.245033 };
        this.lunchInserted = false;
        this.dinnerInserted = false;
        this.MIN_SEGMENT = 30;
    }

    async plan() {
        this.weatherData = await fetchWeatherForecast();
        const queue = this.pois.map(p => ({ poi: p, remaining: null }));

        while (queue.length > 0 && this.currentDay <= this.maxDays) {
            let overnightAtScenic = false;
            let dayHasContent = false;
            let processedCount = 0;
            const MAX_PER_DAY = 15;

            // ============ 当天内层循环：可连续游览多个景点 ============
            while (queue.length > 0 && this.currentTime < DAY_END && processedCount < MAX_PER_DAY) {
                processedCount++;
                const item = queue.shift();
                const poi = item.poi;
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

                // 17:00 后不规划新景点
                if (arrivalTime >= 1020) {
                    this.warnings.push(`⏰ 到达 ${poi.name} 时间 ${formatTime(arrivalTime)} 已超过17:00，该景点移到明天规划。`);
                    queue.unshift(item);
                    break;
                }

                // 到达时间 >= 18:00，移到下一天
                if (arrivalTime >= DAY_END) {
                    queue.unshift(item);
                    break;
                }

                // 等待景区开放
                if (arrivalTime < DAY_START) {
                    const adjust = DAY_START - arrivalTime;
                    if (adjust > 0) {
                        this.addWaiting(adjust);
                        this.addNode({
                            type: 'waiting',
                            name: '等待景区开放',
                            startTime: this.currentTime,
                            endTime: this.currentTime + adjust,
                            duration: adjust
                        });
                        this.currentTime += adjust;
                    }
                }

                // 插入交通节点
                if (travel > 0) {
                    const fromName = this.getPoiName(this.lastPoiId);
                    const travelStart = this.currentTime;
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
                    this.lastPoiId = poi.id;   // ★ 关键修复
                    this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
                }

                dayHasContent = true;

                // 计算总游览时长
                let totalDuration;
                if (item.remaining !== null && item.remaining !== undefined) {
                    totalDuration = item.remaining;
                } else {
                    totalDuration = this.calculateTotalDuration(poi);
                }

                // ============ 游览循环 ============
                let remaining = totalDuration;

                while (remaining > 0 && this.currentTime < DAY_END) {
                    let meal = null;
                    if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
                        meal = 'lunch';
                    } else if (!this.dinnerInserted && this.currentTime >= DINNER_START && this.currentTime < DINNER_END) {
                        meal = 'dinner';
                    }

                    if (meal) {
                        if (remaining < this.MIN_SEGMENT) {
                            this.addVisitNode(poi, this.currentTime, remaining, totalDuration, 0);
                            this.currentTime += remaining;
                            remaining = 0;
                            break;
                        } else {
                            const mealNode = this.createMealNode(meal, this.currentTime);
                            if (mealNode) {
                                this.addNode(mealNode);
                                this.currentTime = mealNode.endTime;
                                if (meal === 'lunch') this.lunchInserted = true;
                                if (meal === 'dinner') this.dinnerInserted = true;
                            }
                            continue;
                        }
                    }

                    let nextMealStart = Infinity;
                    if (!this.lunchInserted && this.currentTime < LUNCH_START) {
                        nextMealStart = LUNCH_START;
                    }
                    if (!this.dinnerInserted && this.currentTime < DINNER_START && DINNER_START < nextMealStart) {
                        nextMealStart = DINNER_START;
                    }

                    let maxContinuous = remaining;
                    if (nextMealStart !== Infinity && nextMealStart > this.currentTime) {
                        const gap = nextMealStart - this.currentTime;
                        if (gap < maxContinuous) maxContinuous = gap;
                    }
                    if (this.currentTime + maxContinuous > DAY_END) {
                        maxContinuous = DAY_END - this.currentTime;
                    }
                    if (maxContinuous <= 0) break;

                    if (remaining < this.MIN_SEGMENT) {
                        maxContinuous = remaining;
                    }

                    this.addVisitNode(poi, this.currentTime, maxContinuous, totalDuration, remaining - maxContinuous);
                    this.currentTime += maxContinuous;
                    remaining -= maxContinuous;
                }

                // ============ 处理剩余时间 ============
                if (remaining > 0) {
                    if (remaining >= 60) {
                        // 跨天顺延：在景区附近住宿
                        this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间，将顺延至明天。`);
                        this.addNode({
                            type: 'accommodation',
                            name: `今天行程结束，建议在 ${poi.name} 附近住宿`,
                            startTime: this.currentTime,
                            endTime: this.currentTime + 1,
                            location: ''
                        });
                        this.lastPoiId = poi.id;  // 保留为景点
                        queue.unshift({ poi, remaining });
                        overnightAtScenic = true;
                        break;
                    } else {
                        this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间（<60），自动丢弃。`);
                        remaining = 0;
                    }
                }

                // 游览完成
                if (remaining === 0) {
                    this.lastPoiId = poi.id;  // ★ 确保更新
                    this.checkAndInsertMealAfterVisit();
                }
            }

            // ============ 当天收尾 ============
            if (!dayHasContent && this.dayNodes.length === 0) {
                if (queue.length > 0) {
                    this.advanceToNextDay(false);
                    continue;
                } else {
                    break;
                }
            }

            if (overnightAtScenic) {
                this.closeDay();
                this.advanceToNextDay(true);  // 保留 lastPoiId
                continue;
            }

            // 返回县城
            if (this.lastPoiId !== 'county') {
                const returnTravel = this.getTravelTime(this.lastPoiId, 'county');
                if (returnTravel > 0 && returnTravel <= 180) {
                    const travelStart = this.currentTime;
                    this.addNode({
                        type: 'transport',
                        name: '返回县城',
                        startTime: this.currentTime,
                        endTime: this.currentTime + returnTravel,
                        duration: returnTravel,
                        from: this.getPoiName(this.lastPoiId),
                        to: '红军广场'
                    });
                    this.totalTravelMinutes += returnTravel;
                    this.currentTime += returnTravel;
                    this.lastPoiId = 'county';
                    this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
                } else if (returnTravel > 180) {
                    this.warnings.push(`返回县城交通耗时 ${returnTravel} 分钟超过限制，请检查数据。`);
                }
            }

            // 返回后检查餐食
            this.checkAndInsertMealAfterVisit();

            // 住宿节点
            const isLate = this.currentTime > 1080;
            this.addNode({
                type: 'accommodation',
                name: isLate ? '今天行程结束，住宿休息' : '今天行程结束',
                startTime: this.currentTime,
                endTime: this.currentTime + 1,
                location: ''
            });

            this.closeDay();
            this.advanceToNextDay(false);
        }

        if (queue.length > 0) {
            this.warnings.push(`⚠️ 行程超过 ${this.maxDays} 天，剩余 ${queue.length} 个景点未安排`);
        }

        if (this.dayNodes.length > 0) {
            this.closeDay();
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

    // ============ 辅助方法 ============

    calculateTotalDuration(poi) {
        const nodes = this.selectNodes(poi);
        if (!nodes || nodes.length === 0) {
            return poi.visit_duration || 60;
        }
        const total = nodes.reduce((sum, n) => sum + (n.suggested_duration_min || 0), 0);
        return total > 0 ? total : (poi.visit_duration || 60);
    }

    addVisitNode(poi, startTime, duration, totalDuration, remainingAfter = 0) {
        const visitNode = {
            type: 'visit',
            name: `浏览 ${poi.name}`,
            nodeType: 'poi',
            startTime: startTime,
            endTime: startTime + duration,
            duration: duration,
            poiId: poi.id,
            poiName: poi.name,
            totalDuration: totalDuration,
            remainingAfter: remainingAfter
        };
        this.addNode(visitNode);
        this.totalVisitMinutes += duration;
    }

    checkAndInsertMealAfterTransport(travelStart, travelEnd) {
        let meal = null;
        if (!this.lunchInserted) {
            if ((travelEnd >= LUNCH_START && travelEnd < LUNCH_END) ||
                (travelStart < LUNCH_START && travelEnd >= LUNCH_START)) {
                meal = 'lunch';
            }
        }
        if (!this.dinnerInserted && !meal) {
            if ((travelEnd >= DINNER_START && travelEnd < DINNER_END) ||
                (travelStart < DINNER_START && travelEnd >= DINNER_START)) {
                meal = 'dinner';
            }
        }
        if (!this.lunchInserted && !meal && travelEnd >= LUNCH_START && travelEnd < LUNCH_END) {
            meal = 'lunch';
        }
        if (!this.dinnerInserted && !meal && travelEnd >= DINNER_START && travelEnd < DINNER_END) {
            meal = 'dinner';
        }
        if (meal) {
            const mealNode = this.createMealNode(meal, travelEnd);
            if (mealNode) {
                this.addNode(mealNode);
                this.currentTime = mealNode.endTime;
                if (meal === 'lunch') this.lunchInserted = true;
                if (meal === 'dinner') this.dinnerInserted = true;
            }
        }
    }

    checkAndInsertMealAfterVisit() {
        let meal = null;
        if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
            meal = 'lunch';
        } else if (!this.dinnerInserted && this.currentTime >= DINNER_START && this.currentTime < DINNER_END) {
            meal = 'dinner';
        }
        if (meal) {
            const mealNode = this.createMealNode(meal, this.currentTime);
            if (mealNode) {
                this.addNode(mealNode);
                this.currentTime = mealNode.endTime;
                if (meal === 'lunch') this.lunchInserted = true;
                if (meal === 'dinner') this.dinnerInserted = true;
            }
        }
    }

    addNode(node) {
        if (!node) return;
        if (node.type === 'visit') {
            const last = this.dayNodes[this.dayNodes.length - 1];
            if (last && last.type === 'visit' && last.poiId === node.poiId) {
                last.endTime = node.endTime;
                last.duration += node.duration;
                last.remainingAfter = node.remainingAfter;
                return;
            }
        }
        this.dayNodes.push(node);
    }

    closeDay() {
        if (this.dayNodes.length === 0) return;
        this.allDays.push({
            day: this.currentDay,
            date: this.currentDate.toISOString().slice(0, 10),
            nodes: this.dayNodes
        });
        this.dayNodes = [];
        this.lunchInserted = false;
        this.dinnerInserted = false;
    }

    advanceToNextDay(keepLastPoi = false) {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentTime = DAY_START;
        if (!keepLastPoi) {
            this.lastPoiId = 'county';
        }
        this.lunchInserted = false;
        this.dinnerInserted = false;
        this.currentDay++;
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

    addWaiting(minutes) {
        this.totalWaitingMinutes += minutes;
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
        return null;
    }

    addReminders() {
        if (this.weatherData && this.weatherData.length > 0) {
            for (let i = 0; i < this.allDays.length; i++) {
                const day = this.allDays[i];
                const dayIndex = i;
                if (this.weatherData[dayIndex]) {
                    const w = this.weatherData[dayIndex];
                    const tips = this.generateWeatherTips(w);
                    day.nodes.push({ type: 'weather', message: tips });
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

    generateWeatherTips(weatherData) {
        const { weather, tempMax, tempMin, wind, uvIndex } = weatherData;
        let tips = `🌤️ 天气：${weather}，气温 ${tempMin}℃ ～ ${tempMax}℃`;
        if (wind && wind !== '--') tips += `，风力 ${wind} km/h`;
        if (uvIndex && uvIndex > 0) {
            if (uvIndex >= 8) tips += '，☀️ 紫外线极强，请做好防晒措施';
            else if (uvIndex >= 6) tips += '，☀️ 紫外线强，建议涂抹防晒霜';
            else if (uvIndex >= 3) tips += '，🌤️ 紫外线中等，可适当防晒';
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
}

export async function generateTripPlan(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois) {
    if (!pois || pois.length === 0) {
        return { days: [], warnings: ['没有选择景点'], totalTravel: 0, totalVisit: 0, totalWaiting: 0 };
    }
    const planner = new TripPlanner(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois);
    return await planner.plan();
}
