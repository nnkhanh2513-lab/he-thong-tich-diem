const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();

// CORS - CHO PHÉP TẤT CẢ DOMAIN
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ... phần còn lại giữ nguyên


// ========== CẤU HÌNH ==========
const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',
  apiVersion: '2024-10'
};

const POINTS_EXPIRY_DAYS = 60;

const TASKS = {
  LOGIN: {
    id: 'login',
    name: 'Đăng nhập',
    points: 10,
    type: 'daily',
    icon: 'login'
  },
  BROWSE_TIME: {
    id: 'browse_time',
    name: 'Dạo một vòng coi sách',
    points: 10,
    type: 'daily',
    requiredMinutes: 2,
    icon: 'search'
  },
  READ_PAGES: {
    id: 'read_pages',
    name: 'Đọc sách',
    points: 30,
    type: 'daily',
    requiredPages: 10,
    icon: 'article'
  },
  COLLECT_BOOKS: {
    id: 'collect_books',
    name: 'Săn sách',
    points: 20,
    type: 'daily',
    requiredBooks: 2,
    icon: 'shopping_cart'
  },
  COMPLETE_ORDER: {
    id: 'complete_order',
    name: 'Chốt đơn',
    points: 100,
    type: 'daily',
    icon: 'check_circle'
  },
  PLAY_GAME: {
    id: 'play_game',
    name: 'Chơi trò chơi',
    points: 20,
    type: 'daily',
    icon: 'sports_esports'
  }
};

// ========== SHOPIFY API ==========
async function shopifyAPI(endpoint, method = 'GET', body = null) {
  const url = `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}${endpoint}`;
  
  const options = {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token,
      'Content-Type': 'application/json'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  return await response.json();
}

async function getCustomerMetafield(customerId, namespace, key) {
  const data = await shopifyAPI(`/customers/${customerId}/metafields.json`);
  return data.metafields?.find(m => m.namespace === namespace && m.key === key);
}

async function updateCustomerMetafield(customerId, namespace, key, value, type) {
  return await shopifyAPI(
    `/customers/${customerId}/metafields.json`,
    'POST',
    {
      metafield: {
        namespace,
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : value.toString(),
        type
      }
    }
  );
}

async function getCustomerPoints(customerId) {
  const metafield = await getCustomerMetafield(customerId, 'loyalty', 'points');
  return parseInt(metafield?.value || 0);
}

async function getCompletedTasks(customerId) {
  const metafield = await getCustomerMetafield(customerId, 'loyalty', 'completed_tasks');
  return metafield ? JSON.parse(metafield.value) : {};
}

async function getPointsBatches(customerId) {
  const metafield = await getCustomerMetafield(customerId, 'loyalty', 'points_batches');
  return metafield ? JSON.parse(metafield.value) : [];
}

// ========== API ENDPOINTS ==========

// Lấy thông tin loyalty
app.get('/api/loyalty/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const points = await getCustomerPoints(customerId);
    const completedTasks = await getCompletedTasks(customerId);
    const batches = await getPointsBatches(customerId);
    
    // ← THÊM LỊCH SỬ
    const historyField = await getCustomerMetafield(customerId, 'loyalty', 'points_history');
    const history = historyField ? JSON.parse(historyField.value) : [];
    
    res.json({
      points,
      completedTasks,
      availableTasks: TASKS,
      pointsBatches: batches,
      history
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Danh sách nhiệm vụ
app.get('/api/tasks', (req, res) => {
  res.json(TASKS);
});

// Hoàn thành nhiệm vụ
app.post('/api/tasks/:taskId/complete', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { customerId, metadata } = req.body;
    
    const task = Object.values(TASKS).find(t => t.id === taskId);
    if (!task) {
      return res.json({ success: false, message: 'Nhiệm vụ không tồn tại' });
    }
    
    const completedTasks = await getCompletedTasks(customerId);
    const today = new Date().toISOString().split('T')[0];
    
    if (task.type === 'daily' && completedTasks[taskId]?.lastCompleted === today) {
      return res.json({
        success: false,
        message: `Bạn đã hoàn thành nhiệm vụ "${task.name}" hôm nay rồi!`
      });
    }
    
    completedTasks[taskId] = {
      completedAt: new Date().toISOString(),
      lastCompleted: today,
      count: (completedTasks[taskId]?.count || 0) + 1,
      metadata
    };
    
    await updateCustomerMetafield(customerId, 'loyalty', 'completed_tasks', completedTasks, 'json');
    
    const currentPoints = await getCustomerPoints(customerId);
    const newPoints = currentPoints + task.points;
    await updateCustomerMetafield(customerId, 'loyalty', 'points', newPoints, 'number_integer');
    
    res.json({
      success: true,
      message: `Hoàn thành nhiệm vụ "${task.name}"! +${task.points} điểm`,
      points: newPoints,
      earnedPoints: task.points
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Đổi voucher
app.post('/api/redeem-voucher', async (req, res) => {
  try {
    const { customerId, points: pointsToRedeem, voucherValue } = req.body;
    
    const currentPoints = await getCustomerPoints(customerId);
    
    if (currentPoints < pointsToRedeem) {
      return res.json({
        success: false,
        message: `Không đủ điểm! Bạn có ${currentPoints} điểm, cần ${pointsToRedeem} điểm`
      });
    }
    
    // Tính giá trị voucher (nếu không truyền vào thì tự tính)
    const discountAmount = voucherValue || Math.floor((pointsToRedeem / 100) * 10000);
    const voucherCode = `OCEAN${Date.now()}`;
    
    // Tạo price rule
    const priceRuleData = await shopifyAPI('/price_rules.json', 'POST', {
      price_rule: {
        title: `Voucher ${discountAmount.toLocaleString('vi-VN')}₫ - ${pointsToRedeem} điểm`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: 'fixed_amount',
        value: `-${discountAmount}`,
        customer_selection: 'prerequisite',
        prerequisite_customer_ids: [customerId],
        starts_at: new Date().toISOString(),
        usage_limit: 1
      }
    });
    
    // Tạo discount code
    await shopifyAPI(
      `/price_rules/${priceRuleData.price_rule.id}/discount_codes.json`,
      'POST',
      { discount_code: { code: voucherCode } }
    );
    
    // Trừ điểm
    const newPoints = currentPoints - pointsToRedeem;
    await updateCustomerMetafield(customerId, 'loyalty', 'points', newPoints, 'number_integer');
    
    // ========== LƯU LỊCH SỬ ==========
    const historyField = await getCustomerMetafield(customerId, 'loyalty', 'points_history');
    const history = historyField ? JSON.parse(historyField.value) : [];
    
    history.unshift({
      type: 'redeem',
      points: -pointsToRedeem,
      voucherCode: voucherCode,
      voucherValue: discountAmount,
      timestamp: new Date().toISOString()
    });
    
    // Giữ tối đa 50 giao dịch
    if (history.length > 50) {
      history.pop();
    }
    
    await updateCustomerMetafield(customerId, 'loyalty', 'points_history', history, 'json');
    // ================================
    
    res.json({
      success: true,
      voucherCode,
      discountAmount,
      remainingPoints: newPoints,
      message: `Đã tạo voucher ${voucherCode} giảm ${discountAmount.toLocaleString('vi-VN')}₫`
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Webhook - Order paid
app.post('/webhooks/orders/paid', async (req, res) => {
  try {
    const order = req.body;
    const customerId = order.customer?.id;
    
    if (!customerId) {
      return res.status(200).send('OK');
    }
    
    console.log(`📦 Order paid: ${order.id} - Customer: ${customerId}`);
    
    // Cộng điểm cho nhiệm vụ chốt đơn
    const task = TASKS.COMPLETE_ORDER;
    const completedTasks = await getCompletedTasks(customerId);
    const today = new Date().toISOString().split('T')[0];
    
    if (completedTasks[task.id]?.lastCompleted === today) {
      console.log('✅ Đã cộng điểm cho đơn hàng hôm nay rồi');
      return res.status(200).send('OK');
    }
    
    completedTasks[task.id] = {
      completedAt: new Date().toISOString(),
      lastCompleted: today,
      count: (completedTasks[task.id]?.count || 0) + 1,
      metadata: { orderId: order.id }
    };
    
    await updateCustomerMetafield(customerId, 'loyalty', 'completed_tasks', completedTasks, 'json');
    
    // Lấy points_batches hiện tại
    const batchesField = await getCustomerMetafield(customerId, 'loyalty', 'points_batches');
    const batches = batchesField ? JSON.parse(batchesField.value) : [];

    // Tạo gói điểm mới (hết hạn sau 60 ngày)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 60);

    batches.push({
      points: task.points,
      earnedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      source: 'order'
    });

    // Lưu points_batches
    await updateCustomerMetafield(customerId, 'loyalty', 'points_batches', batches, 'json');

    // Tính tổng điểm từ các gói
    const totalPoints = batches.reduce((sum, batch) => sum + batch.points, 0);

    // Cập nhật loyalty.points
    await updateCustomerMetafield(customerId, 'loyalty', 'points', totalPoints, 'number_integer');

    // Lưu lịch sử
    const historyField = await getCustomerMetafield(customerId, 'loyalty', 'points_history');
    const history = historyField ? JSON.parse(historyField.value) : [];

    history.unshift({
      type: 'earn',
      points: task.points,
      taskId: task.id,
      taskName: task.name,
      timestamp: new Date().toISOString()
    });

    if (history.length > 50) {
      history.pop();
    }

    await updateCustomerMetafield(customerId, 'loyalty', 'points_history', history, 'json');
    
    console.log(`✅ Cộng ${task.points} điểm cho customer ${customerId}`);
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});


// ========== START SERVER ==========
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`
🚀 ===== LOYALTY SYSTEM =====
📡 Server: http://localhost:${PORT}
✅ Webhook: /webhooks/orders/paid
✅ API: /api/loyalty/:customerId
✅ API: /api/redeem-voucher
✅ API: /api/tasks/:taskId/complete
✅ API: /api/tasks
============================
  `);
});
