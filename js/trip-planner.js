// js/trip-planner.js - 智能行程规划引擎（修复：交通提醒合并）
import { formatTime, timeToMinutes, getDistance, fetchWeatherForecast } from './utils.js';
import {
    DAY_START, PLAN_CUTOFF, VISIT_END,
    LUNCH_START, LUNCH_END, DINNER_START, DINNER_END,
    MEAL_DURATION, MAX_RETURN_TIME, MIN_SEGMENT, MIN_REST_DURATION
} from './config.js';

export class TripPlanner {
    constructor(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois, lodgingMode = 'all', startLocation = 'county') {
        this.pois = pois || [];
        this.startDate = startDate || new Date().toISOString().slice(0, 10);
        this.startTime = startTime || '08:00';
        this.mode = mode || 'relaxed';
        this.travelTimes = travelTimes || {};
        this.poiNodesMap = poiNodesMap || {};
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

        this.accommodationPoiMap = {};
        this.accommodationPois.forEach(p => { if (p && p.id) this.accommodationPoiMap[p.id] = p; });
        this.poiMap = {};
        this.pois.forEach(p => { if (p && p.id) this.poiMap[p.id] = p; });
        this.poiMap['county'] = { id: 'county', name: '红军广场', lat: 31.911705, lng: 107.245033 };

        this.lunchInserted = false;
        this.dinnerInserted = false;
    }

    async plan() {
        this.weatherData = await fetchWeatherForecast();
        const queue = this.pois.map(p => ({ poi: p, remaining: null }));

        while (queue.length > 0 && this.currentDay <= this.maxDays) {
            let overnightAtScenic = false;
            let dayHasContent = false;
            let processedCount = 0;
            const MAX_PER_DAY = 15;

            while (queue.length > 0 && this.currentTime < VISIT_END && processedCount < MAX_PER_DAY) {
                processedCount++;
                const item = queue.shift();
                const poi = item.poi;
                if (!poi || !poi.id) continue;

                const travel = this.getTravelTime(this.lastPoiId, poi.id);
                if (travel === 0 && this.lastPoiId !== poi.id) {
                    this.warnings.push(`⚠️ 从 ${this.getPoiName(this.lastPoiId)} 到 ${poi.name} 交通耗时数据缺失，跳过该景点。`);
                    continue;
                }
                if (travel > MAX_RETURN_TIME) {
                    this.warnings.push(`❌ 从 ${this.getPoiName(this.lastPoiId)} 到 ${poi.name} 交通耗时 ${travel} 分钟，超过 ${MAX_RETURN_TIME} 分钟限制。`);
                    continue;
                }

                const arrivalTime = this.currentTime + travel;

                if (arrivalTime >= PLAN_CUTOFF) {
                    this.warnings.push(`⏰ 到达 ${poi.name} 时间 ${formatTime(arrivalTime)} 已超过17:00，该景点移到明天。`);
                    queue.unshift(item);
                    break;
                }

                if (arrivalTime >= VISIT_END) {
                    queue.unshift(item);
                    break;
                }

                let totalDuration;
                if (item.remaining !== null && item.remaining !== undefined) {
                    totalDuration = item.remaining;
                } else {
                    totalDuration = this.calculateTotalDuration(poi);
                }

                if (this.lodgingMode === 'county') {
                    const estimatedEnd = arrivalTime + totalDuration;
                    if (estimatedEnd > VISIT_END) {
                        queue.unshift(item);
                        this.warnings.push(`📌 因选择县城住宿，${poi.name} 今日时间不足，已移至次日。`);
                        this.addNode({
                            type: 'reminder',
                            message: `因该景点当前规划游览时间不足，已移至次日游览，建议当前时间规划为附近景点游览。（景点：${poi.name}）`
                        });
                        break;
                    }
                }

                if (travel > 0) {
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
                    this.lastPoiId = poi.id;
                    this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
                }

                dayHasContent = true;

                this.checkPreVisitRestOrMeal();

                let remaining = totalDuration;
                while (remaining > 0 && this.currentTime < VISIT_END) {
                    let meal = null;
                    if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
                        meal = 'lunch';
                    } else if (!this.dinnerInserted && this.currentTime >= DINNER_START && this.currentTime < DINNER_END) {
                        meal = 'dinner';
                    }

                    if (meal) {
                        if (remaining < MIN_SEGMENT) {
                            const visitEndTime = this.currentTime + remaining;
                            this.addVisitNode(poi, this.currentTime, remaining, totalDuration, 0);
                            this.currentTime = visitEndTime;
                            remaining = 0;
                            if (meal === 'lunch' && this.currentTime < LUNCH_END && this.currentTime >= LUNCH_START) {
                                this.insertMeal('lunch');
                            } else if (meal === 'dinner' && this.currentTime < DINNER_END && this.currentTime >= DINNER_START) {
                                this.insertMeal('dinner');
                            }
                            break;
                        } else {
                            this.insertMeal(meal);
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
                    if (this.currentTime + maxContinuous > VISIT_END) {
                        maxContinuous = VISIT_END - this.currentTime;
                    }
                    if (maxContinuous <= 0) break;

                    this.addVisitNode(poi, this.currentTime, maxContinuous, totalDuration, remaining - maxContinuous);
                    this.currentTime += maxContinuous;
                    remaining -= maxContinuous;
                }

                if (remaining > 0) {
                    if (remaining >= 60) {
                        this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间，将顺延至明天。`);

                        if (!this.dinnerInserted) {
                            if (this.currentTime < DINNER_START) {
                                this.addRestNode(this.currentTime, DINNER_START);
                                this.currentTime = DINNER_START;
                            }
                            this.insertMeal('dinner');
                        }

                        this.addNode({
                            type: 'accommodation',
                            name: `今天行程结束，建议在 ${poi.name} 附近住宿`,
                            startTime: this.currentTime,
                            endTime: this.currentTime + 1,
                            location: ''
                        });
                        this.lastPoiId = poi.id;
                        queue.unshift({ poi, remaining });
                        overnightAtScenic = true;
                        break;
                    } else {
                        this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间（<60），自动丢弃。`);
                        remaining = 0;
                    }
                }

                if (remaining === 0) {
                    this.lastPoiId = poi.id;
                    if (queue.length > 0) {
                        this.checkAndInsertMealAfterVisit();
                    }
                }
            }

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
                this.advanceToNextDay(true);
                continue;
            }

            const allPoisDone = queue.length === 0;

            if (allPoisDone) {
                if (this.lastPoiId !== 'county' && this.lastPoiId) {
                    const returnTravel = this.getTravelTime(this.lastPoiId, 'county');
                    if (returnTravel > 0 && returnTravel <= MAX_RETURN_TIME && returnTravel > 10) {
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
                    }
                    this.lastPoiId = 'county';
                }

                this.addNode({
                    type: 'trip_end',
                    name: '整个行程规划结束',
                    startTime: this.currentTime,
                    endTime: this.currentTime + 1
                });

                this.closeDay();
                break;
            }

            this.handleReturnToCounty();
            this.ensureTwoMeals();

            const isLate = this.currentTime > VISIT_END;
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

    checkPreVisitRestOrMeal() {
        let nextWindow = null;
        let windowType = null;

        if (!this.lunchInserted && this.currentTime < LUNCH_START) {
            nextWindow = LUNCH_START;
            windowType = 'lunch';
        }
        if (!this.dinnerInserted && this.currentTime < DINNER_START) {
            if (nextWindow === null || DINNER_START < nextWindow) {
                nextWindow = DINNER_START;
                windowType = 'dinner';
            }
        }

        if (nextWindow === null) return;

        const timeToWindow = nextWindow - this.currentTime;
        if (timeToWindow > 0 && timeToWindow < MIN_SEGMENT) {
            this.addRestNode(this.currentTime, nextWindow);
            this.currentTime = nextWindow;
            this.insertMeal(windowType);
        }
    }

    handleReturnToCounty() {
        if (this.lastPoiId === 'county' || !this.lastPoiId) return;

        const returnTravel = this.getTravelTime(this.lastPoiId, 'county');
        if (returnTravel <= 0 || returnTravel > MAX_RETURN_TIME) {
            if (returnTravel > MAX_RETURN_TIME) {
                this.warnings.push(`返回县城交通耗时 ${returnTravel} 分钟超过限制。`);
            }
            this.lastPoiId = 'county';
            return;
        }

        if (returnTravel <= 10) {
            this.lastPoiId = 'county';
            this.checkAndInsertMealAfterVisit();
            return;
        }

        if (returnTravel <= 60) {
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
            return;
        }

        const estimatedArrival = this.currentTime + returnTravel;
        if (estimatedArrival < DINNER_END) {
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
        } else {
            if (!this.dinnerInserted) {
                if (this.currentTime < DINNER_START) {
                    this.addRestNode(this.currentTime, DINNER_START);
                    this.currentTime = DINNER_START;
                }
                this.insertMeal('dinner');
            }
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
        }
    }

    ensureTwoMeals() {
        if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
            this.insertMeal('lunch');
        }

        if (!this.dinnerInserted) {
            if (this.currentTime < DINNER_START) {
                this.addRestNode(this.currentTime, DINNER_START);
                this.currentTime = DINNER_START;
            }
            this.insertMeal('dinner');
        }
    }

    checkAndInsertMealAfterTransport(travelStart, travelEnd) {
        let meal = null;

        if (!this.lunchInserted) {
            if (travelStart < LUNCH_END && travelEnd >= LUNCH_START) {
                meal = 'lunch';
            }
        }
        if (!this.dinnerInserted && !meal) {
            if (travelStart < DINNER_END && travelEnd >= DINNER_START) {
                meal = 'dinner';
            }
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
            this.insertMeal(meal);
        }
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
        let duration = MEAL_DURATION;
        if (type === 'lunch') {
            if (start < LUNCH_START) start = LUNCH_START;
            if (start + duration > VISIT_END + 120) duration = MEAL_DURATION;
            if (duration <= 0) return null;
            return { type: 'meal', name: '午餐时间', startTime: start, endTime: start + duration, duration };
        } else if (type === 'dinner') {
            if (start < DINNER_START) start = DINNER_START;
            if (duration <= 0) return null;
            return { type: 'meal', name: '晚餐时间', startTime: start, endTime: start + duration, duration };
        }
        return null;
    }

    addRestNode(startTime, endTime) {
        const duration = endTime - startTime;
        if (duration < MIN_REST_DURATION) return;
        this.addNode({
            type: 'rest',
            name: '休息调整',
            startTime: startTime,
            endTime: endTime,
            duration: duration
        });
        this.totalWaitingMinutes += duration;
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

    calculateTotalDuration(poi) {
        return poi.visit_duration || 60;
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
            this.warnings.push(`⚠️ 未找到从 ${this.getPoiName(fromId)} 到 ${this.getPoiName(toId)} 的交通耗时。`);
            return 0;
        }
        return t;
    }

    // ★ 交通提醒合并
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
        for (let day of this.allDays) {
            let dailyTravel = 0, dailyVisit = 0, singleLongTravel = false;
            for (let node of day.nodes) {
                if (node.type === 'transport') {
                    dailyTravel += node.duration || 0;
                    if ((node.duration || 0) > 120) singleLongTravel = true;
                }
                if (node.type === 'visit') dailyVisit += node.duration || 0;
            }

            // ★ 合并后的交通提醒（3 种情形只输出 1 条）
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

export async function generateTripPlan(pois, startDate, startTime, mode, travelTimes, poiNodesMap, accommodationPois, lodgingMode = 'all', startLocation = 'county') {
    if (!pois || pois.length === 0) {
        return { days: [], warnings: ['没有选择景点'], totalTravel: 0, totalVisit: 0, totalWaiting: 0 };
    }
    const planner = new TripPlanner(
        pois, startDate, startTime, mode,
        travelTimes, poiNodesMap, accommodationPois,
        lodgingMode, startLocation
    );
    return await planner.plan();
}
