// js/trip-planner.js - 智能行程规划引擎（最终修复版 v6）
import { formatTime, timeToMinutes, getDistance, fetchWeatherForecast } from './utils.js';
import {
    DAY_START, PLAN_CUTOFF, VISIT_END,
    LUNCH_START, LUNCH_END, DINNER_START, DINNER_END,
    MEAL_DURATION, MAX_RETURN_TIME, MIN_SEGMENT
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

            // ============ 当天内层循环（可连续游览多个景点） ============
            while (queue.length > 0 && this.currentTime < VISIT_END && processedCount < MAX_PER_DAY) {
                processedCount++;
                const item = queue.shift();
                const poi = item.poi;
                if (!poi || !poi.id) continue;

                // 计算交通耗时
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

                // 规则：规划截止 17:00
                if (arrivalTime >= PLAN_CUTOFF) {
                    this.warnings.push(`⏰ 到达 ${poi.name} 时间 ${formatTime(arrivalTime)} 已超过17:00，该景点移到明天。`);
                    queue.unshift(item);
                    break;
                }

                // 规则：游览截止 18:00
                if (arrivalTime >= VISIT_END) {
                    queue.unshift(item);
                    break;
                }

                // 计算总游览时长
                let totalDuration;
                if (item.remaining !== null && item.remaining !== undefined) {
                    totalDuration = item.remaining;
                } else {
                    totalDuration = this.calculateTotalDuration(poi);
                }

                // 县城模式预检查（到达时间 + 游览时长 > 18:00 → 移至次日）
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

                // 插入交通节点
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
                    // 交通后立即检查餐食（L1/L2/L3、D1/D2/D3）
                    this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
                }

                dayHasContent = true;

                // 检查"到达景区距下一个未触发餐食窗口 <45 分钟"（L4 场景）
                this.checkPreVisitRestOrMeal();

                // ============ 游览循环 ============
                let remaining = totalDuration;
                while (remaining > 0 && this.currentTime < VISIT_END) {
                    // 判断当前是否在餐食窗口内
                    let meal = null;
                    if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
                        meal = 'lunch';
                    } else if (!this.dinnerInserted && this.currentTime >= DINNER_START && this.currentTime < DINNER_END) {
                        meal = 'dinner';
                    }

                    if (meal) {
                        if (remaining < MIN_SEGMENT) {
                            // L7：剩余<45，直接游览完（选项A）
                            const visitEndTime = this.currentTime + remaining;
                            this.addVisitNode(poi, this.currentTime, remaining, totalDuration, 0);
                            this.currentTime = visitEndTime;
                            remaining = 0;
                            // 检查游览完后是否仍在窗口内
                            if (meal === 'lunch' && this.currentTime < LUNCH_END && this.currentTime >= LUNCH_START) {
                                this.insertMeal('lunch');
                            } else if (meal === 'dinner' && this.currentTime < DINNER_END && this.currentTime >= DINNER_START) {
                                this.insertMeal('dinner');
                            }
                            break;
                        } else {
                            // 正常插餐
                            this.insertMeal(meal);
                            continue;
                        }
                    }

                    // 计算可连续游览时长
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
                    // 不超过 VISIT_END (18:00)
                    if (this.currentTime + maxContinuous > VISIT_END) {
                        maxContinuous = VISIT_END - this.currentTime;
                    }
                    if (maxContinuous <= 0) break;

                    this.addVisitNode(poi, this.currentTime, maxContinuous, totalDuration, remaining - maxContinuous);
                    this.currentTime += maxContinuous;
                    remaining -= maxContinuous;
                }

                // ============ 处理剩余时间 ============
                if (remaining > 0) {
                    if (remaining >= 60) {
                        // 跨天顺延
                        this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间，将顺延至明天。`);

                        // 先插入晚餐（18:00-19:00）
                        if (!this.dinnerInserted) {
                            if (this.currentTime < DINNER_START) {
                                this.addRestNode(this.currentTime, DINNER_START);
                                this.currentTime = DINNER_START;
                            }
                            this.insertMeal('dinner');
                        }

                        // 住宿景区附近
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
                        // 剩余<60，丢弃
                        this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间（<60），自动丢弃。`);
                        remaining = 0;
                    }
                }

                // 游览完成
                if (remaining === 0) {
                    this.lastPoiId = poi.id;
                    // 队列非空时，先检查餐食（若在窗口内）
                    if (queue.length > 0) {
                        this.checkAndInsertMealAfterVisit();
                    }
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

            // 跨天顺延：直接进入下一天
            if (overnightAtScenic) {
                this.closeDay();
                this.advanceToNextDay(true);
                continue;
            }

            // 返回县城（分档处理）
            this.handleReturnToCounty();

            // 每天两餐保障（行程提前结束的场景）
            this.ensureTwoMeals();

            // 住宿节点
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

    // ============================================================
    // 核心辅助：L4 场景检查（到达景区距下一个餐食窗口 <45 分钟）
    // ============================================================
    checkPreVisitRestOrMeal() {
        // 找出下一个未触发的餐食窗口
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
            // 插入"休息调整"节点
            this.addRestNode(this.currentTime, nextWindow);
            this.currentTime = nextWindow;
            // 插入餐食
            this.insertMeal(windowType);
        }
    }

    // ============================================================
    // 返回县城（分档处理）
    // ============================================================
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

        // 0-10 分钟：不插交通，仅插餐食（默认游客自行返回）
        if (returnTravel <= 10) {
            this.lastPoiId = 'county';
            this.checkAndInsertMealAfterVisit();
            return;
        }

        // 10-60 分钟：先交通，后餐食
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

        // >60 分钟：判断边界
        const estimatedArrival = this.currentTime + returnTravel;
        if (estimatedArrival < DINNER_END) {
            // 结束+交通 < 19:00，先交通后餐食
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
            // 结束+交通 >= 19:00，先餐食后交通
            if (!this.dinnerInserted) {
                if (this.currentTime < DINNER_START) {
                    this.addRestNode(this.currentTime, DINNER_START);
                    this.currentTime = DINNER_START;
                }
                if (this.currentTime < DINNER_END) {
                    this.insertMeal('dinner');
                } else {
                    this.insertMeal('dinner'); // 已过窗口，顺延插餐
                }
            }
            // 再插交通
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

    // ============================================================
    // 每天两餐保障（行程提前结束的场景）
    // ============================================================
    ensureTwoMeals() {
        // 午餐
        if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
            this.insertMeal('lunch');
        }

        // 晚餐
        if (!this.dinnerInserted) {
            if (this.currentTime < DINNER_START) {
                // 未到晚餐窗口：插"休息调整"节点等待
                this.addRestNode(this.currentTime, DINNER_START);
                this.currentTime = DINNER_START;
            }
            this.insertMeal('dinner');
        }
    }

    // ============================================================
    // 交通后检查餐食
    // ============================================================
    checkAndInsertMealAfterTransport(travelStart, travelEnd) {
        let meal = null;

        if (!this.lunchInserted) {
            // 交通时间段与午餐窗口有交集
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

    // ============================================================
    // 游览后检查餐食
    // ============================================================
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

    // ============================================================
    // 插入餐食节点
    // ============================================================
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

    // ============================================================
    // 插入"休息调整"节点
    // ============================================================
    addRestNode(startTime, endTime) {
        if (endTime <= startTime) return;
        this.addNode({
            type: 'rest',
            name: '休息调整',
            startTime: startTime,
            endTime: endTime,
            duration: endTime - startTime
        });
        this.totalWaitingMinutes += (endTime - startTime);
    }

    // ============================================================
    // 添加节点（同景点连续游览自动合并）
    // ============================================================
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

    // ============================================================
    // 天数管理
    // ============================================================
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

    // ============================================================
    // 基础工具方法
    // ============================================================
    calculateTotalDuration(poi) {
        const nodes = this.selectNodes(poi);
        if (!nodes || nodes.length === 0) return poi.visit_duration || 60;
        const total = nodes.reduce((sum, n) => sum + (n.suggested_duration_min || 0), 0);
        return total > 0 ? total : (poi.visit_duration || 60);
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
            for (let i = 0; i < Math.min(2, others.length); i++) selectedOthers.push(others[i]);
            const result = [...core, ...selectedOthers];
            return result.length > 0 ? result : null;
        } else {
            const filtered = nodes.filter(n => !['rest_area', 'wc'].includes(n.node_type));
            return filtered.length > 0 ? filtered : null;
        }
    }

    // ============================================================
    // 提醒与天气
    // ============================================================
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
            if (singleLongTravel) day.nodes.push({ type: 'reminder', message: '本段交通较长（超过2小时），请准备休息' });
            if (dailyTravel > 180) day.nodes.push({ type: 'reminder', message: '今日交通较多（累计超过3小时），建议途中适当休息' });
            if (dailyVisit > 300) day.nodes.push({ type: 'reminder', message: '今日游览时间较长（超过5小时），注意体力' });
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

// ============================================================
// 工厂函数
// ============================================================
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
