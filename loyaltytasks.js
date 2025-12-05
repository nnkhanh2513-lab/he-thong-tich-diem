const fetch = require('node-fetch');

// Cấu hình Shopify
const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',
  apiVersion: '2024-10'
};

// Thời hạn điểm (2 tháng = 60 ngày)
const POINTS_EXPIRY_DAYS = 60;

// Cache
const pointsCache = new Map();
const batchesCache = new Map();

// Hàm xóa Cache (CẦN EXPORT)
function clearCache(customerId) {
  pointsCache.delete(customerId);
  batchesCache.delete(customerId);
  console.log(`[CACHE] Cleared cache for customer ${customerId}`);
}

// ===== THÊM MUTEX LOCK ĐỂ TRÁNH RACE CONDITION =====
const taskLocks = new Map();

async function acquireLock(customerId) {
  if (!taskLocks.has(customerId)) {
    taskLocks.set(customerId, Promise.resolve());
  }
  
  const currentLock = taskLocks.get(customerId);
  let releaseLock;
  
  const newLock = new Promise(resolve => {
    releaseLock = resolve;
  });
  
  taskLocks.set(customerId, currentLock.then(() => newLock));
  
  await currentLock;
  return releaseLock;
}

// Định nghĩa các nhiệm vụ (giữ nguyên)
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

// Hàm gọi Shopify API (giữ nguyên)
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
  const data = await response.json();
  if (response.ok) {
    return data;
  } else {
    console.error(`[ERROR] Shopify API failed for ${endpoint}:`, JSON.stringify(data, null, 2));
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }
}

// Lấy metafield của khách hàng (giữ nguyên)
async function getCustomerMetafield(customerId, namespace, key) {
  const data = await shopifyAPI(`/customers/${customerId}/metafields.json`);
  const metafield = data.metafields?.find(
    m => m.namespace === namespace && m.key === key
  );
  return metafield;
}

// Tạo/cập nhật metafield (giữ nguyên)
async function updateCustomerMetafield(customerId, namespace, key, value, type) {
  const existing = await getCustomerMetafield(customerId, namespace, key);
  
  let result;
  let payload = {
      metafield: {
          namespace,
          key,
          value: typeof value === 'object' ? JSON.stringify(value) : value.toString(),
          type
      }
  };
    
  if (existing) {
    console.log(`[DEBUG] Updating metafield ${namespace}.${key} for customer ${customerId}`);
    payload.metafield.id = existing.id;
    result = await shopifyAPI(
      `/customers/${customerId}/metafields/${existing.id}.json`,
      'PUT',
      payload
    );
  } else {
    console.log(`[DEBUG] Creating metafield ${namespace}.${key} for customer ${customerId}`);
    result = await shopifyAPI(
      `/customers/${customerId}/metafields.json`,
      'POST',
      payload
    );
  }
  
  console.log(`[DEBUG] Metafield saved successfully:`, result.metafield ? 'OK' : 'FAILED');
  return result;
}

// Lấy danh sách gói điểm (với cache) (CẦN EXPORT)
async function getPointsBatches(customerId) {
  if (batchesCache.has(customerId)) {
    return batchesCache.get(customerId);
  }
  
  const metafield = await getCustomerMetafield(customerId, 'loyalty', 'points_batches');
  const batches = metafield ? JSON.parse(metafield.value) : [];
  batchesCache.set(customerId, batches);
  return batches;
}

// Xóa điểm hết hạn và tính tổng điểm còn lại (CẦN EXPORT)
function cleanExpiredPoints(batches) {
  const now = new Date();
  const validBatches = batches.filter(batch => {
    const expiryDate = new Date(batch.expiresAt);
    return expiryDate > now;
  });
  
  const totalPoints = validBatches.reduce((sum, batch) => sum + batch.points, 0);
  
  return { validBatches, totalPoints };
}

// Lấy tổng điểm hiện tại (đã trừ điểm hết hạn) (CẦN EXPORT)
async function getCustomerPoints(customerId) {
  if (pointsCache.has(customerId)) {
    return pointsCache.get(customerId);
  }
  
  const batches = await getPointsBatches(customerId);
  const { totalPoints } = cleanExpiredPoints(batches);
  
  pointsCache.set(customerId, totalPoints);
  return totalPoints;
}

// Lấy danh sách nhiệm vụ đã hoàn thành (ĐÃ XÓA LOGIC AUTO-FIX) (CẦN EXPORT)
async function getCompletedTasks(customerId) {
  // LUÔN ĐỌC MỚI TỪ SHOPIFY - KHÔNG DÙNG CACHE
  const metafield = await getCustomerMetafield(customerId, 'loyalty', 'completed_tasks');
  let tasks = metafield ? JSON.parse(metafield.value) : {};
  
  // ❌ Đã xóa logic Auto-Fix array để tránh Race Condition (ghi/PUT trong hàm đọc/GET)
  if (Array.isArray(tasks)) {
    console.log(`⚠️ WARNING: completed_tasks is array for customer ${customerId}, using empty object.`);
    tasks = {};
  }
  
  console.log(`[DEBUG] getCompletedTasks for ${customerId}:`, Object.keys(tasks).length);
  return tasks;
}


// Thêm vào lịch sử (giữ nguyên)
async function addPointsHistory(customerId, entry) {
  const historyField = await getCustomerMetafield(customerId, 'loyalty', 'points_history');
  const history = historyField ? JSON.parse(historyField.value) : [];
  
  history.unshift(entry); // Thêm vào đầu mảng (mới nhất trước)
  
  // Giới hạn 100 giao dịch gần nhất
  if (history.length > 100) {
    history.length = 100;
  }
  
  await updateCustomerMetafield(
    customerId,
    'loyalty',
    'points_history',
    history,
    'json'
  );
}

// Thêm điểm mới (tạo gói điểm mới với thời hạn 2 tháng) (CẦN EXPORT)
async function addPoints(customerId, points, source) {
  const batches = await getPointsBatches(customerId);
  // LỌC ĐIỂM HẾT HẠN
  const { validBatches } = cleanExpiredPoints(batches);
  
  // Tạo gói điểm mới
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + POINTS_EXPIRY_DAYS);
  
  validBatches.push({
    points,
    earnedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    source
  });
  
  // CẬP NHẬT CACHE NGAY
  batchesCache.set(customerId, validBatches);
  
  // Lưu lại
  await updateCustomerMetafield(
    customerId,
    'loyalty',
    'points_batches',
    validBatches,
    'json'
  );
  
  // Tính tổng điểm mới
  const totalPoints = validBatches.reduce((sum, batch) => sum + batch.points, 0);
  pointsCache.set(customerId, totalPoints);
  
  return totalPoints;
}

// Trừ điểm (FIFO - trừ từ gói cũ nhất trước) (CẦN EXPORT)
async function deductPoints(customerId, pointsToDeduct) {
  const batches = await getPointsBatches(customerId);
  const { validBatches } = cleanExpiredPoints(batches);
  
  let remaining = pointsToDeduct;
  const newBatches = [];
  
  for (const batch of validBatches) {
    if (remaining <= 0) {
      newBatches.push(batch);
    } else if (batch.points <= remaining) {
      remaining -= batch.points;
    } else {
      newBatches.push({
        ...batch,
        points: batch.points - remaining
      });
      remaining = 0;
    }
  }
  
  // CẬP NHẬT CACHE NGAY
  batchesCache.set(customerId, newBatches);
  
  // Lưu lại
  await updateCustomerMetafield(
    customerId,
    'loyalty',
    'points_batches',
    newBatches,
    'json'
  );
  
  // Tính tổng điểm mới
  const totalPoints = newBatches.reduce((sum, batch) => sum + batch.points, 0);
  pointsCache.set(customerId, totalPoints);
  
  return totalPoints;
}

// ===== HOÀN THÀNH NHIỆM VỤ - ĐÃ FIX RACE CONDITION (CẦN EXPORT) =====
async function completeTask(customerId, taskId, metadata = {}) {
  // ✅ LOCK để tránh race condition
  const releaseLock = await acquireLock(customerId);
  
  try {
    const task = Object.values(TASKS).find(t => t.id === taskId);
    if (!task) {
      return { success: false, message: 'Nhiệm vụ không tồn tại' };
    }

    // ✅ ĐỌC 1 LẦN DUY NHẤT
    const completedTasks = await getCompletedTasks(customerId);
    // Sử dụng múi giờ UTC+7 cho ngày hoàn thành
    const today = new Date(new Date().getTime() + 7*60*60*1000).toISOString().split('T')[0];
    
    // Kiểm tra duplicate
    if (task.type === 'daily') {
      if (completedTasks[taskId]?.lastCompleted === today) {
        return {
          success: false,
          message: `Bạn đã hoàn thành nhiệm vụ "${task.name}" hôm nay rồi!`
        };
      }
    }
    
    // ✅ CẬP NHẬT trực tiếp trên object vừa đọc
    completedTasks[taskId] = {
      completedAt: new Date().toISOString(),
      lastCompleted: today,
      count: (completedTasks[taskId]?.count || 0) + 1,
      metadata
    };

    // ✅ LƯU lại toàn bộ object
    await updateCustomerMetafield(
      customerId,
      'loyalty',
      'completed_tasks',
      completedTasks,
      'json'
    );
    
    // Thêm điểm mới (tạo gói điểm mới)
    const newTotalPoints = await addPoints(customerId, task.points, `task_${taskId}`);

    // Ghi lịch sử
    await addPointsHistory(customerId, {
      type: 'earn',
      points: task.points,
      taskId: task.id,
      taskName: task.name,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: true,
      message: `Hoàn thành nhiệm vụ "${task.name}"! +${task.points} điểm`,
      points: newTotalPoints,
      earnedPoints: task.points,
      task: task.name,
      expiresIn: `${POINTS_EXPIRY_DAYS} ngày`
    };
    
  } finally {
    // ✅ UNLOCK sau khi xong
    releaseLock();
  }
}

// Tạo voucher từ điểm (CẦN EXPORT)
async function redeemVoucher(customerId, pointsToRedeem) {
  const releaseLock = await acquireLock(customerId);
  
  try {
    const currentPoints = await getCustomerPoints(customerId);
    
    if (currentPoints < pointsToRedeem) {
      return {
        success: false,
        message: `Không đủ điểm! Bạn có ${currentPoints} điểm, cần ${pointsToRedeem} điểm`
      };
    }
    
    const discountAmount = Math.floor((pointsToRedeem / 300) * 10000);
    const voucherCode = `BOOK${Date.now()}`;
    
    const priceRuleData = await shopifyAPI(
      '/price_rules.json',
      'POST',
      {
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
      }
    );
    
    if (!priceRuleData.price_rule || priceRuleData.errors) {
        throw new Error(`Failed to create price rule: ${JSON.stringify(priceRuleData.errors || priceRuleData)}`);
    }

    await shopifyAPI(
      `/price_rules/${priceRuleData.price_rule.id}/discount_codes.json`,
      'POST',
      {
        discount_code: {
          code: voucherCode
        }
      }
    );
    
    // Trừ điểm (FIFO)
    const newPoints = await deductPoints(customerId, pointsToRedeem);
    
    // Ghi lịch sử
    await addPointsHistory(customerId, {
      type: 'redeem',
      points: -pointsToRedeem,
      voucherCode: voucherCode,
      voucherValue: discountAmount,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: true,
      voucherCode,
      discountAmount,
      remainingPoints: newPoints,
      message: `Đã tạo voucher ${voucherCode} giảm ${discountAmount.toLocaleString('vi-VN')}₫`
    };
    
  } finally {
    releaseLock();
  }
}

// API cho frontend sử dụng
const API = {
  login: async (customerId) => {
    return await completeTask(customerId, 'login');
  },
  
  trackBrowseTime: async (customerId, minutes) => {
    const task = TASKS.BROWSE_TIME;
    // Kiểm tra điều kiện hoàn thành
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
    // Kiểm tra điều kiện hoàn thành
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
    // Kiểm tra điều kiện hoàn thành
    if (bookCount >= task.requiredBooks) {
      return await completeTask(customerId, 'collect_books', { bookCount });
    }
    return { 
      success: false, 
      message: `Cần thêm ${task.requiredBooks - bookCount} cuốn nữa` 
    };
  },
  
  trackOrder: async (customerId, orderId) => {
    // Logic này thường được gọi từ Webhook, nhưng giữ lại để đồng nhất
    return await completeTask(customerId, 'complete_order', { orderId });
  },
  
  playGame: async (customerId, gameScore) => {
    return await completeTask(customerId, 'play_game', { gameScore });
  },
  
  redeem: async (customerId, points) => {
    return await redeemVoucher(customerId, points);
  },
  
  getProgress: async (customerId) => {
    const points = await getCustomerPoints(customerId);
    const completedTasks = await getCompletedTasks(customerId);
    const batches = await getPointsBatches(customerId);
    const { validBatches } = cleanExpiredPoints(batches);

    const historyField = await getCustomerMetafield(customerId, 'loyalty', 'points_history');
    const history = historyField ? JSON.parse(historyField.value) : [];
    
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
        daysLeft: Math.ceil((new Date(b.expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
      }))
    };
  },
  
  clearCache: clearCache // Tên hàm đã được định nghĩa ở trên
};


// ===== TRACKING API CHO 5 NHIỆM VỤ (DÙNG CHO webhook-server-fixed.js) =====
async function trackLoyaltyTask(req, res) {
  const { customer_id, customer_email, task_type, metadata = {} } = req.body;
  
  console.log('📊 Tracking request:', { customer_id, customer_email, task_type, metadata });
  
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
    
    // Nếu không có customer_id, tìm từ email
    if (!customerId && customer_email) {
      const customersData = await shopifyAPI(`/customers/search.json?query=email:${customer_email}`);
      const customer = customersData.customers?.[0];
      
      if (!customer) {
        return res.status(404).json({ 
          success: false, 
          message: 'Không tìm thấy customer với email này' 
        });
      }
      
      customerId = customer.id;
    }
    
    console.log(`✅ Customer ID: ${customerId}`);
    
    // Map task_type sang function tương ứng
    let result;
    
    switch(task_type) {
      case 'login':
        result = await API.login(customerId);
        clearCache(customerId);
        break;
        
      case 'browse':
        const minutes = metadata.minutes || TASKS.BROWSE_TIME.requiredMinutes;
        result = await API.trackBrowseTime(customerId, minutes);
        if (result.success) clearCache(customerId);
        break;
        
      case 'read':
        const pages = metadata.pages || TASKS.READ_PAGES.requiredPages;
        result = await API.trackReadPages(customerId, pages);
        if (result.success) clearCache(customerId);
        break;
        
      case 'collect':
        const bookCount = metadata.bookCount || TASKS.COLLECT_BOOKS.requiredBooks;
        result = await API.trackCollectBooks(customerId, bookCount);
        if (result.success) clearCache(customerId);
        break;
        
      case 'game':
        const score = metadata.score || 100;
        result = await API.playGame(customerId, score);
        if (result.success) clearCache(customerId);
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Task không hợp lệ. Chỉ chấp nhận: login, browse, read, collect, game'
        });
    }
    
    console.log('📤 Result:', result);
    
    // Trả về kết quả
    if (result.success) {
      res.json({
        success: true,
        task: task_type,
        points_earned: result.earnedPoints,
        total_points: result.points,
        message: result.message,
        expiresIn: result.expiresIn
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
}


// Export các hàm cần thiết để webhook-server-fixed.js sử dụng
module.exports = { 
  ...API, 
  trackLoyaltyTask,
  completeTask,
  redeemVoucher,
  getPointsBatches,
  cleanExpiredPoints,
  clearCache,
  getCustomerPoints,
  getCompletedTasks
};
