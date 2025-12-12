// loyaltytasks.js - COMPLETE FIXED VERSION
const fetch = require('node-fetch');
const crypto = require('crypto');
require('dotenv').config();

// ===== CONFIG (từ environment variables) =====
const SHOPIFY_CONFIG = {
  domain: process.env.SHOPIFY_DOMAIN || 'ket-noi-tri-thuc.myshopify.com',
  token: process.env.SHOPIFY_TOKEN,
  apiVersion: '2024-10'
};

// Validate config
if (!SHOPIFY_CONFIG.token) {
  console.error('❌ CRITICAL: SHOPIFY_TOKEN not set in .env');
  process.exit(1);
}

// ===== CONSTANTS =====
const POINTS_EXPIRY_DAYS = 60;

const TASKS = {
  LOGIN: {
    id: 'login',
    name: 'Đăng nhập',
    points: 10,
    type: 'daily',
    description: 'Đăng nhập vào tài khoản mỗi ngày'
  },
  BROWSE_TIME: {
    id: 'browse_time',
    name: 'Dạo một vòng coi sách',
    points: 10,
    type: 'daily',
    requiredMinutes: 2,
    description: 'Dạo xem sách trong 2 phút (1 lần/ngày)'
  },
  READ_PAGES: {
    id: 'read_pages',
    name: 'Đọc sách',
    points: 30,
    type: 'daily',
    requiredPages: 10,
    description: 'Đọc 10 trang sách mẫu (1 lần/ngày)'
  },
  COLLECT_BOOKS: {
    id: 'collect_books',
    name: 'Săn sách',
    points: 20,
    type: 'daily',
    requiredBooks: 2,
    description: 'Thêm 2 cuốn sách vào danh sách yêu thích (1 lần/ngày)'
  },
  COMPLETE_ORDER: {
    id: 'complete_order',
    name: 'Chốt đơn',
    points: 100,
    type: 'daily',
    requiredOrders: 1,
    description: 'Hoàn thành 1 đơn hàng (1 lần/ngày)'
  },
  PLAY_GAME: {
    id: 'play_game',
    name: 'Chơi trò chơi',
    points: 20,
    type: 'daily',
    description: 'Chơi trò chơi mini (1 lần/ngày)'
  }
};

// ===== REDIS SETUP (optional) =====
let redis = null;
const inMemoryCache = new Map();

if (process.env.REDIS_URL) {
  const Redis = require('ioredis');
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (err) => console.error('Redis error:', err));
  redis.on('connect', () => console.log('✅ Redis connected'));
} else {
  console.warn('⚠️ Redis not configured, using in-memory cache');
}

// ===== DISTRIBUTED LOCK =====
async function withCustomerLock(customerId, fn, timeoutMs = 5000) {
  const key = `lock:customer:${customerId}`;
  const lockValue = crypto.randomBytes(16).toString('hex');
  const start = Date.now();

  if (redis) {
    // Redis-based distributed lock
    while (true) {
      const acquired = await redis.set(key, lockValue, 'PX', timeoutMs, 'NX');
      if (acquired === 'OK') break;
      
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Lock timeout for customer ${customerId}`);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    try {
      return await fn();
    } finally {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, key, lockValue);
    }
  } else {
    // Fallback: in-memory lock
    while (inMemoryCache.get(key)) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Lock timeout for customer ${customerId}`);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    inMemoryCache.set(key, true);
    try {
      return await fn();
    } finally {
      inMemoryCache.delete(key);
    }
  }
}

// ===== HELPER FUNCTIONS =====
function todayVNDateString() {
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vnNow.toISOString().split('T')[0];
}

function safeParseJSON(str, fallback) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
}

function extractCustomerId(input) {
  const str = String(input);
  if (str.startsWith('gid://shopify/Customer/')) {
    return str.split('/').pop();
  }
  if (/^\d+$/.test(str)) return str;
  throw new Error('Invalid customer ID format: ' + str);
}

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

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors && result.errors.length) {
    throw new Error('GraphQL errors: ' + JSON.stringify(result.errors));
  }

  return result.data;
}

// ===== GET CUSTOMER METAFIELDS (GraphQL - optimized) =====
async function getCustomerMetafields(customerId) {
  // ✅ NORMALIZE customer ID trước khi query
  const normalizedId = extractCustomerId(customerId); // Luôn trả về số thuần
  
  const query = `
    query {
      customer(id: "gid://shopify/Customer/${normalizedId}") {
        id
        points: metafield(namespace: "loyalty", key: "points") {
          id
          value
          type
        }
        pointsBatches: metafield(namespace: "loyalty", key: "points_batches") {
          id
          value
          type
        }
        completedTasks: metafield(namespace: "loyalty", key: "completed_tasks") {
          id
          value
          type
        }
        pointsHistory: metafield(namespace: "loyalty", key: "points_history") {
          id
          value
          type
        }
        vouchers: metafield(namespace: "loyalty", key: "vouchers") {
          id
          value
          type
        }
      }
    }
  `;

  const data = await shopifyGraphQL(query);
  if (!data.customer) {
    throw new Error(`Customer ${normalizedId} not found`);
  }

  return {
    ownerId: data.customer.id,
    points: data.customer.points,
    points_batches: data.customer.pointsBatches,
    completed_tasks: data.customer.completedTasks,
    points_history: data.customer.pointsHistory,
    vouchers: data.customer.vouchers
  };
}


// ===== METAFIELDS SET (batch mutation) =====
async function metafieldsSetPayload(metafieldsArray) {
  const fields = metafieldsArray.map(m => {
    let valueStr;
    
    if (m.type === 'number_integer') {
      // ✅ Number cũng phải stringify!
      valueStr = `"${m.value}"`;
    } else {
  valueStr = JSON.stringify(JSON.stringify(m.value));
    }
    
    return `{
      ownerId: "${m.ownerId}"
      namespace: "${m.namespace}"
      key: "${m.key}"
      value: ${valueStr}
      type: "${m.type || 'json'}"
    }`;
  }).join('\n');

  const mutation = `
    mutation {
      metafieldsSet(metafields: [${fields}]) {
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

  const data = await shopifyGraphQL(mutation);
  const res = data.metafieldsSet;

  if (res.userErrors && res.userErrors.length) {
    throw new Error('metafieldsSet userErrors: ' + JSON.stringify(res.userErrors));
  }

  return res.metafields;
}


// ===== GET CUSTOMER POINTS (with cache) =====
async function getCustomerPoints(customerId) {
  const cacheKey = `points:${customerId}`;
  
  // Check cache
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) return parseInt(cached);
  }

  const metafields = await getCustomerMetafields(customerId);
  const pointsBatches = safeParseJSON(metafields.points_batches?.value, []);

  const now = new Date();
  const totalPoints = pointsBatches
    .filter(b => new Date(b.expiresAt) > now)
    .reduce((sum, b) => sum + b.points, 0);

  // Update cache (5 min TTL)
  if (redis) {
    await redis.set(cacheKey, totalPoints, 'EX', 300);
  }

  return totalPoints;
}

// ===== GET COMPLETED TASKS =====
async function getCompletedTasks(customerId) {
  const metafields = await getCustomerMetafields(customerId);
  let tasks = safeParseJSON(metafields.completed_tasks?.value, {});

  // Fix if array (legacy data)
  if (Array.isArray(tasks)) {
    console.warn(`⚠️ completed_tasks is array for customer ${customerId}, converting to object`);
    tasks = {};
  }

  return tasks;
}

// ===== COMPLETE TASK (ATOMIC) =====
async function completeTask(customerId, taskId, metadata = {}) {
  return await withCustomerLock(customerId, async () => {
    try {
      const task = Object.values(TASKS).find(t => t.id === taskId);
      if (!task) {
        return { success: false, message: 'Task not found' };
      }

      const metafields = await getCustomerMetafields(customerId);

      const completedTasks = safeParseJSON(metafields.completed_tasks?.value, {});
      let pointsBatches = safeParseJSON(metafields.points_batches?.value, []);
      let history = safeParseJSON(metafields.points_history?.value, []);

      // Check daily limit
      const today = todayVNDateString();
      if (task.type === 'daily' && completedTasks[taskId]?.lastCompleted === today) {
        return {
          success: false,
          message: `Bạn đã hoàn thành nhiệm vụ "${task.name}" hôm nay rồi!`
        };
      }

      // Update completed tasks
      completedTasks[taskId] = {
        completedAt: new Date().toISOString(),
        lastCompleted: today,
        count: (completedTasks[taskId]?.count || 0) + 1,
        metadata
      };

      // Add points batch
      const points = task.points;
      const now = new Date();
      pointsBatches.push({
        points,
        earnedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        source: `task_${taskId}`
      });

      // Cleanup expired batches + calculate total
      pointsBatches = pointsBatches.filter(b => new Date(b.expiresAt) > now);
      const totalPoints = pointsBatches.reduce((sum, b) => sum + b.points, 0);

      // Update history
      history.unshift({
        type: 'earn',
        points,
        taskId: task.id,
        taskName: task.name,
        timestamp: now.toISOString()
      });
      if (history.length > 100) history.length = 100;

      // ✅ ATOMIC BATCH UPDATE
      const ownerGid = metafields.ownerId || `gid://shopify/Customer/${customerId}`;
      await metafieldsSetPayload([
        { ownerId: ownerGid, namespace: 'loyalty', key: 'completed_tasks', value: completedTasks, type: 'json' },
        { ownerId: ownerGid, namespace: 'loyalty', key: 'points_batches', value: pointsBatches, type: 'json' },
        { ownerId: ownerGid, namespace: 'loyalty', key: 'points', value: totalPoints, type: 'number_integer' },
        { ownerId: ownerGid, namespace: 'loyalty', key: 'points_history', value: history, type: 'json' }
      ]);

      // Clear cache
      if (redis) {
        await redis.del(`points:${customerId}`);
      }

      console.log(`✅ [${customerId}] ${task.name}: +${points} → ${totalPoints}`);
 
      // ========== GỬI THÔNG BÁO ==========
      const { sendNotification } = require('./notifications');
      await sendNotification(customerId, {
        type: 'points_earned',
        title: `Bạn vừa nhận ${points} điểm!`,
        message: `Chúc mừng! Bạn đã hoàn thành nhiệm vụ "${task.name}"`,
        link: '/account'
      }).catch(err => console.error('Failed to send notification:', err));
      // ====================================
  
      return {
        success: true,
        message: `Hoàn thành nhiệm vụ "${task.name}"! +${points} điểm`,
        points: totalPoints,
        earnedPoints: points,
        task: task.name,
        expiresIn: `${POINTS_EXPIRY_DAYS} ngày`
      };

    } catch (error) {
      console.error(`❌ completeTask failed [customer=${customerId}, task=${taskId}]:`, error);
      throw error;
    }
  });
}

// ===== REDEEM VOUCHER (FIXED ORDER) =====
async function redeemVoucher(customerId, pointsToRedeem) {
  return await withCustomerLock(customerId, async () => {
    try {
      // Validate input
      if (pointsToRedeem < 300 || pointsToRedeem % 100 !== 0) {
        return {
          success: false,
          message: 'Điểm phải >= 300 và là bội số của 100'
        };
      }

      const metafields = await getCustomerMetafields(customerId);
      let pointsBatches = safeParseJSON(metafields.points_batches?.value, []);

      const now = new Date();
      const validBatches = pointsBatches
        .filter(b => new Date(b.expiresAt) > now)
        .sort((a, b) => new Date(a.earnedAt) - new Date(b.earnedAt));

      const totalAvailable = validBatches.reduce((s, b) => s + b.points, 0);

      if (totalAvailable < pointsToRedeem) {
        return {
          success: false,
          message: `Không đủ điểm! Bạn có ${totalAvailable} điểm, cần ${pointsToRedeem} điểm`
        };
      }

      // ✅ STEP 1: Trừ điểm trước (FIFO)
      let remaining = pointsToRedeem;
      const newBatches = [];

      for (const batch of pointsBatches) {
        if (new Date(batch.expiresAt) <= now) {
          // Preserve expired batches
          newBatches.push(batch);
          continue;
        }

        if (remaining <= 0) {
          newBatches.push(batch);
          continue;
        }

        if (batch.points <= remaining) {
          // Consume entire batch → don't push
          remaining -= batch.points;
        } else {
          // Partial consumption
          newBatches.push({
            ...batch,
            points: batch.points - remaining
          });
          remaining = 0;
        }
      }

      const newTotal = newBatches
        .filter(b => new Date(b.expiresAt) > now)
        .reduce((s, b) => s + b.points, 0);

      // ✅ STEP 2: Tạo voucher sau
      const uniqueId = crypto.randomBytes(4).toString('hex').toUpperCase();
      const voucherCode = `BOOK${pointsToRedeem}_${uniqueId}`;
      const discountAmount = Math.floor((pointsToRedeem / 300) * 10000);

      let discountId = null;

      try {
        // Create discount using GraphQL
        const createDiscountMutation = `
          mutation {
            discountCodeBasicCreate(basicCodeDiscount: {
              title: "Loyalty Reward ${voucherCode}"
              code: "${voucherCode}"
              startsAt: "${new Date().toISOString()}"
              endsAt: "${new Date(Date.now() + 30*24*60*60*1000).toISOString()}"
              customerSelection: {
                customers: {
                  add: ["gid://shopify/Customer/${customerId}"]
                }
              }
              customerGets: {
                value: {
                  discountAmount: {
                    amount: ${discountAmount}
                    appliesOnEachItem: false
                  }
                }
                items: { all: true }
              }
              appliesOncePerCustomer: true
            }) {
              codeDiscountNode { id }
              userErrors { field message }
            }
          }
        `;

        const discountResult = await shopifyGraphQL(createDiscountMutation);
        const createResp = discountResult.discountCodeBasicCreate;

        if (createResp.userErrors?.length > 0) {
          throw new Error(`Discount creation failed: ${JSON.stringify(createResp.userErrors)}`);
        }

        discountId = createResp.codeDiscountNode.id;

        // ✅ STEP 3: Save voucher + update points
        let vouchers = safeParseJSON(metafields.vouchers?.value, []);
        const newVoucher = {
          code: voucherCode,
          pointsUsed: pointsToRedeem,
          discountValue: discountAmount,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30*24*60*60*1000).toISOString(),
          status: 'active',
          discountId
        };
        vouchers.push(newVoucher);

        // Update history
        let history = safeParseJSON(metafields.points_history?.value, []);
        history.unshift({
          type: 'redeem',
          points: -pointsToRedeem,
          voucherCode,
          voucherValue: discountAmount,
          timestamp: new Date().toISOString()
        });
        if (history.length > 100) history.length = 100;

        // ✅ ATOMIC UPDATE
        const ownerGid = metafields.ownerId || `gid://shopify/Customer/${customerId}`;
        await metafieldsSetPayload([
          { ownerId: ownerGid, namespace: 'loyalty', key: 'points_batches', value: newBatches, type: 'json' },
          { ownerId: ownerGid, namespace: 'loyalty', key: 'vouchers', value: vouchers, type: 'json' },
          { ownerId: ownerGid, namespace: 'loyalty', key: 'points', value: newTotal, type: 'number_integer' },
          { ownerId: ownerGid, namespace: 'loyalty', key: 'points_history', value: history, type: 'json' }
        ]);

        // Clear cache
        if (redis) {
          await redis.del(`points:${customerId}`);
        }

        console.log(`✅ Voucher created: ${voucherCode} | Remaining: ${newTotal} pts`);

        return {
          success: true,
          voucherCode,
          discountAmount,
          remainingPoints: newTotal,
          message: `Đã tạo voucher ${voucherCode} giảm ${discountAmount.toLocaleString('vi-VN')}₫`
        };

      } catch (error) {
        // ✅ ROLLBACK: Delete discount if metafield update failed
        if (discountId) {
          console.warn(`⚠️ Rolling back discount ${discountId}`);
          try {
            await shopifyGraphQL(`
              mutation {
                discountCodeDelete(id: "${discountId}") {
                  userErrors { message }
                }
              }
            `);
          } catch (rollbackError) {
            console.error('❌ Rollback failed:', rollbackError);
          }
        }
        throw error;
      }

    } catch (error) {
      console.error(`❌ redeemVoucher failed [customer=${customerId}]:`, error);
      throw error;
    }
  });
}

// ===== FIND CUSTOMER BY EMAIL =====
async function findCustomerByEmail(email) {
  const escapedEmail = email.replace(/["\\]/g, '\\$&');
  
  const query = `
    query {
      customers(first: 1, query: "email:\\"${escapedEmail}\\"") {
        edges {
          node {
            id
            email
          }
        }
      }
    }
  `;
  
  const result = await shopifyGraphQL(query);
  const customer = result.customers.edges[0]?.node;
  
  if (!customer) {
    throw new Error(`Customer not found: ${email}`);
  }
  
  return extractCustomerId(customer.id);
}

// ===== API WRAPPER =====
const API = {
  login: async (customerId) => {
    return await completeTask(customerId, 'login');
  },

  trackBrowseTime: async (customerId, minutes) => {
    const task = TASKS.BROWSE_TIME;
    if (minutes >= task.requiredMinutes) {
      return await completeTask(customerId, 'browse_time', { minutes });
    }
    return {
      success: false,
      message: `Cần dạo thêm ${task.requiredMinutes - minutes} phút`
    };
  },

  trackReadPages: async (customerId, pages) => {
    const task = TASKS.READ_PAGES;
    if (pages >= task.requiredPages) {
      return await completeTask(customerId, 'read_pages', { pages });
    }
    return {
      success: false,
      message: `Cần đọc thêm ${task.requiredPages - pages} trang`
    };
  },

  trackCollectBooks: async (customerId, bookCount) => {
    const task = TASKS.COLLECT_BOOKS;
    if (bookCount >= task.requiredBooks) {
      return await completeTask(customerId, 'collect_books', { bookCount });
    }
    return {
      success: false,
      message: `Cần thêm ${task.requiredBooks - bookCount} cuốn nữa`
    };
  },

  trackOrder: async (customerId, orderId) => {
    return await completeTask(customerId, 'complete_order', { orderId });
  },

  playGame: async (customerId, gameScore) => {
    return await completeTask(customerId, 'play_game', { gameScore });
  },

  redeem: async (customerId, points) => {
    return await redeemVoucher(customerId, points);
  },

  getProgress: async (customerId) => {
    const metafields = await getCustomerMetafields(customerId);
    
    const points = await getCustomerPoints(customerId);
    const completedTasks = safeParseJSON(metafields.completed_tasks?.value, {});
    const pointsBatches = safeParseJSON(metafields.points_batches?.value, []);
    const history = safeParseJSON(metafields.points_history?.value, []);

    const now = new Date();
    const validBatches = pointsBatches.filter(b => new Date(b.expiresAt) > now);

    return {
      points,
      completedTasks,
      availableTasks: TASKS,
      history,
      pointsBatches: validBatches.map(b => ({
        points: b.points,
        earnedAt: b.earnedAt,
        expiresAt: b.expiresAt,
        source: b.source,
        daysLeft: Math.ceil((new Date(b.expiresAt) - now) / (1000 * 60 * 60 * 24))
      }))
    };
  }
};

// ===== TRACKING API (for webhook server) - COMPLETE VERSION =====
async function trackLoyaltyTask(req, res) {
  const { customer_id, customer_email, task_type, metadata = {}, duration_seconds, pages_visited, bookCount, result: gameResult, points } = req.body;

  console.log('📊 Tracking request:', { customer_id, customer_email, task_type, body: req.body });

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

  try {
    let customerId = customer_id;

    // Find customer by email if needed
    if (!customerId && customer_email) {
      customerId = await findCustomerByEmail(customer_email);
    }

    console.log(`✅ Customer ID: ${customerId}`);

    // Map task_type to function
    let result;

    switch(task_type) {
      case 'login':
        result = await API.login(customerId);
        break;

      case 'browse':
        // ✅ FIX: Đọc duration_seconds từ body
        const seconds = duration_seconds || metadata.duration_seconds || 120;
        const minutes = Math.floor(seconds / 60);
        result = await API.trackBrowseTime(customerId, minutes);
        break;

      case 'read':
        // ✅ FIX: Đọc pages_visited từ body
        const pages = pages_visited || metadata.pages_visited || TASKS.READ_PAGES.requiredPages;
        result = await API.trackReadPages(customerId, pages);
        break;

      case 'collect':
        // ✅ FIX: Đọc bookCount từ body
        const books = bookCount || metadata.bookCount || TASKS.COLLECT_BOOKS.requiredBooks;
        result = await API.trackCollectBooks(customerId, books);
        break;

      case 'game':
        // ✅ FIX: Đọc result từ body
        const score = gameResult || metadata.result || 100;
        result = await API.playGame(customerId, score);
        break;

      case 'order':
        const orderId = metadata.orderId;
        if (!orderId) {
          return res.status(400).json({
            success: false,
            message: 'Thiếu orderId cho nhiệm vụ order'
          });
        }
        result = await API.trackOrder(customerId, orderId);
        break;

      case 'redeem':
        // ✅ FIX: Đọc points từ body
        const pointsToRedeem = points || metadata.points;
        if (!pointsToRedeem) {
          return res.status(400).json({
            success: false,
            message: 'Thiếu points để đổi voucher'
          });
        }
        result = await API.redeem(customerId, pointsToRedeem);
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Task không hợp lệ. Chỉ chấp nhận: login, browse, read, collect, game, order, redeem'
        });
    }

    console.log('📤 Result:', result);

    // Return result
    if (result.success) {
      if (task_type === 'redeem') {
        res.json({
          success: true,
          voucherCode: result.voucherCode,
          discountAmount: result.discountAmount,
          remainingPoints: result.remainingPoints,
          message: result.message
        });
      } else {
        res.json({
          success: true,
          task: task_type,
          points_earned: result.earnedPoints,
          total_points: result.points,
          message: result.message,
          expiresIn: result.expiresIn
        });
      }
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
}


// ===== HELPER: Clear cache =====
function clearCache(customerId) {
  if (redis) {
    redis.del(`points:${customerId}`);
  }
}

// ===== EXPORTS =====
module.exports = {
  // Core functions
  completeTask,
  redeemVoucher,
  getCustomerPoints,
  getCompletedTasks,
  getCustomerMetafields,
  metafieldsSetPayload,
  
  // API wrapper
  API,
  clearCache,
  // Tracking endpoint
  trackLoyaltyTask,
  
  // Helpers
  findCustomerByEmail,
  
  // Constants
  TASKS,
  POINTS_EXPIRY_DAYS
};
