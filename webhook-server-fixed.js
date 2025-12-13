// server.js - COMPLETE VERSION WITH BEACON
const express = require('express');
const fetch = require('node-fetch');
const { sendNotification, markAllRead, markAsRead } = require('./notifications');

const { 
  trackLoyaltyTask, 
  completeTask, 
  redeemVoucher,
  getCompletedTasks,
  clearCache,
  API,
  extractCustomerId
} = require('./loyaltytasks');

const {
  triggerNewBookRelease,
  triggerPriceDrop,
  triggerBackInStock,
  triggerNewReview,
  triggerPromotion,
  triggerUpdateInfo,
  triggerMaintenance
} = require('./notification-triggers');

const app = express();

// ========== CORS ==========
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
  res.header('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

// ========== BODY PARSER ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== DEBUG MIDDLEWARE ==========
app.use((req, res, next) => {
  if (req.path.includes('/loyalty') || req.path.includes('/notifications') || req.path.includes('/triggers')) {
    console.log(`📥 ${req.method} ${req.path}`, req.query);
  }
  next();
});

// ========== CONFIG ==========
const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: process.env.SHOPIFY_TOKEN || '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',
  apiVersion: '2024-10'
};

const TASKS = {
  LOGIN: { id: 'login', name: 'Đăng nhập', points: 10, type: 'daily', description: 'Đăng nhập vào tài khoản mỗi ngày' },
  BROWSE_TIME: { id: 'browse_time', name: 'Dạo một vòng coi sách', points: 10, type: 'daily', requiredMinutes: 2, description: 'Dạo xem sách trong 2 phút (1 lần/ngày)' },
  READ_PAGES: { id: 'read_pages', name: 'Đọc sách', points: 30, type: 'daily', requiredPages: 10, description: 'Đọc 10 trang sách mẫu (1 lần/ngày)' },
  COLLECT_BOOKS: { id: 'collect_books', name: 'Săn sách', points: 20, type: 'daily', requiredBooks: 2, description: 'Thêm 2 cuốn sách vào danh sách yêu thích (1 lần/ngày)' },
  COMPLETE_ORDER: { id: 'complete_order', name: 'Chốt đơn', points: 100, type: 'daily', requiredOrders: 1, description: 'Hoàn thành 1 đơn hàng (1 lần/ngày)' },
  PLAY_GAME: { id: 'play_game', name: 'Chơi trò chơi', points: 20, type: 'daily', description: 'Chơi trò chơi mini (1 lần/ngày)' }
};

// ========== ROUTES - THỨ TỰ QUAN TRỌNG! ==========

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Loyalty & Notification System',
    version: '3.0',
    endpoints: {
      loyalty: '/api/loyalty/*',
      notifications: '/api/notifications/*',
      triggers: '/api/triggers/*',
      webhooks: '/webhooks/*'
    }
  });
});

// ✅ 1. GET /api/loyalty/track - BEACON ENDPOINT (SPECIFIC ROUTE TRƯỚC)
app.get('/api/loyalty/track', async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🖼️ GET /api/loyalty/track');
  console.log('Query:', req.query);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const { callback } = req.query;
  
  // ✅ NẾU CÓ CALLBACK → TRẢ JSONP (cho redeem, game, etc.)
  if (callback) {
    try {
      const { customerId, taskId, duration, pages, books, score, points } = req.query;
      
      if (!customerId || !taskId) {
        return res.type('application/javascript').send(
          `${callback}(${JSON.stringify({ success: false, message: 'Missing params' })})`
        );
      }
      
      const customerIdStr = String(customerId);
      if (!/^\d+$/.test(customerIdStr)) {
        return res.type('application/javascript').send(
          `${callback}(${JSON.stringify({ success: false, message: 'Invalid customerId' })})`
        );
      }
      
      console.log('✅ JSONP Processing:', taskId, 'for', customerIdStr);
      
      let result;
      
      if (taskId === 'redeem' && points) {
        result = await redeemVoucher(customerIdStr, parseInt(points));
      } else if (taskId === 'browse_time' && duration) {
        const minutes = Math.floor(parseInt(duration) / 60);
        result = await API.trackBrowseTime(customerIdStr, minutes);
      } else if (taskId === 'read_pages' && pages) {
        result = await API.trackReadPages(customerIdStr, parseInt(pages));
      } else if ((taskId === 'collect' || taskId === 'collect_books') && books) {
        result = await API.trackCollectBooks(customerIdStr, parseInt(books));
      } else if ((taskId === 'game' || taskId === 'play_game') && score) {
        result = await API.playGame(customerIdStr, parseInt(score));
      } else {
        result = await completeTask(customerIdStr, taskId, {});
      }
      
      clearCache(customerIdStr);
      console.log('✅ JSONP Result:', result);
      
      return res.type('application/javascript').send(
        `${callback}(${JSON.stringify(result)})`
      );
      
    } catch (error) {
      console.error('❌ JSONP Error:', error.message);
      return res.type('application/javascript').send(
        `${callback}(${JSON.stringify({ success: false, message: error.message })})`
      );
    }
  }
  
  // ✅ KHÔNG CÓ CALLBACK → TRẢ PIXEL (cho login, browse, read)
  const sendPixel = () => {
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-cache'
    });
    res.end(pixel);
  };

  try {
    const { customerId, taskId, duration, pages, books, score, points } = req.query;
    
    if (!customerId || !taskId) {
      console.warn('⚠️ Missing params');
      return sendPixel();
    }
    
    const customerIdStr = String(customerId);
    if (!/^\d+$/.test(customerIdStr)) {
      console.error('❌ Invalid customerId:', customerId);
      return sendPixel();
    }
    
    console.log('✅ Pixel Processing:', taskId, 'for', customerIdStr);

    let result;

    if (taskId === 'redeem' && points) {
      result = await redeemVoucher(customerIdStr, parseInt(points));
    } else if (taskId === 'browse_time' && duration) {
      const minutes = Math.floor(parseInt(duration) / 60);
      result = await API.trackBrowseTime(customerIdStr, minutes);
    } else if (taskId === 'read_pages' && pages) {
      result = await API.trackReadPages(customerIdStr, parseInt(pages));
    } else if ((taskId === 'collect' || taskId === 'collect_books') && books) {
      result = await API.trackCollectBooks(customerIdStr, parseInt(books));
    } else if ((taskId === 'game' || taskId === 'play_game') && score) {
      result = await API.playGame(customerIdStr, parseInt(score));
    } else {
      result = await completeTask(customerIdStr, taskId, {});
    }

    clearCache(customerIdStr);
    console.log('✅ Pixel Result:', result.success ? 'SUCCESS' : result.message);

    return sendPixel();
    
  } catch (error) {
    console.error('❌ Pixel Error:', error.message);
    return sendPixel();
  }
});

// ✅ 2. POST /api/loyalty/track
app.post('/api/loyalty/track', trackLoyaltyTask);

// ✅ 3. DYNAMIC ROUTES SAU (GET /api/loyalty/:customerId)
app.get('/api/loyalty/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const { points, completedTasks, availableTasks, pointsBatches, history } = await API.getProgress(customerId);

    res.json({
      points,
      completedTasks,
      availableTasks,
      pointsBatches,
      history
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== OTHER LOYALTY ENDPOINTS ==========

app.get('/api/tasks', (req, res) => {
  res.json(TASKS);
});

app.post('/api/tasks/:taskId/complete', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { customerId, metadata } = req.body;
    
    const result = await completeTask(customerId, taskId, metadata);
    clearCache(customerId); 

    if (result.success) {
      res.json(result);
    } else {
      res.status(200).json(result);
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/redeem-voucher', async (req, res) => {
  try {
    const { customerId, points: pointsToRedeem } = req.body;
    
    const result = await redeemVoucher(customerId, pointsToRedeem);
    clearCache(customerId); 

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result); 
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== NOTIFICATIONS ==========

app.post('/api/notifications/mark-all-read', async (req, res) => {
  try {
    const { customerId } = req.body;
    const result = await markAllRead(customerId);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/notifications/mark-read/:notificationId', async (req, res) => {
  try {
    const { customerId } = req.body;
    const { notificationId } = req.params;
    const result = await markAsRead(customerId, notificationId);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/notifications/send', async (req, res) => {
  try {
    const { customerId, type, title, message, link, data } = req.body;
    const result = await sendNotification(customerId, { type, title, message, link, data });
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== NOTIFICATION TRIGGERS ==========

app.post('/api/triggers/new-book', async (req, res) => {
  try {
    const { productId, productData } = req.body;
    const result = await triggerNewBookRelease(productId, productData);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/triggers/price-drop', async (req, res) => {
  try {
    const { productId, oldPrice, newPrice, productData } = req.body;
    const result = await triggerPriceDrop(productId, oldPrice, newPrice, productData);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/triggers/back-in-stock', async (req, res) => {
  try {
    const { productId, productData } = req.body;
    const result = await triggerBackInStock(productId, productData);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/triggers/new-review', async (req, res) => {
  try {
    const { productId, reviewData, productData } = req.body;
    const result = await triggerNewReview(productId, reviewData, productData);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/triggers/promotion', async (req, res) => {
  try {
    const { title, message, code, link } = req.body;
    const result = await triggerPromotion({ title, message, code, link });
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/triggers/update-info/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const result = await triggerUpdateInfo(customerId);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/triggers/maintenance', async (req, res) => {
  try {
    const { message, startTime, endTime } = req.body;
    const result = await triggerMaintenance({ message, startTime, endTime });
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== WEBHOOKS ==========

app.post('/webhooks/orders/paid', async (req, res) => {
  try {
    const order = req.body;
    const rawCustomerId = order.customer?.id;
    
    if (!rawCustomerId) {
      console.log('⚠️ Order from guest - skipping');
      return res.status(200).send('OK');
    }
    
    const customerId = extractCustomerId(rawCustomerId);
    
    console.log(`📦 Order paid: ${order.id} - Customer: ${customerId}`);
    
    const result = await completeTask(customerId, 'complete_order', { orderId: order.id });

    clearCache(rawCustomerId);
    
    if (result.success) {
      console.log(`✅ Cộng điểm thành công`);
    } else {
      console.log(`ℹ️ ${result.message}`);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).send('Error processed');
  }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🚀 ===== LOYALTY & NOTIFICATION SYSTEM =====
📡 Server: http://localhost:${PORT}
✅ Beacon: GET /api/loyalty/track
✅ Track: POST /api/loyalty/track
✅ Notifications: /api/notifications/*
✅ Triggers: /api/triggers/*
✅ Webhook: /webhooks/orders/paid
============================================
  `);
});
