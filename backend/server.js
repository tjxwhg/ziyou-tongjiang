// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const config = require('./config');
const tripController = require('./controllers/tripController');
const deviationController = require('./controllers/deviationController');

const app = express();
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 行程规划路由
app.post('/api/plan/generate', tripController.generatePlan);
app.post('/api/plan/select', tripController.selectPlan);
app.post('/api/trip/deviation', deviationController.reportDeviation);
app.get('/api/poi/internal/:poiId', tripController.getPoiInternal);

const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`🚀 后端服务运行在 http://localhost:${PORT}`);
});