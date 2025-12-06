const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const { sendNotification, markAllRead, markAsRead } = require('./notifications');

// Nhập các hàm cần thiết từ loyaltytasks
const { 
  trackLoyaltyTask, 
  completeTask, 
  redeemVoucher,
  getCompletedTasks,
  clearCache,
  API
} = require('./loyaltytasks');


const app = express();

// CORS - CHO PHÉP CÁC DOMAIN CỤ THỂ
app.use(cors({
  origin: function (origin, callback) {
    // Cho phép requests không có origin (Postman, server-to-server)
    if (!origin) return callback(null, true);
    
    // Whitelist cụ thể
    const allowedOrigins = [
      'https://ket-noi-tri-thuc.myshopify.com',
      'https://kntt.vn',
      'http://localhost:3000'
    ];
    
    // ✅ CHO PHÉP TẤT CẢ SHOPIFY DOMAINS
    if (
      allowedOrigins.includes(origin) ||
      origin.includes('shopify.com') ||           // ← THÊM
      origin.includes('myshopify.com') ||         // ← THÊM
      origin.includes('shopifysvc.com') ||        // ← THÊM
      origin.includes('shopifycdn.com')           // ← THÊM
    ) {
      return callback(null, true);
    }
    
    console.warn('⚠️ CORS blocked:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Parse JSON body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// ========== CẤU HÌNH ==========<
const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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', // LƯU Ý: Token này nên được bảo mật trong biến môi trường
  apiVersion: '2024-10'
};

const TASKS = {
  // Định nghĩa lại TASKS ở đây để API GET /api/tasks trả về được
  LOGIN: { id: 'login', name: 'Đăng nhập', points: 10, type: 'daily', description: 'Đăng nhập vào tài khoản mỗi ngày' },
  BROWSE_TIME: { id: 'browse_time', name: 'Dạo một vòng coi sách', points: 10, type: 'daily', requiredMinutes: 2, description: 'Dạo xem sách trong 2 phút (1 lần/ngày)' },
  READ_PAGES: { id: 'read_pages', name: 'Đọc sách', points: 30, type: 'daily', requiredPages: 10, description: 'Đọc 10 trang sách mẫu (1 lần/ngày)' },
  COLLECT_BOOKS: { id: 'collect_books', name: 'Săn sách', points: 20, type: 'daily', requiredBooks: 2, description: 'Thêm 2 cuốn sách vào danh sách yêu thích (1 lần/ngày)' },
  COMPLETE_ORDER: { id: 'complete_order', name: 'Chốt đơn', points: 100, type: 'daily', requiredOrders: 1, description: 'Hoàn thành 1 đơn hàng (1 lần/ngày)' },
  PLAY_GAME: { id: 'play_game', name: 'Chơi trò chơi', points: 20, type: 'daily', description: 'Chơi trò chơi mini (1 lần/ngày)' }
};

// ========== API ENDPOINTS ==========

// Lấy thông tin loyalty (Dùng hàm từ loyaltytasks.js để đảm bảo tính toán đồng nhất)
app.get('/api/loyalty/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    // Sử dụng logic getProgress từ loyaltytasks.js để đồng nhất
    const { points, completedTasks, availableTasks, pointsBatches, history } = await API.getProgress(customerId);

    res.json({
      points, // Đã tính toán và lọc hết hạn
      completedTasks,
      availableTasks,
      pointsBatches, // Trả về batches đã lọc
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

// Hoàn thành nhiệm vụ (Sử dụng cho các nhiệm vụ không có Webhook)
app.post('/api/tasks/:taskId/complete', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { customerId, metadata } = req.body;
    
    // GỌI HÀM completeTask TỪ loyaltytasks.js (có Mutex Lock)
    const result = await completeTask(customerId, taskId, metadata);

    // Xóa Cache để API GET đọc dữ liệu mới nhất
    clearCache(customerId); 

    if (result.success) {
      res.json(result);
    } else {
      res.status(200).json(result); // 200 OK nếu chỉ là nhiệm vụ đã hoàn thành rồi
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== TRACKING CHO 5 NHIỆM VỤ (Login, Browse, Read, Collect, Game) ==========
// TÁI SỬ DỤNG LOGIC TỪ loyaltytasks.js
app.post('/api/loyalty/track', trackLoyaltyTask);

// Đổi voucher
app.post('/api/redeem-voucher', async (req, res) => {
  try {
    const { customerId, points: pointsToRedeem } = req.body;
    
    // SỬ DỤNG HÀM redeemVoucher TỪ loyaltytasks.js (có Mutex Lock)
    const result = await redeemVoucher(customerId, pointsToRedeem);
    
    // Xóa Cache sau khi trừ điểm
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

// ========== NOTIFICATION ENDPOINTS ==========

// Đánh dấu tất cả đã đọc
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

// Đánh dấu 1 thông báo đã đọc
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

// Gửi thông báo thủ công (cho admin test)
app.post('/api/notifications/send', async (req, res) => {
  try {
    const { customerId, type, title, message, link } = req.body;
    const result = await sendNotification(customerId, { type, title, message, link });
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook - Order paid (Đã FIX)
app.post('/webhooks/orders/paid', async (req, res) => {
  try {
    const order = req.body;
    const customerId = order.customer?.id;
    
    if (!customerId) {
      return res.status(200).send('OK');
    }
    
    console.log(`📦 Order paid: ${order.id} - Customer: ${customerId}`);
    
    // SỬ DỤNG HÀM completeTask đã được tối ưu hóa
    const task = TASKS.COMPLETE_ORDER;
    const result = await completeTask(customerId, task.id, { orderId: order.id });

    // Xóa Cache sau khi hoàn thành Webhook
    clearCache(customerId);
    
    if (result.success) {
      console.log(`✅ Cộng ${task.points} điểm cho customer ${customerId}`);
    } else {
      console.log(`❌ Không cộng điểm: ${result.message}`);
    }
    
    // Luôn trả về 200 OK cho Shopify dù điểm đã được cộng hay chưa
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('Error processed'); 
  }
});


// ========== START SERVER (Giữ nguyên) ==========
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`
🚀 ===== LOYALTY SYSTEM =====
📡 Server: http://localhost:${PORT}
✅ Webhook: /webhooks/orders/paid
✅ API: /api/loyalty/track (5 nhiệm vụ)
============================
  `);
});
