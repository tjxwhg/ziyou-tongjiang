// js/trip-planner.js - 行程规划引擎
import { formatTime, timeToMinutes, fetchWeatherForecast } from './utils.js';
import {
    DAY_START, PLAN_CUTOFF, VISIT_END, NIGHT_END,
    LUNCH_START, LUNCH_END, DINNER_START, DINNER_END,
    MEAL_DURATION, MAX_RETURN_TIME, MIN_REST_DURATION,
    MAX_WAIT_FOR_MEAL, MIN_VISIT_SEGMENT,
    MEAL_BREAK_THRESHOLD, MAX_WAIT_FOR_DINNER_DAY_END
} from './config.js';

export class TripPlanner {
    constructor(selectedPois, startDate, startTime, mode, travelTimes, allPoisMap,
                accommodationPois, lodgingMode = 'all', startLocation = 'county',
                lodgingOverrideMap = null) {
        this.pois = selectedPois || [];
        this.allPoisMap = allPoisMap || {};
        this.startDate = startDate || new Date().toISOString().slice(0, 10);
        this.startTime = startTime || '08:00';
        this.mode = mode || 'relaxed';
        this.travelTimes = travelTimes || {};
        this.accommodationPois = accommodationPois || [];
        this.lodgingMode = lodgingMode;
        this.startLocation = startLocation;
        this.lodgingOverrideMap = lodgingOverrideMap || {};

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
            const queueEmpty = this.runOneDay(queue);
            if (queueEmpty) break;
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

    runOneDay(queue) {
        let processedCount = 0;
        const MAX_PER_DAY = 15;

        while (queue.length > 0
               && this.currentTime < PLAN_CUTOFF
               && processedCount < MAX_PER_DAY) {
            processedCount++;
            const item = queue.shift();
            const poi = item.poi;
            if (!poi || !poi.id) continue;

            const level = poi.data_level || 'L2';
            const travel = this.calcTravel(this.lastPoiId, poi.id);

            // 交通超限 → 移次日，当天结束
            if (travel > MAX_RETURN_TIME) {
                this.warnings.push(`❌ 从 ${this.getPoiName(this.lastPoiId)} 到 ${poi.name} 交通耗时 ${travel} 分钟超限`);
                queue.unshift(item);
                break;
            }

            const travelStart = this.currentTime;
            const arrivalTime = travelStart + travel;

            // ★ 动态获取该 POI 的截止时间
            const dayLimit = this.getPoiDayLimit(poi);

            // L3 预判：整块装不下 → 移次日
            if (level === 'L3') {
                const dur = poi.visit_duration || 0;
                const plannedEnd = arrivalTime + dur;
                if (plannedEnd > dayLimit) {
                    queue.unshift(item);
                    break;
                }
            }

            // 交通节点
            if (travel > 0) {
                this.addNode({
                    type: 'transport',
                    name: `前往 ${poi.name}`,
                    startTime: travelStart,
                    endTime: arrivalTime,
                    duration: travel,
                    from: this.getPoiName(this.lastPoiId),
                    to: poi.name
                });
                this.totalTravelMinutes += travel;
                this.currentTime = arrivalTime;
                this.checkAndInsertMealAfterTransport(travelStart, arrivalTime);
            } else {
                if (String(this.lastPoiId) !== String(poi.id)
                    && String(this.lastPoiId) !== 'county'
                    && String(poi.id) !== 'county'
                    && !this.hasTravelData(this.lastPoiId, poi.id)) {
                    this.addNode({
                        type: 'transport',
                        name: `前往 ${poi.name}（交通无数据）`,
                        startTime: this.currentTime,
                        endTime: this.currentTime,
                        duration: 0,
                        from: this.getPoiName(this.lastPoiId),
                        to: poi.name,
                        noData: true
                    });
                }
            }

            // 游览
            let result;
            if (level === 'L3') {
                result = this.handleL3(poi, item, dayLimit);
            } else {
                result = this.handleL2(poi, item, dayLimit);
            }

            if (result.overnight) {
                queue.unshift(item);
                break;
            }

            this.lastPoiId = poi.id;
        }

        // ============================================================
        // 收尾判断
        // ============================================================
        const queueIsEmpty = queue.length === 0;
        const hasVisitToday = this.dayNodes.some(n => n.type === 'visit');

        // 当天无 visit 节点
        if (!hasVisitToday) {
            this.dayNodes = this.dayNodes.filter(n => n.type === 'reminder');
            if (this.dayNodes.length === 0) {
                this.dayNodes.push({
                    type: 'reminder',
                    message: '今天的时间不足以进行行程规划，已移至次日'
                });
            }
            this.closeDay();
            if (!queueIsEmpty) {
                this.advanceToNextDay(false, null);
            }
            return queueIsEmpty;
        }

        // ============================================================
        // 分支 A：整个规划行程结束（队列清空）
        // ============================================================
        if (queueIsEmpty) {
            this.handleReturnToCounty();
            this.tryInsertMealAtTripEnd();
            this.addNode({
                type: 'trip_end',
                name: '整个规划行程结束',
                startTime: this.currentTime,
                endTime: this.currentTime + 1
            });
            this.closeDay();
            return true;
        }

        // ============================================================
        // 分支 B：当天结束、队列还有剩余
        // ============================================================
        const lastVisitNode = [...this.dayNodes].reverse().find(n => n.type === 'visit' && n.poiId);
        const lastPoi = lastVisitNode ? this.allPoisMap[String(lastVisitNode.poiId)] : null;
        const nextPoi = queue[0]?.poi;

        const sameScenic = lastPoi && nextPoi
            && lastPoi.scenic_id != null && nextPoi.scenic_id != null
            && String(lastPoi.scenic_id) === String(nextPoi.scenic_id);

        let accommodationNode = null;
        let nextKeepPoiId = null;

        if (sameScenic) {
            const scenicId = lastPoi.scenic_id;
            const lodgingPoi = this.pickLodgingPoi(scenicId);

            if (lodgingPoi) {
                const travelToLodging = this.calcTravel(lastVisitNode.poiId, lodgingPoi.id);
                if (travelToLodging > 0) {
                    const tStart = this.currentTime;
                    this.addNode({
                        type: 'transport',
                        name: `前往住宿：${lodgingPoi.name}`,
                        startTime: tStart,
                        endTime: tStart + travelToLodging,
                        duration: travelToLodging,
                        from: this.getPoiName(lastVisitNode.poiId),
                        to: lodgingPoi.name
                    });
                    this.totalTravelMinutes += travelToLodging;
                    this.currentTime += travelToLodging;
                    this.checkAndInsertMealAfterTransport(tStart, this.currentTime);
                }
                this.lastPoiId = lodgingPoi.id;
                nextKeepPoiId = lodgingPoi.id;

                accommodationNode = {
                    type: 'accommodation',
                    name: `今日行程结束，住宿：${lodgingPoi.name}`,
                    startTime: this.currentTime,
                    endTime: this.currentTime + 1,
                    lodgingPoiId: lodgingPoi.id,
                    lodgingScenicId: String(scenicId)
                };
            } else {
                this.handleReturnToCounty();
                accommodationNode = {
                    type: 'accommodation',
                    name: '今日行程结束，住宿休息',
                    startTime: this.currentTime,
                    endTime: this.currentTime + 1
                };
            }
        } else {
            this.handleReturnToCounty();
            accommodationNode = {
                type: 'accommodation',
                name: '今日行程结束，住宿休息',
                startTime: this.currentTime,
                endTime: this.currentTime + 1
            };
        }

        this.checkAndInsertMealAfterVisit();

        if (!this.dinnerInserted) {
            const gap = DINNER_START - this.currentTime;
            if (gap > 0 && gap <= MAX_WAIT_FOR_DINNER_DAY_END) {
                this.addRestNode(this.currentTime, DINNER_START, '自由时间，建议在附近游览或休息');
                this.currentTime = DINNER_START;
                this.insertMeal('dinner');
            } else if (gap > MAX_WAIT_FOR_DINNER_DAY_END) {
                this.addNode({
                    type: 'reminder',
                    message: '今日较早结束，请自行安排休息和就餐'
                });
                this.dinnerInserted = true;
            }
        }

        if (accommodationNode) {
            accommodationNode.startTime = this.currentTime;
            accommodationNode.endTime = this.currentTime + 1;
            this.addNode(accommodationNode);
        }

        this.closeDay();
        this.advanceToNextDay(false, nextKeepPoiId);
        return false;
    }

    // ★ 动态获取 POI 的当日截止时间
    getPoiDayLimit(poi) {
        if (!poi) return VISIT_END;
        if (poi.hours_type === '24h') return NIGHT_END;
        if (poi.close_time) {
            const parts = poi.close_time.split(':');
            if (parts.length >= 2) {
                const h = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (!isNaN(h) && !isNaN(m)) {
                    return h * 60 + m;
                }
            }
        }
        return VISIT_END;
    }

    pickLodgingPoi(scenicId) {
        const sid = String(scenicId);
        const overrideId = this.lodgingOverrideMap?.[sid];
        if (overrideId) {
            const poi = this.allPoisMap[String(overrideId)];
            if (poi) return poi;
        }

        const candidates = Object.values(this.allPoisMap).filter(p =>
            String(p.scenic_id) === sid &&
            p.data_level === 'L4' &&
            (p.recommend_score || 0) >= 30 &&
            p.type === 'facility' &&
            (Array.isArray(p.facility_subtype)
                ? p.facility_subtype.includes('hotel')
                : p.facility_subtype === 'hotel')
        );
        if (candidates.length === 0) return null;
        const idx = Math.floor(Math.random() * candidates.length);
        return candidates[idx];
    }

    tryInsertMealAtTripEnd() {
        const current = this.currentTime;

        if (!this.lunchInserted) {
            if (current >= LUNCH_START && current < LUNCH_END) {
                this.insertMeal('lunch');
                return;
            }
            if (current < LUNCH_START) {
                const gap = LUNCH_START - current;
                if (gap <= MAX_WAIT_FOR_MEAL) {
                    this.addRestNode(current, LUNCH_START);
                    this.currentTime = LUNCH_START;
                    this.insertMeal('lunch');
                    return;
                }
            }
        }

        if (!this.dinnerInserted) {
            if (current >= DINNER_START && current < DINNER_END) {
                this.insertMeal('dinner');
                return;
            }
            if (current < DINNER_START) {
                const gap = DINNER_START - current;
                if (gap <= MAX_WAIT_FOR_MEAL) {
                    this.addRestNode(current, DINNER_START);
                    this.currentTime = DINNER_START;
                    this.insertMeal('dinner');
                    return;
                }
            }
        }
    }

    handleL2(poi, item, dayLimit) {
        const remaining0 = (item.remaining !== null && item.remaining !== undefined)
            ? item.remaining
            : (poi.visit_duration || 60);
        const totalDuration = remaining0;
        let remaining = remaining0;

        while (remaining > 0 && this.currentTime < dayLimit) {
            let meal = null;
            if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
                meal = 'lunch';
            } else if (!this.dinnerInserted && this.currentTime >= DINNER_START && this.currentTime < DINNER_END) {
                meal = 'dinner';
            }

            if (meal) {
                if (remaining < MEAL_BREAK_THRESHOLD) {
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
            if (this.currentTime + segment > dayLimit) {
                segment = dayLimit - this.currentTime;
            }
            if (segment <= 0) break;

            this.addVisitNode(poi, this.currentTime, segment, totalDuration, remaining - segment);
            this.currentTime += segment;
            remaining -= segment;
        }

        if (remaining > 0) {
            if (remaining >= MIN_VISIT_SEGMENT) {
                this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟（≥45），移至次日`);
                return { overnight: true, remaining };
            } else {
                this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟（<45），自动丢弃`);
                return { overnight: false };
            }
        }

        this.checkAndInsertMealAfterVisit();
        return { overnight: false };
    }

    handleL3(poi, item, dayLimit) {
        if (!this.lunchInserted && this.currentTime >= LUNCH_END) {
            this.lunchInserted = true;
        }
        if (!this.dinnerInserted && this.currentTime >= DINNER_END) {
            this.dinnerInserted = true;
        }

        const totalDuration = poi.visit_duration || 0;
        if (totalDuration <= 0) return { overnight: false };
        const endTime = this.currentTime + totalDuration;

        const tr = Array.isArray(poi.tour_route) ? poi.tour_route : [];
        const innerNodes = tr.map(id => this.allPoisMap[String(id)]).filter(Boolean);

        if (innerNodes.length > 0) {
            const sumDur = innerNodes.reduce((s, n) => s + (n.visit_duration || 0), 0);
            const fallbackPer = Math.max(1, Math.floor(totalDuration / innerNodes.length));
            let t = this.currentTime;
            let used = 0;
            for (let i = 0; i < innerNodes.length; i++) {
                const n = innerNodes[i];
                let dur = sumDur > 0 ? (n.visit_duration || 0) : fallbackPer;
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
        } else {
            this.addVisitNode(poi, this.currentTime, totalDuration, totalDuration, 0);
        }
        this.currentTime = endTime;
        this.handleMealAfterL3(endTime);
        return { overnight: false };
    }

    handleMealAfterL3(endTime) {
        if (!this.dinnerInserted && endTime >= DINNER_START && endTime < DINNER_END) {
            this.insertMeal('dinner');
            return;
        }
        if (!this.lunchInserted && endTime >= LUNCH_START && endTime < LUNCH_END) {
            this.insertMeal('lunch');
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

    addRestNode(startTime, endTime, customName = null) {
        const duration = endTime - startTime;
        if (duration < MIN_REST_DURATION) return;
        this.addNode({
            type: 'rest',
            name: customName || '休息调整',
            startTime, endTime, duration
        });
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

    advanceToNextDay(keepLastPoi = false, keepPoiId = null) {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentTime = DAY_START;
        if (keepPoiId != null) {
            this.lastPoiId = keepPoiId;
        } else if (!keepLastPoi) {
            this.lastPoiId = 'county';
        }
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

export async function generateTripPlan(selectedPois, startDate, startTime, mode,
                                        travelTimes, allPoisMap, accommodationPois,
                                        lodgingMode = 'all', startLocation = 'county',
                                        lodgingOverrideMap = null) {
    if (!selectedPois || selectedPois.length === 0) {
        return { days: [], warnings: ['没有选择景点'], totalTravel: 0, totalVisit: 0, totalWaiting: 0 };
    }
    const planner = new TripPlanner(
        selectedPois, startDate, startTime, mode,
        travelTimes, allPoisMap, accommodationPois,
        lodgingMode, startLocation, lodgingOverrideMap
    );
    return await planner.plan();
}
