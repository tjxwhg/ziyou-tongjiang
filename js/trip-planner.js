// js/trip-planner.js - 智能行程规划引擎（修复版：连续游览 + 智能餐食插入 + 顺延 + 周边住宿）
import { formatTime, timeToMinutes, getDistance, fetchWeatherForecast } from './utils.js';
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
        // 记录当前景点是否已经分段
        this.currentPoiSegments = [];
    }

    // ========== 主规划方法 ==========
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

            // ========== 17:00 后不规划新景点 ==========
            if (arrivalTime >= 1020) {
                this.warnings.push(`⏰ 到达 ${poi.name} 时间 ${formatTime(arrivalTime)} 已超过17:00，该景点移到明天规划。`);
                // 若当前不在县城，先返回县城（但后面会顺延，这里改为不强制返回，而是结束当天）
                if (this.lastPoiId !== 'county') {
                    // 尝试查找周边住宿，如果时间>18:00则住宿周边，否则返回县城
                    const shouldStay = this.currentTime > 1080; // 当前时间>18:00
                    if (shouldStay) {
                        // 住宿周边，不返回县城，直接结束当天
                        this.finishDay(true); // 传入参数表示住宿在景点周边
                        this.moveToNextDay();
                        queue.unshift(poi);
                        continue;
                    } else {
                        // 返回县城
                        const returnTravel = this.getTravelTime(this.lastPoiId, 'county');
                        if (returnTravel > 0 && returnTravel <= 180) {
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
                }
                // 检查餐食
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
                this.finishDay();
                this.moveToNextDay();
                queue.unshift(poi);
                continue;
            }

            // ========== 到达时间 < 8:00，等待 ==========
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

            // ========== 到达时间 >= 18:00，移到下一天 ==========
            if (arrivalTime >= DAY_END) {
                if (this.dayNodes.length > 0) this.finishDay();
                this.moveToNextDay();
                queue.unshift(poi);
                continue;
            }

            // ========== 插入交通节点 ==========
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

            // ========== 【修复】交通结束后立即检查餐食（无论是否跨过窗口） ==========
            this.checkAndInsertMealAfterTransport();

            // ========== 选择游览节点 ==========
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

            // ========== 【修复】游览分段（连续游览 + 餐食插入） ==========
            let remaining = poi._totalDuration;
            const totalDuration = poi._totalDuration;
            let segmentIndex = 0;
            let visitStartTime = this.currentTime;

            // 记录该景点是否已经部分游览（用于顺延）
            let consumed = 0;

            while (remaining > 0 && this.currentTime < DAY_END) {
                // 1. 检查当前时间是否在午餐或晚餐窗口内（未触发）
                let meal = null;
                if (!this.lunchInserted && this.currentTime >= LUNCH_START && this.currentTime < LUNCH_END) {
                    meal = 'lunch';
                } else if (!this.dinnerInserted && this.currentTime >= DINNER_START && this.currentTime < DINNER_END) {
                    meal = 'dinner';
                }
                if (meal) {
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

                // 2. 计算下一个餐食窗口开始时间（未触发的）
                let nextMealStart = Infinity;
                if (!this.lunchInserted && this.currentTime < LUNCH_START) {
                    nextMealStart = LUNCH_START;
                }
                if (!this.dinnerInserted && this.currentTime < DINNER_START && DINNER_START < nextMealStart) {
                    nextMealStart = DINNER_START;
                }

                // 3. 计算本段可连续游览的最大时长
                let maxContinuous = remaining;
                if (nextMealStart !== Infinity && nextMealStart > this.currentTime) {
                    const gap = nextMealStart - this.currentTime;
                    if (gap < maxContinuous) {
                        maxContinuous = gap;
                    }
                }
                // 不超过当天结束时间
                if (this.currentTime + maxContinuous > DAY_END) {
                    maxContinuous = DAY_END - this.currentTime;
                }
                if (maxContinuous <= 0) break;

                // 4. 创建游览节点（合并显示，不加“第X段”）
                const visitNode = {
                    type: 'visit',
                    name: `浏览 ${poi.name}`,   // 不再强制加段号，仅当有多段时，会在名称中自动显示？我们后面加段号标识
                    nodeType: 'poi',
                    startTime: this.currentTime,
                    endTime: this.currentTime + maxContinuous,
                    duration: maxContinuous,
                    poiId: poi.id,
                    poiName: poi.name,
                    totalDuration: totalDuration,
                    remainingAfter: remaining - maxContinuous
                };
                // 如果总时长大于一段，且有多段，则加段号（但此处maxContinuous可能等于剩余，只有一段）
                // 实际上，由于餐食中断，会生成多段，我们可以在每段名称后加上“（第X段）”，但为了更清晰，我们保留此逻辑：
                // 如果totalDuration > maxContinuous 且 后续还有剩余，则加上段号。
                // 但我们在这里无法预知后续，因此可以在后续循环中动态更新？不如在生成后统一处理，现在先简单处理：
                // 我们可以添加一个属性 segmentIndex，并在创建时赋值。
                // 由于我们会在循环中增加segmentIndex，我们可以在创建节点时记录段号。
                // 但为了更简洁，我们直接使用一个计数器，并在名称中体现。
                // 我们稍后在添加节点时判断：如果该景点总游览时间被拆成多段，则在名称后加“（第X段）”。
                // 实现：在循环外定义segmentIndex，每生成一段加1，如果totalDuration > maxContinuous，则说明还有剩余，可能多段。
                // 我们可以在生成节点时，如果已有一段，且还有剩余，则加段号。
                // 这里我们采用更简单的做法：在节点名称中统一不加段号，因为连续显示时，用户看到两个“浏览 XXX”中间夹着餐食，自然知道是分段。
                // 但如果只有一个段，名称就是“浏览 XXX”，符合要求。
                // 所以我们不加段号，完全合并。

                this.addNode(visitNode);
                this.totalVisitMinutes += maxContinuous;
                this.currentTime += maxContinuous;
                consumed += maxContinuous;
                remaining -= maxContinuous;
                segmentIndex++;

                // 如果剩余时间>0且到达当天结束，需要处理跨天
                if (remaining > 0 && this.currentTime >= DAY_END) {
                    // 当前景点未完成，剩余时间 >= 60 则顺延
                    if (remaining >= 60) {
                        this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间，将顺延至明天。`);
                        // 顺延：将当前景点放回队列头部，并结束当天
                        // 但是我们已经消耗了部分时间，需要记录已消耗，以便明天继续从剩余开始。
                        // 我们可以在poi上标记已消耗时间，下次再安排时只安排剩余。
                        // 简单做法：将poi重新入队，并修改其_totalDuration为剩余。
                        // 但是由于_totalDuration是之前计算的，我们可以在poi上存储一个_remaining。
                        poi._remaining = remaining;
                        // 将当前景点放到队列头部
                        queue.unshift(poi);
                        // 结束当天
                        this.finishDay();
                        this.moveToNextDay();
                        // 跳出while，处理下一天
                        break;
                    } else {
                        // 剩余不足60，丢弃
                        this.warnings.push(`⏳ ${poi.name} 剩余 ${remaining} 分钟游览时间（<60），自动丢弃。`);
                        remaining = 0;
                    }
                }
            }

            // 如果循环正常结束（remaining==0），且该景点已全部游览
            if (remaining === 0) {
                // 景点游览完成，检查是否需要插入餐食
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
            } else {
                // 如果remaining>0但循环因其他原因退出（如到达DAY_END），但上面处理了跨天，一般不会到此处
                // 这里作为保险
                if (remaining >= 60) {
                    queue.unshift(poi);
                } else {
                    // 丢弃
                }
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

    // ========== 【新增】交通结束后检查餐食 ==========
    checkAndInsertMealAfterTransport() {
        // 检查当前时间是否在午餐或晚餐窗口内
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

    // ========== 餐食触发检查（保留，但主要逻辑已内联） ==========

    checkTransportMealCross(currentTime, startTime) {
        if (!this.lunchInserted && startTime < LUNCH_START && currentTime >= LUNCH_START) return 'lunch';
        if (!this.dinnerInserted && startTime < DINNER_START && currentTime >= DINNER_START) return 'dinner';
        return null;
    }

    checkVisitMealTrigger(currentTime, remainingDuration) {
        // 保留原函数，但新逻辑不再调用，保持兼容
        if (!this.lunchInserted && currentTime >= LUNCH_START && currentTime < LUNCH_END) {
            if (remainingDuration >= 30) return 'lunch';
        }
        if (!this.dinnerInserted && currentTime >= DINNER_START && currentTime < DINNER_END) {
            if (remainingDuration >= 30) return 'dinner';
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

    // ========== 【修复】结束当天 ==========
    finishDay(stayAtScenic = false) {
        if (this.dayNodes.length === 0) return;
        const last = this.dayNodes[this.dayNodes.length - 1];

        // 判断当天结束时间（当前时间）
        const endTime = this.currentTime;
        const isLate = endTime > 1080; // 18:00

        // 如果当前不在县城，且不是住宿节点，根据情况决定是否返回县城
        if (last.type !== 'accommodation' && this.lastPoiId !== 'county') {
            // 如果stayAtScenic为true或时间>18:00，则尝试推荐景点周边住宿
            if (stayAtScenic || isLate) {
                // 查找最近的住宿
                const nearestAcc = this.findNearestAccommodation(this.lastPoiId);
                if (nearestAcc) {
                    // 在景点附近住宿（不返回县城）
                    // 添加住宿提示节点
                    const accNode = {
                        type: 'accommodation',
                        name: isLate ? '今天行程结束，住宿休息' : '今天行程结束',
                        startTime: this.currentTime,
                        endTime: this.currentTime + 1,
                        location: `${nearestAcc.name}（附近）`
                    };
                    this.addNode(accNode);
                    // 更新lastPoiId为住宿点，但住宿不是景点，不影响后续交通？我们保留lastPoiId为景点，但住宿节点已添加。
                    // 但是为了后续交通，应把lastPoiId设为景点还是住宿点？由于住宿点不是交通节点，后续交通应从景点出发。
                    // 我们保留lastPoiId为景点，这样下一天从该景点出发。
                    // 但住宿节点只是提示，不影响路线。
                    // 同时，我们不再返回县城。
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
                    // 没有找到附近住宿，返回县城
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
                        // 返回后检查餐食
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
                    } else if (returnTravel > 180) {
                        this.warnings.push(`返回县城交通耗时 ${returnTravel} 分钟超过限制，请检查数据。`);
                    }
                }
            } else {
                // 时间不晚，返回县城
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
                    // 返回后检查餐食
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
                } else if (returnTravel > 180) {
                    this.warnings.push(`返回县城交通耗时 ${returnTravel} 分钟超过限制，请检查数据。`);
                }
            }
        }

        // 住宿节点（根据结束时间决定名称）
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

    // ========== 查找最近的住宿POI ==========
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

    // ========== 天气提醒 ==========
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
