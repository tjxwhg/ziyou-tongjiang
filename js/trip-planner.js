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
        this.MIN_SEGMENT = 30; // 最小分段阈值
    }

    async plan() {
        this.weatherData = await fetchWeatherForecast();
        const queue = [...this.pois];
        let processCount = 0;
        const MAX_ATTEMPTS = 30;
        this.lunchInserted = false;
        this.dinnerInserted = false;

        while (queue.length > 0 && this.currentDay <= this.maxDays && processCount < MAX_ATTEMPTS) {
            processCount++;
            const poi = queue.shift();
            if (!poi || !poi.id) continue;

            // 获取交通耗时
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

            // 17:00 后不规划新景点
            if (arrivalTime >= 1020) {
                this.warnings.push(`⏰ 到达 ${poi.name} 时间 ${formatTime(arrivalTime)} 已超过17:00，该景点移到明天规划。`);
                if (this.lastPoiId !== 'county') {
                    const shouldStay = this.currentTime > 1080;
                    if (shouldStay) {
                        this.finishDay(true);
                        this.moveToNextDay();
                        queue.unshift(poi);
                        continue;
                    } else {
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
                        }
                    }
                }
                this.finishDay();
                this.moveToNextDay();
                queue.unshift(poi);
                continue;
            }

            // 到达时间 < 8:00，等待
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
                    arrivalTime = this.currentTime + travel;
                }
            }

            // 到达时间 >= 18:00，移到下一天
            if (arrivalTime >= DAY_END) {
                if (this.dayNodes.length > 0) this.finishDay();
                this.moveToNextDay();
                queue.unshift(poi);
                continue;
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
                this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
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

            // ---- 游览循环 ----
            let remaining = poi._totalDuration;
            const totalDuration = poi._totalDuration;
            let segmentIndex = 0;
            let visitStartTime = this.currentTime;
            let consumed = 0;

            while (remaining > 0) {
                // 检查时间是否超过当天结束
                if (this.currentTime >= DAY_END) {
                    break;
                }

                // 检查是否在餐食窗口
                let meal = null;
                if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
                    meal = 'lunch';
                } else if (!this.dinnerInserted && this.currentTime >= DINNER_START && this.currentTime < DINNER_END) {
                    meal = 'dinner';
                }

                if (meal) {
                    if (remaining < this.MIN_SEGMENT) {
                        // 剩余时间小于阈值，直接游览完，不插入餐食
                        const visitNode = {
                            type: 'visit',
                            name: `浏览 ${poi.name}`,
                            nodeType: 'poi',
                            startTime: this.currentTime,
                            endTime: this.currentTime + remaining,
                            duration: remaining,
                            poiId: poi.id,
                            poiName: poi.name,
                            totalDuration: totalDuration,
                            remainingAfter: 0
                        };
                        this.addNode(visitNode);
                        this.totalVisitMinutes += remaining;
                        this.currentTime += remaining;
                        remaining = 0;
                        break; // 跳出循环
                    } else {
                        // 插入餐食
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

                // 计算下一个餐食窗口开始时间
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
                    if (gap < maxContinuous) {
                        maxContinuous = gap;
                    }
                }
                // 不超过当天结束
                if (this.currentTime + maxContinuous > DAY_END) {
                    maxContinuous = DAY_END - this.currentTime;
                }
                if (maxContinuous <= 0) break;

                // 如果剩余时间小于阈值，直接完成
                if (remaining < this.MIN_SEGMENT) {
                    maxContinuous = remaining;
                }

                // 创建游览节点
                const visitNode = {
                    type: 'visit',
                    name: `浏览 ${poi.name}`,
                    nodeType: 'poi',
                    startTime: this.currentTime,
                    endTime: this.currentTime + maxContinuous,
                    duration: maxContinuous,
                    poiId: poi.id,
                    poiName: poi.name,
                    totalDuration: totalDuration,
                    remainingAfter: remaining - maxContinuous
                };
                this.addNode(visitNode);
                this.totalVisitMinutes += maxContinuous;
                this.currentTime += maxContinuous;
                consumed += maxContinuous;
                remaining -= maxContinuous;
                segmentIndex++;
            }

            // ---- 循环结束，处理剩余时间 ----
            if (remaining > 0 && this.currentTime >= DAY_END) {
                if (remaining >= 60) {
                    this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间，将顺延至明天。`);
                    this.finishDay(true); // 住宿周边
                    this.moveToNextDay();
                    poi._totalDuration = remaining;
                    queue.unshift(poi);
                    // 跳过后续完成逻辑
                    continue;
                } else {
                    this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间（<60），自动丢弃。`);
                    remaining = 0;
                }
            }

            // 如果剩余为0，景点游览完成
            if (remaining === 0) {
                this.checkAndInsertMealAfterVisit();
                this.lastPoiId = poi.id;
            }

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

    // ---- 交通后检查餐食 ----
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

    // ---- 游览后检查餐食 ----
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

    // ---- 添加节点（自动合并连续同景点游览） ----
    addNode(node) {
        if (!node) return;
        if (node.type === 'visit') {
            const last = this.dayNodes[this.dayNodes.length - 1];
            if (last && last.type === 'visit' && last.poiId === node.poiId) {
                // 合并
                last.endTime = node.endTime;
                last.duration += node.duration;
                last.remainingAfter = node.remainingAfter;
                return;
            }
        }
        this.dayNodes.push(node);
    }

    // ---- 其他辅助方法（保持不变） ----
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

    // ---- 结束当天 ----
    finishDay(stayAtScenic = false) {
        if (this.dayNodes.length === 0) return;
        const last = this.dayNodes[this.dayNodes.length - 1];

        // 计算当天最后结束时间
        let dayEndTime = this.currentTime;
        for (let node of this.dayNodes) {
            if (node.endTime !== undefined && node.endTime > dayEndTime) {
                dayEndTime = node.endTime;
            } else if (node.startTime !== undefined && node.duration !== undefined) {
                const end = node.startTime + node.duration;
                if (end > dayEndTime) dayEndTime = end;
            }
        }
        if (this.dayNodes.length > 0) {
            const lastNode = this.dayNodes[this.dayNodes.length - 1];
            if (lastNode.endTime !== undefined) {
                dayEndTime = lastNode.endTime;
            }
        }
        const isLate = dayEndTime > 1080;

        // 如果当前不在县城且不是住宿节点，处理交通
        if (last.type !== 'accommodation' && this.lastPoiId !== 'county') {
            if (stayAtScenic || isLate) {
                // 推荐周边住宿，无论如何都不返回县城
                const nearestAcc = this.findNearestAccommodation(this.lastPoiId);
                const location = nearestAcc ? `${nearestAcc.name}（附近）` : '（周边住宿）';
                const accName = isLate ? '今天行程结束，住宿休息' : '今天行程结束';
                const accNode = {
                    type: 'accommodation',
                    name: accName,
                    startTime: this.currentTime,
                    endTime: this.currentTime + 1,
                    location: location
                };
                this.addNode(accNode);
                // 不添加返回交通，不更新lastPoiId
                this.allDays.push({
                    day: this.currentDay,
                    date: this.currentDate.toISOString().slice(0, 10),
                    nodes: this.dayNodes
                });
                this.dayNodes = [];
                this.isAccommodationAtScenic = true;
                this.currentDay++;
                this.lunchInserted = false;
                this.dinnerInserted = false;
                return;
            } else {
                // 返回县城
                const returnTravel = this.getTravelTime(this.lastPoiId, 'county');
                if (returnTravel > 0 && returnTravel <= 180) {
                    const travelStart = this.currentTime;
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
                    this.checkAndInsertMealAfterTransport(travelStart, this.currentTime);
                } else if (returnTravel > 180) {
                    this.warnings.push(`返回县城交通耗时 ${returnTravel} 分钟超过限制，请检查数据。`);
                }
            }
        }

        // 住宿节点
        const accName = isLate ? '今天行程结束，住宿休息' : '今天行程结束';
        this.addNode({
            type: 'accommodation',
            name: accName,
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

        if (wind && wind !== '--') {
            tips += `，风力 ${wind} km/h`;
        }
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
