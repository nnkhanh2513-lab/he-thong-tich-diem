const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());

const SHOPIFY_CONFIG = {
  domain: process.env.SHOPIFY_DOMAIN || 'ket-noi-tri-thuc.myshopify.com',
  token: process.env.SHOPIFY_TOKEN,
  apiVersion: '2024-10'
};

const TASKS = {
  login: { id: 'login', name: 'Đăng nhập', points: 10 },
  browse_time: { id: 'browse_time', name: 'Duyệt web', points: 5 },
  read_pages: { id: 'read_pages', name: 'Đọc bài', points: 10 },
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
        value: ${JSON.stringify(JSON.stringify(value))}
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
        value: ${JSON.stringify(JSON.stringify(value))}
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
    const today = new Date().toISOString().split('T')[0];
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
    
    // Trừ điểm theo FIFO
    let remaining = pointsToRedeem;
    const updatedBatches = [];
    
    for (const batch of pointsBatches) {
      if (remaining <= 0 || new Date(batch.expiresAt) <= new Date()) {
        updatedBatches.push(batch);
        continue;
      }
      
      if (batch.points <= remaining) {
        remaining -= batch.points;
      } else {
        batch.points -= remaining;
        remaining = 0;
        updatedBatches.push(batch);
      }
    }
    
    console.log(`✂️ Đã trừ ${pointsToRedeem} điểm theo FIFO`);
    
    // Tạo discount code
    const discountCode = `LOYALTY${pointsToRedeem}_${Date.now().toString().slice(-6)}`;
    const discountValue = pointsToRedeem * 1000; // 1 điểm = 1000 VND
    
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
                amount: ${discountValue}
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
