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

// Queue
const taskQueues = new Map();

async function enqueue(customerId, fn) {
  if (!taskQueues.has(customerId)) {
    taskQueues.set(customerId, Promise.resolve());
  }
  
  const queue = taskQueues.get(customerId);
  const newQueue = queue.then(fn).catch(fn);
  taskQueues.set(customerId, newQueue);
  
  return newQueue;
}

// Định nghĩa các nhiệm vụ
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

// Hàm gọi Shopify API
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

// Lấy metafield của khách hàng
async function getCustomerMetafield(customerId, namespace, key) {
  const data = await shopifyAPI(`/customers/${customerId}/metafields.json`);
  const metafield = data.metafields?.find(
    m => m.namespace === namespace && m.key === key
  );
  return metafield;
}

// Tạo/cập nhật metafield
async function updateCustomerMetafield(customerId, namespace, key, value, type) {
  const existing = await getCustomerMetafield(customerId, namespace, key);
  
  let result;
  
  if (existing) {
    console.log(`[DEBUG] Updating metafield ${namespace}.${key} for customer ${customerId}`);
    result = await shopifyAPI(
      `/customers/${customerId}/metafields/${existing.id}.json`,
      'PUT',
      {
        metafield: {
          id: existing.id,
          value: typeof value === 'object' ? JSON.stringify(value) : value.toString(),
          type
        }
      }
    );
  } else {
    console.log(`[DEBUG] Creating metafield ${namespace}.${key} for customer ${customerId}`);
    result = await shopifyAPI(
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
  
  // KIỂM TRA LỖI
  if (result.errors) {
    console.error('[ERROR] Shopify API Error:', JSON.stringify(result.errors, null, 2));
    throw new Error(`Failed to save metafield: ${JSON.stringify(result.errors)}`);
  }
  
  console.log(`[DEBUG] Metafield saved successfully:`, result.metafield ? 'OK' : 'FAILED');
  
  return result;
}

// Lấy danh sách gói điểm (với cache)
async function getPointsBatches(customerId) {
  if (batchesCache.has(customerId)) {
    return batchesCache.get(customerId);
  }
  
  const metafield = await getCustomerMetafield(customerId, 'loyalty', 'points_batches');
  const batches = metafield ? JSON.parse(metafield.value) : [];
  batchesCache.set(customerId, batches);
  return batches;
}

// Xóa điểm hết hạn và tính tổng điểm còn lại
function cleanExpiredPoints(batches) {
  const now = new Date();
  const validBatches = batches.filter(batch => {
    const expiryDate = new Date(batch.expiresAt);
    return expiryDate > now;
  });
  
  const totalPoints = validBatches.reduce((sum, batch) => sum + batch.points, 0);
  
  return { validBatches, totalPoints };
}

// Lấy tổng điểm hiện tại (đã trừ điểm hết hạn)
async function getCustomerPoints(customerId) {
  if (pointsCache.has(customerId)) {
    return pointsCache.get(customerId);
  }
  
  const batches = await getPointsBatches(customerId);
  const { totalPoints } = cleanExpiredPoints(batches);
  
  pointsCache.set(customerId, totalPoints);
  return totalPoints;
}

// Lấy danh sách nhiệm vụ đã hoàn thành
async function getCompletedTasks(customerId) {
  // LUÔN ĐỌC MỚI TỪ SHOPIFY - KHÔNG DÙNG CACHE
  const metafield = await getCustomerMetafield(customerId, 'loyalty', 'completed_tasks');
  const tasks = metafield ? JSON.parse(metafield.value) : {};
  console.log(`[DEBUG] getCompletedTasks for ${customerId}:`, JSON.stringify(tasks));
  return tasks;
}


// Thêm vào lịch sử
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

// Thêm điểm mới (tạo gói điểm mới với thời hạn 2 tháng)
async function addPoints(customerId, points, source) {
  const batches = await getPointsBatches(customerId);
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

// Trừ điểm (FIFO - trừ từ gói cũ nhất trước)
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

// Hoàn thành nhiệm vụ
async function completeTask(customerId, taskId, metadata = {}) {
  return enqueue(customerId, async () => {
    const task = Object.values(TASKS).find(t => t.id === taskId);
    if (!task) {
      return { success: false, message: 'Nhiệm vụ không tồn tại' };
    }
    
    const completedTasks = await getCompletedTasks(customerId);
    const today = new Date().toISOString().split('T')[0];
    
    if (task.type === 'daily') {
      if (completedTasks[taskId]?.lastCompleted === today) {
        return {
          success: false,
          message: `Bạn đã hoàn thành nhiệm vụ "${task.name}" hôm nay rồi!`
        };
      }
    }
    
    completedTasks[taskId] = {
      completedAt: new Date().toISOString(),
      lastCompleted: today,
      count: (completedTasks[taskId]?.count || 0) + 1,
      metadata
    };
    
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
  });
}

// Tạo voucher từ điểm
async function redeemVoucher(customerId, pointsToRedeem) {
  return enqueue(customerId, async () => {
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
  });
}

// API cho frontend sử dụng
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
    const points = await getCustomerPoints(customerId);
    const completedTasks = await getCompletedTasks(customerId);
    const batches = await getPointsBatches(customerId);
    const { validBatches } = cleanExpiredPoints(batches);
    
    return {
      points,
      completedTasks,
      availableTasks: TASKS,
      pointsBatches: validBatches.map(b => ({
        points: b.points,
        earnedAt: b.earnedAt,
        expiresAt: b.expiresAt,
        source: b.source,
        daysLeft: Math.ceil((new Date(b.expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
      }))
    };
  },
  
  clearCache: (customerId) => {
    pointsCache.delete(customerId);
    batchesCache.delete(customerId);
  }
};

// ===== TEST =====
const testCustomerId = '8105337946248';

async function testAll() {
  console.log('TEST HỆ THỐNG TÍCH ĐIỂM VỚI THỜI HẠN\n');
  
  API.clearCache(testCustomerId);
  
  console.log('1. Dạo xem 2 phút...');
  const browse = await API.trackBrowseTime(testCustomerId, 2);
  console.log('   ', browse.message, `(Tổng: ${browse.points}, Hết hạn sau: ${browse.expiresIn})`);
  
  console.log('\n2. Đọc 10 trang...');
  const read = await API.trackReadPages(testCustomerId, 10);
  console.log('   ', read.message, `(Tổng: ${read.points})`);
  
  console.log('\n3. Săn 2 cuốn sách...');
  const collect = await API.trackCollectBooks(testCustomerId, 2);
  console.log('   ', collect.message, `(Tổng: ${collect.points})`);
  
  console.log('\n4. Chơi game...');
  const game = await API.playGame(testCustomerId, 100);
  console.log('   ', game.message, `(Tổng: ${game.points})`);
  
  console.log('\n=== CHI TIẾT ĐIỂM ===');
  const progress = await API.getProgress(testCustomerId);
  console.log('Tổng điểm:', progress.points);
  console.log('\nCác gói điểm:');
  progress.pointsBatches.forEach((batch, i) => {
    const earnedDate = new Date(batch.earnedAt).toLocaleDateString('vi-VN');
    const expiryDate = new Date(batch.expiresAt).toLocaleDateString('vi-VN');
    console.log(`  Gói ${i+1}: ${batch.points} điểm - Kiếm ngày ${earnedDate} - Hết hạn ${expiryDate} (còn ${batch.daysLeft} ngày)`);
  });
}

//testAll();

// ===== TRACKING API CHO 5 NHIỆM VỤ =====
async function trackLoyaltyTask(req, res) {
  const { email, task, ...metadata } = req.body;
  
  // Validate
  if (!email || !task) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email và task là bắt buộc' 
    });
  }
  
  try {
    // 1. Tìm customer ID từ email
    const customersData = await shopifyAPI(`/customers/search.json?query=email:${email}`);
    const customer = customersData.customers?.[0];
    
    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Không tìm thấy customer với email này' 
      });
    }
    
    const customerId = customer.id;
    
    // 2. Map task name sang function tương ứng
    let result;
    
    switch(task) {
      case 'login':
        result = await API.login(customerId);
        break;
        
      case 'browse':
        const minutes = metadata.duration ? metadata.duration / 60 : 2;
        result = await API.trackBrowseTime(customerId, minutes);
        break;
        
      case 'read':
        const pages = metadata.pagesCount || 10;
        result = await API.trackReadPages(customerId, pages);
        break;
        
      case 'collect':
        const bookCount = metadata.products?.length || 2;
        result = await API.trackCollectBooks(customerId, bookCount);
        break;
        
      case 'game':
        const score = metadata.score || 100;
        result = await API.playGame(customerId, score);
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Task không hợp lệ. Chỉ chấp nhận: login, browse, read, collect, game'
        });
    }
    
    // 3. Trả về kết quả
    if (result.success) {
      res.json({
        success: true,
        task: task,
        points: result.earnedPoints,
        totalPoints: result.points,
        message: result.message,
        expiresIn: result.expiresIn
      });
    } else {
      res.json(result);
    }
    
  } catch (error) {
    console.error('Track loyalty error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
}

// Export thêm function mới
API.trackLoyaltyTask = trackLoyaltyTask;

module.exports = { 
  ...API, 
  trackLoyaltyTask 
};

