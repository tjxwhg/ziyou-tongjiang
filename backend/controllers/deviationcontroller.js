// controllers/deviationController.js
const poiGraph = require('../data/poi-graph');
const { simulatedAnnealing } = require('../planner/optimizer');
const { checkHardConstraints } = require('../planner/constraint-checker');
const { calculateObjective } = require('../planner/objective');
const { CONSTRAINTS } = require('../config');

/**
 * 上报实时偏差
 * POST /api/trip/deviation
 * Body: { tripId, currentPoiId, actualTime, gps }
 */
async function reportDeviation(req, res) {
  try {
    const { tripId, currentPoiId, actualTime, gps } = req.body;

    // 1. 获取原始行程方案
    // 实际需从数据库获取，这里简化
    // 2. 计算偏差
    const deviationMinutes = 0; // 实际计算

    // 3. 判断是否触发重规划
    const shouldReplan = Math.abs(deviationMinutes) > 15;

    if (shouldReplan) {
      // 获取当前状态，调用模拟退火重新规划
      // 返回调整后的方案
      const adjusted = await replanTrip(tripId, currentPoiId, gps);
      // 保存偏差记录
      await poiGraph.saveDeviationRecord(tripId, deviationMinutes, 'time_deviation', adjusted);
      return res.json({
        success: true,
        adjusted: true,
        solution: adjusted,
        reason: `实际进度与计划偏差 ${deviationMinutes} 分钟，已自动调整`
      });
    }

    // 轻微偏差，仅记录
    await poiGraph.saveDeviationRecord(tripId, deviationMinutes, 'minor_deviation', null);

    res.json({
      success: true,
      adjusted: false,
      message: '进度正常，继续执行'
    });

  } catch (error) {
    console.error('[偏差上报] 错误:', error);
    res.status(500).json({ error: error.message || '上报失败' });
  }
}

async function replanTrip(tripId, currentPoiId, gps) {
  // 实际实现：获取当前已完成节点、剩余节点、剩余时间
  // 重新调用模拟退火算法，以当前状态为初始解
  // 这里返回占位
  return {
    adjusted: true,
    message: '方案已调整'
  };
}

module.exports = {
  reportDeviation
};