// js/trip-planner.js - 行程规划引擎（ensureTwoMeals 越界保护 + L3 tour_route 消费 + lodgingMode 生效）
import { formatTime, timeToMinutes, fetchWeatherForecast } from './utils.js';
import {
    DAY_START, VISIT_END, NIGHT_END,
    LUNCH_START, LUNCH_END, DINNER_START, DINNER_END,
    MEAL_DURATION, MAX_RETURN_TIME, MIN_SEGMENT, MIN_REST_DURATION,
    LUNCH_THRESHOLD, DINNER_THRESHOLD
} from './config.js';

export class TripPlanner {
    constructor(selectedPois, startDate, startTime, mode, travelTimes, allPoisMap, accommodationPois, lodgingMode = 'all', startLocation = 'county') {
        this.pois = selectedPois || [];
        this.allPoisMap = allPoisMap || {};
        this.startDate = startDate || new Date().toISOString().slice(0, 10);
        this.startTime = startTime || '08:00';
        this.mode = mode || 'relaxed';
        this.travelTimes = travelTimes || {};
        this.accommodationPois = accommodationPois || [];
        this.lodgingMode = lodgingMode;
        this.startLocation = startLocation;

        this.currentDate = new Date(this.startDate);
        this.currentTime = timeToMinutes(this.startTime);
        this.currentDay = 1;
        this.lastPoiId = this.startLocation;
        this.dayNodes = [];
        this.allDays = [];
        this.warnings = [];
        this.weatherData = null;
        this.totalTravelMinutes = 0;
        this.totalVisitMinutes = 0;
        this.totalWaitingMinutes = 0;
        this.maxDays = 8;

        this.poiMap = {};
        this.pois.forEach(p => { if (p && p.id) this.poiMap[p.id] = p; });

        this.lunchInserted = false;
        this.dinnerInserted = false;
    }

    async plan() {
        this.weatherData = await fetchWeatherForecast();
        const queue = this.pois.map(p => ({ poi: p, remaining: null }));

        while (queue.length > 0 && this.currentDay <= this.maxDays) {
            let overnight = false;
            let dayHasContent = false;
            let processedCount = 0;
            const MAX_PER_DAY = 15;

            while (queue.length > 0 && this.currentTime < VISIT_END && processedCount < MAX_PER_DAY) {
                processedCount++;
                const item = queue.shift();
                const poi = item.poi;
                if (!poi || !poi.id) continue;

                const travel = this.calcTravel(this.lastPoiId, poi.id);
                if (travel > 0 && travel <= MAX_RETURN_TIME) {
                    const travelStart = this.currentTime;
                    this.addNode({
                        type: 'transport',
                        name: `前往 ${poi.name}`,
                        startTime: this.currentTime,
                        endTime: this.currentTime + travel,
                        duration: travel,
                        from: this.getPoiName(this.lastPoiId),
                        to: poi.name
                    });
                    this.totalTravelMinutes += travel;
                    this.currentTime += travel;
                    this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
                } else if (travel > MAX_RETURN_TIME) {
                    this.warnings.push(`❌ 从 ${this.getPoiName(this.lastPoiId)} 到 ${poi.name} 交通耗时 ${travel} 分钟超限，跳过。`);
                    continue;
                } else {
                    if (String(this.lastPoiId) !== String(poi.id)
                        && String(this.lastPoiId) !== 'county'
                        && String(poi.id) !== 'county') {
                        if (!this.hasTravelData(this.lastPoiId, poi.id)) {
                            this.addNode({
                                type: 'reminder',
                                message: `前往"${poi.name}"暂无交通耗时数据，请提醒管理员在后台配置`
                            });
                            this.warnings.push(`⚠️ 未配置 ${this.getPoiName(this.lastPoiId)} → ${poi.name} 的交通耗时`);
                        }
                    }
                }

                const level = poi.data_level || 'L2';
                let result;
                if (level === 'L3') {
                    result = this.handleL3(poi, item);
                } else {
                    result = this.handleL2(poi, item);
                }

                if (result.overnight) {
                    if (result.remaining !== undefined && result.remaining !== null) {
                        queue.unshift({ poi, remaining: result.remaining });
                    } else {
                        queue.unshift({ poi, remaining: null });
                    }
                    overnight = true;
                    break;
                }

                dayHasContent = true;
                this.lastPoiId = poi.id;
            }

            if (!dayHasContent && this.dayNodes.length === 0) {
                if (queue.length > 0) {
                    this.advanceToNextDay(false);
                    continue;
                } else {
                    break;
                }
            }

            // overnight 分支
            if (overnight) {
                const nextItem = queue[0];
                const nextL3Poi = nextItem ? nextItem.poi : null;
                const prevPoi = this.lastPoiId === 'county' ? null : this.allPoisMap[String(this.lastPoiId)];

                let sameScenic = false;
                if (prevPoi && nextL3Poi
                    && prevPoi.scenic_id !== null && prevPoi.scenic_id !== undefined
                    && nextL3Poi.scenic_id !== null && nextL3Poi.scenic_id !== undefined
                    && String(prevPoi.scenic_id) === String(nextL3Poi.scenic_id)) {
                    sameScenic = true;
                }

                if (sameScenic) {
                    this.ensureTwoMeals();
                    this.addNode({
                        type: 'accommodation',
                        name: `今天行程结束，建议在${nextL3Poi.name}附近住宿`,
                        startTime: this.currentTime,
                        endTime: this.currentTime + 1
                    });
                    this.closeDay();
                    this.advanceToNextDay(true);
                } else {
                    if (this.lastPoiId !== 'county' && this.lastPoiId) {
                        const returnTravel = this.calcTravel(this.lastPoiId, 'county');
                        if (returnTravel > 10 && returnTravel <= MAX_RETURN_TIME) {
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
                            this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
                        }
                        this.lastPoiId = 'county';
                    }
                    this.ensureTwoMeals();
                    this.addNode({
                        type: 'accommodation',
                        name: '今天行程结束，住宿休息',
                        startTime: this.currentTime,
                        endTime: this.currentTime + 1
                    });
                    this.closeDay();
                    this.advanceToNextDay(false);
                }
                continue;
            }

            const allDone = queue.length === 0;

            if (allDone) {
                if (this.lastPoiId !== 'county' && this.lastPoiId) {
                    const returnTravel = this.calcTravel(this.lastPoiId, 'county');
                    if (returnTravel > 0 && returnTravel <= MAX_RETURN_TIME && returnTravel > 10) {
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
                        this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
                    }
                    this.lastPoiId = 'county';
                }
                this.ensureTwoMeals();

                this.addNode({
                    type: 'trip_end',
                    name: '整个行程规划结束',
                    startTime: this.currentTime,
                    endTime: this.currentTime + 1
                });
                this.closeDay();
                break;
            }

            // ★ lodgingMode = 'county' 时每天必须返回县城
            if (this.lodgingMode === 'county') {
                this.handleReturnToCounty();
            } else {
                this.handleReturnToCounty();
            }
            this.ensureTwoMeals();

            this.addNode({
                type: 'accommodation',
                name: '今天行程结束，住宿休息',
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
        if (this.dayNodes.length > 0) this.closeDay();

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

    handleL2(poi, item) {
        const remaining0 = (item.remaining !== null && item.remaining !== undefined)
            ? item.remaining
            : (poi.visit_duration || 60);
        const totalDuration = remaining0;
        let remaining = remaining0;

        while (remaining > 0 && this.currentTime < VISIT_END) {
            let meal = null;
            if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
                meal = 'lunch';
            } else if (!this.dinnerInserted && this.currentTime >= DINNER_START && this.currentTime < DINNER_END) {
                meal = 'dinner';
            }

            if (meal) {
                if (remaining < MIN_SEGMENT) {
                    this.addVisitNode(poi, this.currentTime, remaining, totalDuration, 0);
                    this.currentTime += remaining;
                    remaining = 0;
                    this.checkAndInsertMealAfterVisit();
                    break;
                } else {
                    this.insertMeal(meal);
                    continue;
                }
            }

            let nextWindowStart = Infinity;
            if (!this.lunchInserted && this.currentTime < LUNCH_START) {
                nextWindowStart = Math.min(nextWindowStart, LUNCH_START);
            }
            if (!this.dinnerInserted && this.currentTime < DINNER_START) {
                nextWindowStart = Math.min(nextWindowStart, DINNER_START);
            }

            let segment = remaining;
            if (nextWindowStart !== Infinity && nextWindowStart > this.currentTime) {
                const gap = nextWindowStart - this.currentTime;
                if (gap < segment) segment = gap;
            }
            if (this.currentTime + segment > VISIT_END) {
                segment = VISIT_END - this.currentTime;
            }
            if (segment <= 0) break;

            this.addVisitNode(poi, this.currentTime, segment, totalDuration, remaining - segment);
            this.currentTime += segment;
            remaining -= segment;
        }

        if (remaining > 0) {
            if (remaining >= 60) {
                this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟，移至次日`);
                return { overnight: true, remaining };
            } else {
                this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟（<60），自动丢弃`);
            }
        }

        this.checkAndInsertMealAfterVisit();
        return { overnight: false };
    }

    // ★ L3 消费 tour_route，按节点顺序展示内部核心节点
    handleL3(poi, item) {
        const totalDuration = poi.visit_duration || 0;
        if (totalDuration <= 0) return { overnight: false };

        const dayLimit = poi.hours_type === '24h' ? NIGHT_END : VISIT_END;
        const endTime = this.currentTime + totalDuration;

        if (endTime > dayLimit) {
            this.warnings.push(`⚠️ 连续景点"${poi.name}"需 ${totalDuration} 分钟，今日剩余不足，移至次日`);
            this.addNode({
                type: 'reminder',
                message: `连续景点"${poi.name}"需 ${totalDuration} 分钟，今日剩余时间不足，已移至次日`
            });
            return { overnight: true };
        }

        // ★ 按 tour_route 顺序拆分
        const tr = Array.isArray(poi.tour_route) ? poi.tour_route : [];
        const innerNodes = tr
            .map(id => this.allPoisMap[String(id)])
            .filter(Boolean);

        if (innerNodes.length > 0) {
            const sumDur = innerNodes.reduce((s, n) => s + (n.visit_duration || 0), 0);
            const fallbackPer = Math.max(1, Math.floor(totalDuration / innerNodes.length));
            let t = this.currentTime;
            let used = 0;
            for (let i = 0; i < innerNodes.length; i++) {
                const n = innerNodes[i];
                let dur = sumDur > 0 ? (n.visit_duration || 0) : fallbackPer;
                // 最后一项补齐差值
                if (i === innerNodes.length - 1) dur = Math.max(1, totalDuration - used);
                if (dur <= 0) dur = fallbackPer;
                this.addNode({
                    type: 'visit',
                    name: `浏览 ⭐ ${n.name}`,
                    nodeType: 'core_route',
                    startTime: t, endTime: t + dur, duration: dur,
                    poiId: n.id, poiName: n.name,
                    totalDuration: dur, remainingAfter: 0
                });
                this.totalVisitMinutes += dur;
                t += dur;
                used += dur;
            }
            this.currentTime = endTime;
            this.handleMealAfterL3(endTime);
            return { overnight: false };
        }

        // 无 tour_route 时走原逻辑
        this.addVisitNode(poi, this.currentTime, totalDuration, totalDuration, 0);
        this.currentTime = endTime;
        this.handleMealAfterL3(endTime);
        return { overnight: false };
    }

    handleMealAfterL3(endTime) {
        if (!this.dinnerInserted && endTime > DINNER_START) {
            if (endTime <= DINNER_THRESHOLD) {
                this.insertMeal('dinner');
            } else {
                this.addNode({
                    type: 'reminder',
                    message: '已错过晚餐（18:00-19:00），请自行安排就餐'
                });
                this.dinnerInserted = true;
                this.lunchInserted = true;
            }
            return;
        }
        if (!this.lunchInserted && endTime > LUNCH_START) {
            if (endTime <= LUNCH_THRESHOLD) {
                this.insertMeal('lunch');
            } else {
                this.addNode({
                    type: 'reminder',
                    message: '已错过午餐（11:30-12:30），请自行安排就餐'
                });
                this.lunchInserted = true;
            }
        }
    }

    calcTravel(fromId, toId) {
        if (!fromId || !toId) return 0;
        if (String(fromId) === String(toId)) return 0;

        const fromKey = fromId === 'county' ? 0 : fromId;
        const toKey = toId === 'county' ? 0 : toId;

        const key = `${fromKey}_${toKey}`;
        let t = this.travelTimes[key];
        if (t === undefined) t = this.travelTimes[`${toKey}_${fromKey}`];
        return t || 0;
    }

    hasTravelData(fromId, toId) {
        if (!fromId || !toId) return true;
        const fromKey = fromId === 'county' ? 0 : fromId;
        const toKey = toId === 'county' ? 0 : toId;
        const key = `${fromKey}_${toKey}`;
        if (this.travelTimes[key] !== undefined) return true;
        const reverseKey = `${toKey}_${fromKey}`;
        if (this.travelTimes[reverseKey] !== undefined) return true;
        return false;
    }

    checkAndInsertMealAfterTransport(travelStart, travelEnd) {
        let meal = null;
        if (!this.lunchInserted && travelStart < LUNCH_END && travelEnd >= LUNCH_START) {
            meal = 'lunch';
        }
        if (!this.dinnerInserted && !meal && travelStart < DINNER_END && travelEnd >= DINNER_START) {
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
        if (meal) this.insertMeal(meal);
    }

    insertMeal(type) {
        const mealNode = this.createMealNode(type, this.currentTime);
        if (mealNode) {
            this.addNode(mealNode);
            this.currentTime = mealNode.endTime;
            if (type === 'lunch') this.lunchInserted = true;
            if (type === 'dinner') this.dinnerInserted = true;
        }
    }

    createMealNode(type, startTime) {
        let start = startTime;
        const duration = MEAL_DURATION;
        if (type === 'lunch') {
            if (start < LUNCH_START) start = LUNCH_START;
            return { type: 'meal', name: '午餐时间', startTime: start, endTime: start + duration, duration };
        } else if (type === 'dinner') {
            if (start < DINNER_START) start = DINNER_START;
            return { type: 'meal', name: '晚餐时间', startTime: start, endTime: start + duration, duration };
        }
        return null;
    }

    addRestNode(startTime, endTime) {
        const duration = endTime - startTime;
        if (duration < MIN_REST_DURATION) return;
        this.addNode({ type: 'rest', name: '休息调整', startTime, endTime, duration });
        this.totalWaitingMinutes += duration;
    }

    addNode(node) {
        if (!node) return;
        if (node.type === 'visit') {
            const last = this.dayNodes[this.dayNodes.length - 1];
            if (last && last.type === 'visit' && last.poiId === node.poiId && last.nodeType === node.nodeType) {
                last.endTime = node.endTime;
                last.duration += node.duration;
                last.remainingAfter = node.remainingAfter;
                return;
            }
        }
        this.dayNodes.push(node);
    }

    addVisitNode(poi, startTime, duration, totalDuration, remainingAfter = 0) {
        const visitNode = {
            type: 'visit',
            name: poi.data_level === 'L3'
                ? `浏览 ⭐ ${poi.name}`
                : `浏览 ${poi.name}`,
            nodeType: poi.data_level === 'L3' ? 'core_route' : 'poi',
            startTime,
            endTime: startTime + duration,
            duration,
            poiId: poi.id,
            poiName: poi.name,
            totalDuration,
            remainingAfter
        };
        this.addNode(visitNode);
        this.totalVisitMinutes += duration;
    }

    handleReturnToCounty() {
        if (this.lastPoiId === 'county' || !this.lastPoiId) return;
        const returnTravel = this.calcTravel(this.lastPoiId, 'county');
        if (returnTravel <= 0 || returnTravel > MAX_RETURN_TIME) {
            this.lastPoiId = 'county';
            return;
        }
        if (returnTravel <= 10) {
            this.lastPoiId = 'county';
            this.checkAndInsertMealAfterVisit();
            return;
        }
        const travelStart = this.currentTime;
        this.addNode({
            type: 'transport', name: '返回县城',
            startTime: this.currentTime, endTime: this.currentTime + returnTravel,
            duration: returnTravel,
            from: this.getPoiName(this.lastPoiId), to: '红军广场'
        });
        this.totalTravelMinutes += returnTravel;
        this.currentTime += returnTravel;
        this.lastPoiId = 'county';
        this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
    }

    // ★ 修复：晚餐越界保护
    ensureTwoMeals() {
        if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
            this.insertMeal('lunch');
        }
        if (!this.dinnerInserted) {
            if (this.currentTime < DINNER_START) {
                this.addRestNode(this.currentTime, DINNER_START);
                this.currentTime = DINNER_START;
                this.insertMeal('dinner');
            } else if (this.currentTime < DINNER_END) {
                this.insertMeal('dinner');
            } else {
                // ★ 已过晚餐窗口：不强行补晚餐，仅提醒
                this.addNode({
                    type: 'reminder',
                    message: '今日行程结束较晚，已错过晚餐时段（18:00-19:00），请自行安排就餐'
                });
                this.dinnerInserted = true;
            }
        }
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
        if (!keepLastPoi) this.lastPoiId = 'county';
        this.lunchInserted = false;
        this.dinnerInserted = false;
        this.currentDay++;
    }

    getPoiName(id) {
        if (id === 'county') return '红军广场';
        const p = this.allPoisMap[String(id)];
        return p ? p.name : id;
    }

    addReminders() {
        if (this.weatherData && this.weatherData.length > 0) {
            for (let i = 0; i < this.allDays.length; i++) {
                const day = this.allDays[i];
                if (this.weatherData[i]) {
                    const w = this.weatherData[i];
                    const tips = this.generateWeatherTips(w);
                    day.nodes.push({ type: 'weather', message: tips });
                }
            }
        }
        for (const day of this.allDays) {
            let dailyTravel = 0, dailyVisit = 0, singleLongTravel = false;
            for (const node of day.nodes) {
                if (node.type === 'transport') {
                    dailyTravel += node.duration || 0;
                    if ((node.duration || 0) > 120) singleLongTravel = true;
                }
                if (node.type === 'visit') dailyVisit += node.duration || 0;
            }
            const isTrafficLong = dailyTravel > 180;
            if (singleLongTravel && isTrafficLong) {
                day.nodes.push({ type: 'reminder', message: '本段交通较长（单次超过2小时，累计超过3小时），建议途中适当休息' });
            } else if (singleLongTravel) {
                day.nodes.push({ type: 'reminder', message: '本段交通较长（单次超过2小时），建议途中适当休息' });
            } else if (isTrafficLong) {
                day.nodes.push({ type: 'reminder', message: '今日交通较多（累计超过3小时），建议途中适当休息' });
            }
            if (dailyVisit > 300) {
                day.nodes.push({ type: 'reminder', message: '今日游览时间较长（超过5小时），注意体力' });
            }
        }
    }

    generateWeatherTips(weatherData) {
        const { weather, tempMax, tempMin, wind, uvIndex } = weatherData;
        let tips = `天气：${weather}，气温 ${tempMin}℃ ～ ${tempMax}℃`;
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

export async function generateTripPlan(selectedPois, startDate, startTime, mode, travelTimes, allPoisMap, accommodationPois, lodgingMode = 'all', startLocation = 'county') {
    if (!selectedPois || selectedPois.length === 0) {
        return { days: [], warnings: ['没有选择景点'], totalTravel: 0, totalVisit: 0, totalWaiting: 0 };
    }
    const planner = new TripPlanner(
        selectedPois, startDate, startTime, mode,
        travelTimes, allPoisMap, accommodationPois,
        lodgingMode, startLocation
    );
    return await planner.plan();
}
