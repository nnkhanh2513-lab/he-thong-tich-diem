const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());

// ← THÊM CORS
const cors = require('cors');
app.use(cors({
  origin: [
    'https://ket-noi-tri-thuc.myshopify.com',
    /\.myshopify\.com$/
  ],
  credentials: true
}));

const SHOPIFY_CONFIG = {
  domain: process.env.SHOPIFY_DOMAIN || 'ket-noi-tri-thuc.myshopify.com',
  token: process.env.SHOPIFY_TOKEN,
  apiVersion: '2024-10'
};

const TASKS = {
  login: { id: 'login', name: 'Đăng nhập', points: 10 },
  browse_time: { id: 'browse_time', name: 'Duyệt web', points: 10 }, // ← Sửa 5 → 10
  read_pages: { id: 'read_pages', name: 'Đọc bài', points: 30 }, // ← Sửa 10 → 30
  collect_books: { id: 'collect_books', name: 'Sưu tập', points: 20 },
  play_game: { id: 'play_game', name: 'Chơi game', points: 20 },
  complete_order: { id: 'complete_order', name: 'Hoàn tất đơn', points: 100 }
};


// ===== SHOPIFY GRAPHQL API =====
async function shopifyGraphQL(query) {
  const url = `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/graphql.json`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  
  const result = await response.json();
  if (result.errors) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.data;
}

// ===== LẤY METAFIELDS CỦA CUSTOMER =====
async function getCustomerMetafields(customerId) {
  const query = `
    query {
      customer(id: "gid://shopify/Customer/${customerId}") {
        id
        metafields(first: 20, namespace: "loyalty") {
          edges {
            node {
              id
              namespace
              key
              value
              type
            }
          }
        }
      }
    }
  `;
  
  const data = await shopifyGraphQL(query);
  const metafields = {
    ownerId: data.customer.id
  };
  
  data.customer.metafields.edges.forEach(({ node }) => {
    metafields[node.key] = node;
  });
  
  return metafields;
}

// ===== CẬP NHẬT METAFIELD =====
async function updateMetafield(ownerId, namespace, key, value, type = 'json') {
  const mutation = `
    mutation {
      metafieldsSet(metafields: [{
        ownerId: "${ownerId}"
        namespace: "${namespace}"
        key: "${key}"
        value: ${JSON.stringify(value)}
        type: "${type}"
      }]) {
        metafields {
          id
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  
  return await shopifyGraphQL(mutation);
}

// ===== TẠO METAFIELD MỚI =====
async function createMetafield(customerId, key, value, type = 'json') {
  const mutation = `
    mutation {
      metafieldsSet(metafields: [{
        ownerId: "gid://shopify/Customer/${customerId}"
        namespace: "loyalty"
        key: "${key}"
        value: ${JSON.stringify(value)}
        type: "${type}"
      }]) {
        metafields {
          id
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  
  return await shopifyGraphQL(mutation);
}

// ===== HOÀN THÀNH NHIỆM VỤ =====
async function completeTask(customerId, taskId, metadata = {}) {
  try {
    const metafields = await getCustomerMetafields(customerId);
    
    // Parse completed_tasks
    let completedTasks = {};
    if (metafields.completed_tasks) {
      try {
        completedTasks = JSON.parse(metafields.completed_tasks.value);
      } catch (e) {
        completedTasks = {};
      }
    }
    
    // Parse points_batches
    let pointsBatches = [];
    if (metafields.points_batches) {
      try {
        pointsBatches = JSON.parse(metafields.points_batches.value);
      } catch (e) {
        pointsBatches = [];
      }
    }
    
    // Kiểm tra đã hoàn thành chưa
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
    if (completedTasks[taskId] && completedTasks[taskId].lastCompleted === today) {
      console.log(`⚠️ Nhiệm vụ "${taskId}" đã hoàn thành hôm nay!`);
      return { success: false, message: 'Already completed today' };
    }
    
    // Cập nhật completed_tasks
    completedTasks[taskId] = {
      completedAt: new Date().toISOString(),
      lastCompleted: today,
      count: (completedTasks[taskId]?.count || 0) + 1,
      metadata: metadata
    };
    
    // Thêm points batch
    const points = TASKS[taskId]?.points || 0;
    const newBatch = {
      points: points,
      earnedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      source: `task_${taskId}`
    };
    pointsBatches.push(newBatch);
    
    // Tính tổng điểm
    const totalPoints = pointsBatches
      .filter(b => new Date(b.expiresAt) > new Date())
      .reduce((sum, b) => sum + b.points, 0);
    
    // Cập nhật metafields
    if (metafields.completed_tasks) {
      await updateMetafield(metafields.ownerId, 'loyalty', 'completed_tasks', completedTasks, 'json');
    } else {
      await createMetafield(customerId, 'completed_tasks', completedTasks);
    }
    
    if (metafields.points_batches) {
      await updateMetafield(metafields.ownerId, 'loyalty', 'points_batches', pointsBatches, 'json');
    } else {
      await createMetafield(customerId, 'points_batches', pointsBatches);
    }
    
    // Cập nhật tổng điểm
    if (metafields.points) {
      await updateMetafield(metafields.ownerId, 'loyalty', 'points', totalPoints, 'number_integer');
    } else {
      await createMetafield(customerId, 'points', totalPoints, 'number_integer');
    }
    
    // Lưu lịch sử giao dịch
    let history = [];
    if (metafields.points_history) {
      history = JSON.parse(metafields.points_history.value);
    }
    
    history.unshift({
      type: 'earn',
      points: points,
      taskId: taskId,
      taskName: TASKS[taskId]?.name,
      timestamp: new Date().toISOString()
    });
    
    // Giữ tối đa 100 giao dịch
    if (history.length > 100) {
      history.length = 100;
    }
    
    if (metafields.points_history) {
      await updateMetafield(metafields.ownerId, 'loyalty', 'points_history', history, 'json');
    } else {
      await createMetafield(customerId, 'points_history', history);
    }
    
    console.log(`✅ Hoàn thành "${TASKS[taskId]?.name}"! +${points} điểm`);

    console.log(`✅ Hoàn thành "${TASKS[taskId]?.name}"! +${points} điểm`);
    console.log(`📊 Tổng điểm: ${totalPoints}`);
    
    return { success: true, points, totalPoints };
    
  } catch (error) {
    console.error('❌ Lỗi completeTask:', error.message);
    throw error;
  }
}

// ===== WEBHOOK: ORDER PAID =====
app.post('/webhooks/orders/paid', async (req, res) => {
  try {
    const order = req.body;
    
    console.log('\n🎉 === WEBHOOK: ORDER PAID ===');
    console.log('📦 Đơn:', order.name);
    console.log('👤 Khách:', order.customer?.email || 'N/A');
    console.log('💰 Tổng:', order.total_price, order.currency);
    
    if (order.customer && order.customer.id) {
      await completeTask(order.customer.id.toString(), 'complete_order', {
        orderId: order.id.toString(),
        orderName: order.name,
        orderTotal: order.total_price
      });
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Lỗi webhook:', error);
    res.status(500).send('Error');
  }
});

// ===== API: COMPLETE TASK =====
app.post('/api/tasks/:taskId/complete', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { customerId, metadata } = req.body;
    
    if (!TASKS[taskId]) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const result = await completeTask(customerId, taskId, metadata);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== API: GET LOYALTY STATUS =====
app.get('/api/loyalty/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const metafields = await getCustomerMetafields(customerId);
    
    const completedTasks = metafields.completed_tasks 
      ? JSON.parse(metafields.completed_tasks.value) 
      : {};
    
    const pointsBatches = metafields.points_batches 
      ? JSON.parse(metafields.points_batches.value) 
      : [];
    
    const totalPoints = pointsBatches
      .filter(b => new Date(b.expiresAt) > new Date())
      .reduce((sum, b) => sum + b.points, 0);
    
    res.json({
      customerId,
      totalPoints,
      completedTasks,
      pointsBatches
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== API: TRACKING CHO 5 NHIỆM VỤ =====
app.post('/api/loyalty/track', async (req, res) => {
  try {
    const { shop, customer_id, customer_email, task_type, metadata = {} } = req.body;
    
    console.log('📊 Tracking request:', { shop, customer_id, customer_email, task_type });
    
    // Validate
    if (!customer_id && !customer_email) {
      return res.status(400).json({ 
        success: false, 
        message: 'customer_id hoặc customer_email là bắt buộc' 
      });
    }
    
    if (!task_type) {
      return res.status(400).json({ 
        success: false, 
        message: 'task_type là bắt buộc' 
      });
    }
    
    // Nếu có email, tìm customer ID
    let customerId = customer_id;
    
    if (!customerId && customer_email) {
      const searchQuery = `
        query {
          customers(first: 1, query: "email:${customer_email}") {
            edges {
              node {
                id
                email
              }
            }
          }
        }
      `;
      
      const searchResult = await shopifyGraphQL(searchQuery);
      const customer = searchResult.customers.edges[0]?.node;
      
      if (!customer) {
        return res.status(404).json({ 
          success: false, 
          message: 'Không tìm thấy customer với email này' 
        });
      }
      
      // Extract numeric ID from "gid://shopify/Customer/123456"
      customerId = customer.id.split('/').pop();
    }
    
    console.log(`✅ Customer ID: ${customerId}`);
    
    // Map task_type sang taskId
    const taskMap = {
      'login': 'login',
      'browse': 'browse_time',
      'read': 'read_pages',
      'collect': 'collect_books',
      'game': 'play_game'
    };
    
    const taskId = taskMap[task_type];
    
    if (!taskId || !TASKS[taskId]) {
      return res.status(400).json({
        success: false,
        message: 'Task không hợp lệ. Chỉ chấp nhận: login, browse, read, collect, game'
      });
    }
    
    // Hoàn thành task
    const result = await completeTask(customerId, taskId, metadata);
    
    if (result.success) {
      res.json({
        success: true,
        task: task_type,
        points_earned: result.points,
        total_points: result.totalPoints,
        message: `Hoàn thành nhiệm vụ "${TASKS[taskId].name}"! +${result.points} điểm`
      });
    } else {
      res.json({
        success: false,
        message: result.message,
        points_earned: 0
      });
    }
    
  } catch (error) {
    console.error('❌ Track loyalty error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

// ===== API: ĐỔI VOUCHER =====
app.post('/api/redeem-voucher', async (req, res) => {
  try {
    const { customerId, pointsToRedeem } = req.body;
    
    if (!customerId || !pointsToRedeem) {
      return res.status(400).json({ error: 'Missing customerId or pointsToRedeem' });
    }
    
    console.log(`\n💳 Đang đổi ${pointsToRedeem} điểm cho customer ${customerId}...`);
    
    // Lấy metafields
    const metafields = await getCustomerMetafields(customerId);
    
    // Parse points_batches
    let pointsBatches = [];
    if (metafields.points_batches) {
      pointsBatches = JSON.parse(metafields.points_batches.value);
    }
    
    // Lọc điểm còn hạn và sắp xếp FIFO
    const validBatches = pointsBatches
      .filter(b => new Date(b.expiresAt) > new Date())
      .sort((a, b) => new Date(a.earnedAt) - new Date(b.earnedAt));
    
    // Tính tổng điểm khả dụng
    const totalAvailable = validBatches.reduce((sum, b) => sum + b.points, 0);
    
    console.log(`📊 Điểm khả dụng: ${totalAvailable}`);
    
    if (totalAvailable < pointsToRedeem) {
      return res.status(400).json({ 
        error: 'Insufficient points',
        available: totalAvailable,
        requested: pointsToRedeem
      });
    }
    
   // ===== FIFO REDEEM – CHUẨN KHÔNG ĐÁNH MẤT DỮ LIỆU =====
const now = new Date();
let remaining = pointsToRedeem;
const updatedBatches = [];

// Tạo mapping batchId → số điểm cần trừ
const consumeMap = new Map();

// 1. Lọc batch hợp lệ & sort FIFO
const fifoBatches = pointsBatches
  .filter(b => new Date(b.expiresAt) > now)
  .sort((a, b) => new Date(a.earnedAt) - new Date(b.earnedAt));

// 2. Tính toán xem FIFO batch nào bị trừ bao nhiêu
for (const batch of fifoBatches) {
  if (remaining <= 0) break;

  if (batch.points <= remaining) {
    // consume toàn bộ batch này
    consumeMap.set(batch, batch.points);
    remaining -= batch.points;
  } else {
    // consume một phần
    consumeMap.set(batch, remaining);
    remaining = 0;
  }
}

// 3. Kiểm tra thiếu điểm
if (remaining > 0) {
  return res.status(400).json({
    error: 'Insufficient points',
    available: totalAvailable,
    requested: pointsToRedeem
  });
}

// 4. Tạo updatedBatches (giữ expired, giữ nguyên thứ tự gốc)
for (const batch of pointsBatches) {
  const isExpired = new Date(batch.expiresAt) <= now;

  if (isExpired) {
    // giữ nguyên expired
    updatedBatches.push({ ...batch });
    continue;
  }

  // batch nằm trong FIFO → bị trừ
  if (consumeMap.has(batch)) {
    const used = consumeMap.get(batch);
    const remain = batch.points - used;

    if (remain > 0) {
      updatedBatches.push({ ...batch, points: remain });
    }

    // remain = 0 → không push (tức batch bị xóa)
  } else {
    // batch valid nhưng không bị trừ
    updatedBatches.push({ ...batch });
  }
}

    
    console.log(`✂️ Đã trừ ${pointsToRedeem} điểm theo FIFO`);
    
    // Tạo discount code
    const discountCode = `LOYALTY${pointsToRedeem}_${Date.now().toString().slice(-6)}`;
const discountValue = Math.floor((pointsToRedeem / 300) * 10000); // 300 điểm = 10,000 VND
    
    console.log(`🎫 Đang tạo discount code: ${discountCode}...`);
    
    const createDiscountMutation = `
      mutation {
        discountCodeBasicCreate(basicCodeDiscount: {
          title: "Loyalty Reward ${discountCode}"
          code: "${discountCode}"
          startsAt: "${new Date().toISOString()}"
          endsAt: "${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()}"
          customerSelection: {
            customers: {
              add: ["gid://shopify/Customer/${customerId}"]
            }
          }
          customerGets: {
            value: {
              discountAmount: {
                amount: "${discountValue}"
                appliesOnEachItem: false
              }
            }
            items: {
              all: true
            }
          }
          appliesOncePerCustomer: true
        }) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                codes(first: 1) {
                  edges {
                    node {
                      code
                    }
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const discountResult = await shopifyGraphQL(createDiscountMutation);
    
    if (discountResult.discountCodeBasicCreate.userErrors.length > 0) {
      console.error('❌ Lỗi tạo discount:', discountResult.discountCodeBasicCreate.userErrors);
      throw new Error(JSON.stringify(discountResult.discountCodeBasicCreate.userErrors));
    }
    
    const discountId = discountResult.discountCodeBasicCreate.codeDiscountNode.id;
    
    console.log(`✅ Đã tạo discount code thành công!`);
    
    // Lưu voucher vào metafield
    let vouchers = [];
    if (metafields.vouchers) {
      vouchers = JSON.parse(metafields.vouchers.value);
    }
    
    const newVoucher = {
      code: discountCode,
      pointsUsed: pointsToRedeem,
      discountValue: discountValue,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      discountId: discountId
    };
    
    vouchers.push(newVoucher);
    
    console.log(`💾 Đang lưu voucher vào metafield...`);
    
    // Cập nhật metafields
    if (metafields.points_batches) {
      await updateMetafield(metafields.ownerId, 'loyalty', 'points_batches', updatedBatches, 'json');
    }
    
    if (metafields.vouchers) {
      await updateMetafield(metafields.ownerId, 'loyalty', 'vouchers', vouchers, 'json');
    } else {
      await createMetafield(customerId, 'vouchers', vouchers);
    }
    
    // Cập nhật tổng điểm
    const newTotal = updatedBatches
      .filter(b => new Date(b.expiresAt) > new Date())
      .reduce((sum, b) => sum + b.points, 0);
    
    if (metafields.points) {
      await updateMetafield(metafields.ownerId, 'loyalty', 'points', newTotal, 'number_integer');
    }
    
    // Lưu lịch sử giao dịch
    let history = [];
    if (metafields.points_history) {
      history = JSON.parse(metafields.points_history.value);
    }
    
    history.unshift({
      type: 'redeem',
      points: -pointsToRedeem,
      voucherCode: discountCode,
      voucherValue: discountValue,
      timestamp: new Date().toISOString()
    });
    
    // Giữ tối đa 100 giao dịch
    if (history.length > 100) {
      history.length = 100;
    }
    
    if (metafields.points_history) {
      await updateMetafield(metafields.ownerId, 'loyalty', 'points_history', history, 'json');
    } else {
      await createMetafield(customerId, 'points_history', history);
    }
    
    console.log(`\n✅ ĐỔI VOUCHER THÀNH CÔNG!`);

    console.log(`\n✅ ĐỔI VOUCHER THÀNH CÔNG!`);
    console.log(`💳 Code: ${discountCode}`);
    console.log(`💰 Giá trị: ${discountValue} VND`);
    console.log(`📊 Điểm còn lại: ${newTotal}\n`);
    
    res.json({
      success: true,
      voucher: newVoucher,
      remainingPoints: newTotal
    });
    
  } catch (error) {
    console.error('❌ Lỗi đổi voucher:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Loyalty system running!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🚀 ===== LOYALTY SYSTEM =====');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`✅ Webhook: /webhooks/orders/paid`);
  console.log(`✅ API: /api/loyalty/:customerId`);
  console.log(`✅ API: /api/redeem-voucher`);
  console.log('============================\n');
});
